#!/usr/bin/env node
import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import { parseAarMode, runPostMatchAar, sideResult } from "../aar/index.ts";
import { compileTeamGraph } from "../agents/teamGraph.ts";
import { loadConfig, scaledOtSeconds, type EnvMap } from "../config.ts";
import { formatCostSummary } from "../llm/budgets.ts";
import { hasInjectedChatModel } from "../llm/client.ts";
import { missingProviderKeys, resolveTeamProfile, type TeamLlmProfile } from "../llm/profiles.ts";
import { formatDelta, loadSeriesImprovement } from "../film/improvement.ts";
import { pairClipsForGames } from "../film/pairClips.ts";
import { getFootage } from "../persist/clips.ts";
import { defaultDbPath, openDb, type Db } from "../persist/db.ts";
import { getAarReport, getMatch, type MatchResultLabel } from "../persist/matches.ts";
import { defaultSnapshotDir } from "../persist/playbookSnapshots.ts";
import { ensureSeedPlaybooks, latestPlaybook, listPlaybookVersions, resetPlaybookToSeed } from "../persist/playbooks.ts";
import { diffPlaybooks, formatPlaybookDiff } from "../playbook/diff.ts";
import { loadPlaybook, SEED_TEAM_IDS } from "../playbook/store.ts";
import { runMatch } from "../orchestrator/match.ts";
import { collectReplayEvents, eventStreamHash, replayMatch } from "../sim/replay.ts";
import { makeSeriesId, parseSeriesGames, runSeries } from "../sim/series.ts";
import type { Side } from "../types/hockey.ts";

export const USAGE = `graph-hockey — competing LangGraph teams on a hockey rink

Usage:
  gh --help
  gh simulate [--home ID] [--away ID] [--seed N] [--no-llm] [--no-record] [--aar-mode auto|propose] [--db PATH] [--match ID]
              [--period-seconds N] [--home-provider xai|muse|openai|gemini] [--away-provider ...] [--home-model SLUG] [--away-model SLUG]
  gh replay --match ID [--to-tick N] [--db PATH]
  gh aar --match ID [--side home|away] [--aar-mode auto|propose|hitl]
  gh playbook --team ID [--diff] [--version N] [--reset-playbook]
  gh series --games 7 [--home ID] [--away ID] [--seed N] [--no-llm] [--no-record] [--aar-mode auto|propose] [--db PATH] [--snapshot-dir PATH]
            [--home-provider xai|muse|openai|gemini] [--away-provider ...] [--home-model SLUG] [--away-model SLUG]
  gh footage --match ID
  gh footage --series ID [--compare i,j] [--json]
  gh engine-selftest

simulate --no-llm skips grok-4.5 / grok-4.3 and writes events to SQLite.
Without --no-llm, live epochs call the home/away providers (keys in .env) and print a cost summary.
AAR runs after every result; default --aar-mode auto applies capped playbook patches.
--aar-mode propose writes the AAR JSON and does not bump playbook versions.
--no-llm skips AAR LLM, stores a code-only digest, and never mutates playbooks.
--no-record skips the clip index (events still stored). CI golden hashes use --no-record.
series default is 7 games; gameSeed = seed + gameIndex. AAR auto-apply mutates playbooks between games (not --no-llm).
Playbook snapshots go in data/playbook-snapshots/<seriesId>/ (before.json + after-game-N.json).
--no-llm series uses 5s periods unless GRAPH_HOCKEY_PERIOD_SECONDS or --period-seconds is set.
footage --match lists auto-clips + open ticks. --series prints the improvement ledger + deltas.
--compare i,j prints paired signatures (same play + zone, Jaccard ≥ 0.3 fallback).
replay resimulates from seed + stored DirectiveApplied events (zero LLM).
aar dumps stored reports or re-runs the AAR graph (--no-llm for code-only).
playbook --diff prints version N vs N-1 (latest by default). --reset-playbook restores the seed.

CI / tests may set GRAPH_HOCKEY_PERIOD_SECONDS=5 so a match is not 36,000 ticks
(default regulation is 3×1200s). GRAPH_HOCKEY_OT_SECONDS is optional; when the
period is shortened, OT scales as 5:00/20:00.

Default LLM provider is xAI both sides (XAI_API_KEY, https://api.x.ai/v1).
Per-side benches: --home-provider / --away-provider xai|muse|openai|gemini
  muse = Meta Muse Spark (MODEL_API_KEY or MUSE_API_KEY, never muse-spark-*-contributor)
  openai = GPT-5.6 (OPENAI_API_KEY; gpt-5.6 aliases gpt-5.6-sol)
  gemini = Gemini 3 (GEMINI_API_KEY or GOOGLE_API_KEY)
--no-llm ignores profiles. The browser never receives API keys.
Engine tests and --no-llm do not require vendor keys.
`;

const KNOWN_COMMANDS = new Set([
  "simulate",
  "replay",
  "aar",
  "playbook",
  "series",
  "footage",
  "engine-selftest",
]);

function flag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function opt(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

function parseSeed(argv: string[]): number {
  const raw = opt(argv, "seed");
  if (raw === undefined) return Math.floor(Math.random() * 0x1_0000_0000);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid --seed ${raw}`);
  }
  return n >>> 0;
}

function parseTeam(argv: string[], name: "home" | "away", fallback: string): string {
  const id = opt(argv, name) ?? fallback;
  if (!(SEED_TEAM_IDS as readonly string[]).includes(id)) {
    throw new Error(`unknown team '${id}' (expected ${SEED_TEAM_IDS.join("|")})`);
  }
  return id;
}

function parseGames(argv: string[]): number {
  const raw = opt(argv, "games");
  if (raw === undefined) return parseSeriesGames(undefined);
  return parseSeriesGames(Number.parseInt(raw, 10));
}

function parseSideProfile(argv: string[], side: "home" | "away", env: EnvMap): TeamLlmProfile {
  return resolveTeamProfile({
    provider: opt(argv, `${side}-provider`),
    coach: opt(argv, `${side}-model`),
    env,
  });
}

function requireLiveKeys(cmd: string, home: TeamLlmProfile, away: TeamLlmProfile, env: EnvMap): string | undefined {
  if (hasInjectedChatModel()) return undefined;
  const missing = missingProviderKeys(home.provider, away.provider, env);
  if (missing.length === 0) return undefined;
  return `gh ${cmd}: live LLM needs keys for ${missing.join(",")} (or pass --no-llm)`;
}

function parsePeriodSecondsFlag(argv: string[]): number | undefined {
  const raw = opt(argv, "period-seconds");
  if (raw === undefined) return undefined;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid --period-seconds ${raw}`);
  if (n > 1200) throw new Error(`--period-seconds ${raw} exceeds max 1200`);
  return n;
}

function parseCompare(raw: string | undefined): { early: number; late: number } | undefined {
  if (raw === undefined) return undefined;
  const m = /^(\d+)\s*,\s*(\d+)$/.exec(raw.trim());
  if (!m) throw new Error(`invalid --compare ${raw} (expected i,j)`);
  return { early: Number.parseInt(m[1]!, 10), late: Number.parseInt(m[2]!, 10) };
}

/** --no-llm series stays off 36,000 ticks unless the operator sets a period. */
function seriesPeriodSeconds(argv: string[], env: EnvMap, cfgPeriod: number, noLlm: boolean): number {
  const flagged = parsePeriodSecondsFlag(argv);
  if (flagged !== undefined) return flagged;
  const envPeriod = env.GRAPH_HOCKEY_PERIOD_SECONDS;
  if (envPeriod !== undefined && envPeriod.trim() !== "") return cfgPeriod;
  return noLlm ? 5 : cfgPeriod;
}

async function withDb<T>(path: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await openDb(path);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

async function cmdSimulate(argv: string[], env: EnvMap): Promise<number> {
  const noLlm = flag(argv, "no-llm");
  const homeProfile = parseSideProfile(argv, "home", env);
  const awayProfile = parseSideProfile(argv, "away", env);
  if (!noLlm) {
    const missing = requireLiveKeys("simulate", homeProfile, awayProfile, env);
    if (missing) {
      console.error(missing);
      return 1;
    }
  }
  const cfg = loadConfig(env);
  const seed = parseSeed(argv);
  const homeTeamId = parseTeam(argv, "home", "original-six");
  const awayTeamId = parseTeam(argv, "away", "expansion");
  const aarMode = parseAarMode(opt(argv, "aar-mode"));
  const dbPath = opt(argv, "db") ?? defaultDbPath();
  const matchId = opt(argv, "match") ?? `sim-${seed}-${Date.now().toString(36)}`;
  const record = !flag(argv, "no-record");
  const periodSeconds = parsePeriodSecondsFlag(argv) ?? cfg.periodSeconds;
  const otOverride = env.GRAPH_HOCKEY_OT_SECONDS;
  const otParsed = otOverride !== undefined ? Number.parseFloat(otOverride) : undefined;
  const otSeconds = scaledOtSeconds(
    periodSeconds,
    otParsed !== undefined && Number.isFinite(otParsed) ? otParsed : undefined,
  );

  const result = await withDb(dbPath, async (db) => {
    ensureSeedPlaybooks(db);
    const homeRow = latestPlaybook(db, homeTeamId);
    const awayRow = latestPlaybook(db, awayTeamId);
    const homePlaybook = homeRow?.body ?? loadPlaybook(homeTeamId);
    const awayPlaybook = awayRow?.body ?? loadPlaybook(awayTeamId);
    const homeGraph = compileTeamGraph({
      side: "home",
      playbook: homePlaybook,
      checkpointer: new MemorySaver(),
      noLlm,
      profile: noLlm ? undefined : homeProfile,
    });
    const awayGraph = compileTeamGraph({
      side: "away",
      playbook: awayPlaybook,
      checkpointer: new MemorySaver(),
      noLlm,
      profile: noLlm ? undefined : awayProfile,
    });
    return runMatch({
      matchId,
      seed,
      homeTeamId,
      awayTeamId,
      homePlaybook,
      awayPlaybook,
      homeGraph,
      awayGraph,
      db,
      timeoutMs: cfg.epochTimeoutMs,
      periodSeconds,
      otSeconds,
      noLlm,
      aarMode,
      homePlaybookVersion: homeRow?.version ?? 1,
      awayPlaybookVersion: awayRow?.version ?? 1,
      models: noLlm ? { home: "none", away: "none" } : { home: homeProfile.coach, away: awayProfile.coach },
      homeProfile: noLlm ? undefined : homeProfile,
      awayProfile: noLlm ? undefined : awayProfile,
      record,
    });
  });

  const cost = {
    promptTokens: result.budget.game.promptTokens,
    outputTokens: result.budget.game.completionTokens,
    reasoningTokens: result.budget.game.reasoningTokens,
    usd: result.budget.game.usd,
    homeCalls: result.budget.home.calls,
    awayCalls: result.budget.away.calls,
  };
  const payload = {
    matchId: result.matchId,
    seed: result.seed,
    home: homeTeamId,
    away: awayTeamId,
    score: result.score,
    result: result.result,
    events: result.events.length,
    epochs: result.epochs,
    eventHash: result.eventHash,
    db: dbPath,
    noLlm,
    recorded: record,
    periodSeconds,
    otSeconds,
    cost,
  };
  if (flag(argv, "json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `match ${payload.matchId}  ${payload.score.home}-${payload.score.away} ${payload.result}  events=${payload.events} epochs=${payload.epochs}`,
    );
    console.log(`eventHash ${payload.eventHash}`);
    console.log(`db ${payload.db}`);
    if (!noLlm) {
      console.log(formatCostSummary(result.budget));
    }
  }
  return 0;
}

async function cmdReplay(argv: string[], env: EnvMap): Promise<number> {
  loadConfig(env);
  const matchId = opt(argv, "match");
  if (!matchId) {
    console.error("gh replay: --match ID is required");
    return 1;
  }
  const dbPath = opt(argv, "db") ?? defaultDbPath();
  const toTickRaw = opt(argv, "to-tick");
  const toTick = toTickRaw !== undefined ? Number.parseInt(toTickRaw, 10) : undefined;

  return withDb(dbPath, async (db) => {
    const row = getMatch(db, matchId);
    if (!row) {
      console.error(`gh replay: no match ${matchId}`);
      return 1;
    }
    const events = collectReplayEvents(matchId, db, Number.isFinite(toTick) ? { toTick } : {});
    let lastTick = 0;
    let lastPhase = "unknown";
    for (const world of replayMatch(matchId, db, Number.isFinite(toTick) ? { toTick } : {})) {
      lastTick = world.liveTick;
      lastPhase = world.phase;
    }
    const payload = {
      matchId,
      seed: row.seed,
      score: { home: row.finalHome, away: row.finalAway },
      result: row.result,
      events: events.length,
      eventHash: eventStreamHash(events),
      liveTick: lastTick,
      phase: lastPhase,
    };
    if (flag(argv, "json")) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `replay ${matchId}  ${payload.score.home}-${payload.score.away} ${payload.result}  events=${payload.events} tick=${payload.liveTick} ${payload.phase}`,
      );
      console.log(`eventHash ${payload.eventHash}`);
    }
    return 0;
  });
}

async function cmdFootage(argv: string[], env: EnvMap): Promise<number> {
  loadConfig(env);
  const seriesId = opt(argv, "series");
  if (seriesId) {
    const dbPath = opt(argv, "db") ?? defaultDbPath();
    const compare = parseCompare(opt(argv, "compare"));
    return withDb(dbPath, async (db) => {
      const view = loadSeriesImprovement(db, seriesId);
      if (!view) {
        console.error(`gh footage: no series ${seriesId}`);
        return 1;
      }
      const pairs = compare ? pairClipsForGames(view.clips, compare.early, compare.late) : view.pairs;
      const payload = {
        seriesId: view.seriesId,
        home: view.home,
        away: view.away,
        games: view.games,
        deltas: view.deltas,
        pairs: pairs.map((p) => ({
          signature: p.signature,
          playId: p.playId,
          zone: p.zone,
          metricHint: p.metricHint,
          early: {
            id: p.early.id,
            matchId: p.early.matchId,
            gameIndex: p.early.gameIndex,
            kind: p.early.kind,
            title: p.early.title,
          },
          late: {
            id: p.late.id,
            matchId: p.late.matchId,
            gameIndex: p.late.gameIndex,
            kind: p.late.kind,
            title: p.late.title,
          },
        })),
        ledger: view.ledger,
        compare: compare ?? undefined,
      };
      if (flag(argv, "json")) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(`footage series ${seriesId}  games=${view.games.length}`);
        console.log(formatDelta("home", view));
        console.log(formatDelta("away", view));
        for (const g of view.games) {
          console.log(
            `  g${g.gameIndex}  ${g.matchId}  ${g.score.home}-${g.score.away}  home ${g.result.home}  pb v${g.playbookVersion.home}`,
          );
        }
        if (compare) console.log(`compare ${compare.early},${compare.late}  pairs=${pairs.length}`);
        else console.log(`pairs ${pairs.length}`);
        for (const p of pairs) {
          console.log(
            `  ${p.signature}  g${p.early.gameIndex ?? "?"} ${p.early.kind} → g${p.late.gameIndex ?? "?"} ${p.late.kind}  ${p.metricHint}`,
          );
        }
        if (pairs.length === 0) console.log("  (no paired clips)");
      }
      return 0;
    });
  }
  const matchId = opt(argv, "match");
  if (!matchId) {
    console.error("gh footage: --match ID is required");
    return 1;
  }
  const dbPath = opt(argv, "db") ?? defaultDbPath();
  return withDb(dbPath, async (db) => {
    const footage = getFootage(db, matchId);
    if (!footage) {
      console.error(`gh footage: no recording for ${matchId}`);
      return 1;
    }
    const payload = {
      matchId,
      recording: footage.recording,
      clips: footage.clips.map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        startLiveTick: c.startLiveTick,
        endLiveTick: c.endLiveTick,
        side: c.side,
        xG: c.xG,
        playId: c.playId,
        source: c.source,
      })),
    };
    if (flag(argv, "json")) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `footage ${matchId}  duration=${footage.recording.durationLiveTicks} ticks  clips=${footage.clips.length}`,
      );
      for (const c of footage.clips) {
        const ticks = `${c.startLiveTick}-${c.endLiveTick}`;
        const xg = c.xG !== undefined ? `  xG ${c.xG.toFixed(2)}` : "";
        console.log(`  ${c.id}  ${c.kind.padEnd(10)} ${ticks.padEnd(12)} ${c.title}${xg}`);
      }
    }
    return 0;
  });
}

function asMatchResultLabel(raw: string | null): MatchResultLabel {
  if (raw === "home" || raw === "away" || raw === "tie") return raw;
  return "tie";
}

async function cmdAar(argv: string[], env: EnvMap): Promise<number> {
  const matchId = opt(argv, "match");
  if (!matchId) {
    console.error("gh aar: --match ID is required");
    return 1;
  }
  const sideRaw = opt(argv, "side");
  const sides: Side[] =
    sideRaw === "home" || sideRaw === "away" ? [sideRaw] : sideRaw === undefined ? ["home", "away"] : [];
  if (sides.length === 0) {
    console.error("gh aar: --side must be home or away");
    return 1;
  }
  const noLlm = flag(argv, "no-llm");
  const dump = flag(argv, "dump");
  const aarMode = parseAarMode(opt(argv, "aar-mode"));
  const homeProfile = parseSideProfile(argv, "home", env);
  const awayProfile = parseSideProfile(argv, "away", env);
  if (!noLlm && !dump) {
    const missing = requireLiveKeys("aar", homeProfile, awayProfile, env);
    if (missing) {
      console.error(missing.replace("--no-llm", "--no-llm / --dump"));
      return 1;
    }
  }
  const dbPath = opt(argv, "db") ?? defaultDbPath();
  return withDb(dbPath, async (db) => {
    const row = getMatch(db, matchId);
    if (!row) {
      console.error(`gh aar: no match ${matchId}`);
      return 1;
    }
    if (dump) {
      const reports = sides.map((side) => ({ side, report: getAarReport(db, matchId, side) }));
      const payload = { matchId, reports };
      if (flag(argv, "json")) console.log(JSON.stringify(payload, null, 2));
      else {
        for (const { side, report } of reports) {
          const body = report?.body as { actualSummary?: string; result?: string } | undefined;
          console.log(`aar ${matchId} ${side} ${body?.result ?? "?"} ${body?.actualSummary ?? "(none)"}`);
        }
      }
      return 0;
    }
    ensureSeedPlaybooks(db);
    const homePlaybook = latestPlaybook(db, row.homeTeam)?.body ?? loadPlaybook(row.homeTeam);
    const awayPlaybook = latestPlaybook(db, row.awayTeam)?.body ?? loadPlaybook(row.awayTeam);
    const both = await runPostMatchAar({
      db,
      matchId,
      matchResult: asMatchResultLabel(row.result),
      homePlaybook,
      awayPlaybook,
      noLlm,
      aarMode,
      homeProfile: noLlm ? undefined : homeProfile,
      awayProfile: noLlm ? undefined : awayProfile,
    });
    const picked = sides.map((side) => ({ side, result: sideResult(asMatchResultLabel(row.result), side), report: both[side] }));
    if (flag(argv, "json")) {
      console.log(JSON.stringify({ matchId, aar: Object.fromEntries(picked.map((p) => [p.side, p.report])) }, null, 2));
    } else {
      for (const p of picked) {
        const ops = p.report.revision?.ops.length ?? 0;
        const dropped = p.report.rejectedOps?.length ?? 0;
        console.log(`aar ${matchId} ${p.side} ${p.result} ops=${ops} rejected=${dropped}`);
        if (p.report.actualSummary) console.log(p.report.actualSummary);
      }
    }
    return 0;
  });
}

async function cmdPlaybook(argv: string[], env: EnvMap): Promise<number> {
  loadConfig(env);
  const teamId = opt(argv, "team");
  if (!teamId) {
    console.error("gh playbook: --team ID is required");
    return 1;
  }
  if (!(SEED_TEAM_IDS as readonly string[]).includes(teamId)) {
    console.error(`gh playbook: unknown team '${teamId}' (expected ${SEED_TEAM_IDS.join("|")})`);
    return 1;
  }
  const dbPath = opt(argv, "db") ?? defaultDbPath();
  const versionRaw = opt(argv, "version");
  const wantDiff = flag(argv, "diff");
  const wantReset = flag(argv, "reset-playbook");
  const asJson = flag(argv, "json");

  return withDb(dbPath, async (db) => {
    ensureSeedPlaybooks(db);
    if (wantReset) {
      const row = resetPlaybookToSeed(db, teamId);
      if (asJson) console.log(JSON.stringify({ teamId, version: row.version, reset: true }));
      else console.log(`playbook ${teamId} reset to seed v${row.version}`);
      return 0;
    }
    const versions = listPlaybookVersions(db, teamId);
    const latest = versions.at(-1);
    if (!latest) {
      console.error(`gh playbook: no playbook for ${teamId}`);
      return 1;
    }
    let target = latest;
    if (versionRaw !== undefined) {
      const v = Number.parseInt(versionRaw, 10);
      const hit = versions.find((r) => r.version === v);
      if (!hit) {
        console.error(`gh playbook: no ${teamId} version ${versionRaw}`);
        return 1;
      }
      target = hit;
    }
    if (wantDiff) {
      const from = versions.find((r) => r.version === target.version - 1) ?? versions[0]!;
      const diff = diffPlaybooks(from.body, target.body);
      diff.fromVersion = from.version;
      diff.toVersion = target.version;
      if (asJson) console.log(JSON.stringify(diff, null, 2));
      else console.log(formatPlaybookDiff(diff));
      return 0;
    }
    const payload = {
      teamId: target.body.teamId,
      version: target.version,
      parentVersion: target.parentVersion,
      aarMatchId: target.aarMatchId,
      plays: target.body.plays.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        version: p.version,
        origin: p.origin,
        stats: p.stats,
      })),
    };
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`playbook ${payload.teamId} v${payload.version}  plays=${payload.plays.length}`);
      for (const p of payload.plays) {
        console.log(`  ${p.status.padEnd(12)} ${p.id}  ${p.name}`);
      }
    }
    return 0;
  });
}

async function cmdSeries(argv: string[], env: EnvMap): Promise<number> {
  const noLlm = flag(argv, "no-llm");
  const homeProfile = parseSideProfile(argv, "home", env);
  const awayProfile = parseSideProfile(argv, "away", env);
  if (!noLlm) {
    const missing = requireLiveKeys("series", homeProfile, awayProfile, env);
    if (missing) {
      console.error(missing);
      return 1;
    }
  }
  const cfg = loadConfig(env);
  const seed = parseSeed(argv);
  const homeTeamId = parseTeam(argv, "home", "original-six");
  const awayTeamId = parseTeam(argv, "away", "expansion");
  const aarMode = parseAarMode(opt(argv, "aar-mode"));
  const dbPath = opt(argv, "db") ?? defaultDbPath();
  const games = parseGames(argv);
  const record = !flag(argv, "no-record");
  const periodSeconds = seriesPeriodSeconds(argv, env, cfg.periodSeconds, noLlm);
  const otOverride = env.GRAPH_HOCKEY_OT_SECONDS;
  const otParsed = otOverride !== undefined ? Number.parseFloat(otOverride) : undefined;
  const otSeconds = scaledOtSeconds(
    periodSeconds,
    otParsed !== undefined && Number.isFinite(otParsed) ? otParsed : undefined,
  );
  const seriesId = opt(argv, "id") ?? makeSeriesId(seed);
  const snapshotParent = opt(argv, "snapshot-dir") ?? defaultSnapshotDir();
  const snapshotDir = join(snapshotParent, seriesId);

  const result = await withDb(dbPath, async (db) => {
    return runSeries({
      db,
      homeTeamId,
      awayTeamId,
      seed,
      games,
      seriesId,
      noLlm,
      aarMode,
      periodSeconds,
      otSeconds,
      timeoutMs: cfg.epochTimeoutMs,
      record,
      snapshotDir,
      models: noLlm ? { home: "none", away: "none" } : { home: homeProfile.coach, away: awayProfile.coach },
      homeProfile: noLlm ? undefined : homeProfile,
      awayProfile: noLlm ? undefined : awayProfile,
    });
  });

  const payload = {
    seriesId: result.seriesId,
    seed: result.seed,
    games: result.games,
    home: homeTeamId,
    away: awayTeamId,
    noLlm,
    periodSeconds,
    db: dbPath,
    snapshotDir: result.snapshotDir,
    snapshots: result.snapshotPaths,
    matches: result.matches.map((g) => ({
      gameIndex: g.gameIndex,
      gameSeed: g.gameSeed,
      matchId: g.match.matchId,
      score: g.match.score,
      result: g.match.result,
      events: g.match.events.length,
      eventHash: g.match.eventHash,
      playbookVersions: g.playbookVersions,
    })),
  };
  if (flag(argv, "json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`series ${payload.seriesId}  ${payload.games} games  seed ${payload.seed}`);
    for (const g of payload.matches) {
      console.log(
        `  g${g.gameIndex}  ${g.matchId}  seed ${g.gameSeed}  ${g.score.home}-${g.score.away} ${g.result}  events=${g.events}`,
      );
    }
    console.log(`snapshots ${payload.snapshotDir}`);
  }
  return 0;
}

export async function main(argv: string[], env: EnvMap = process.env): Promise<number> {
  loadConfig(env);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE.trimEnd());
    return 0;
  }
  const cmd = argv[0];
  if (cmd === undefined || !KNOWN_COMMANDS.has(cmd)) {
    console.error(`gh: unknown command '${cmd ?? ""}'. Try gh --help`);
    return 1;
  }
  const rest = argv.slice(1);
  try {
    switch (cmd) {
      case "simulate":
        return await cmdSimulate(rest, env);
      case "replay":
        return await cmdReplay(rest, env);
      case "aar":
        return await cmdAar(rest, env);
      case "playbook":
        return await cmdPlaybook(rest, env);
      case "footage":
        return await cmdFootage(rest, env);
      case "series":
        return await cmdSeries(rest, env);
      default:
        console.error(`gh ${cmd}: not implemented yet`);
        return 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`gh ${cmd}: ${message}`);
    return 1;
  }
}

const invoked = process.argv[1]?.replaceAll("\\", "/");
if (invoked && /\/cli\/main\.(ts|js)$/.test(invoked)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
