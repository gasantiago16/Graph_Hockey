#!/usr/bin/env node
import { MemorySaver } from "@langchain/langgraph";
import { compileTeamGraph } from "../agents/teamGraph.ts";
import { loadConfig, type EnvMap } from "../config.ts";
import { defaultDbPath, openDb, type Db } from "../persist/db.ts";
import { getMatch } from "../persist/matches.ts";
import { ensureSeedPlaybooks, latestPlaybook } from "../persist/playbooks.ts";
import { loadPlaybook, SEED_TEAM_IDS } from "../playbook/store.ts";
import { runMatch } from "../orchestrator/match.ts";
import { collectReplayEvents, eventStreamHash, replayMatch } from "../sim/replay.ts";

export const USAGE = `graph-hockey — competing LangGraph teams on a hockey rink

Usage:
  gh --help
  gh simulate [--home ID] [--away ID] [--seed N] [--no-llm] [--db PATH] [--match ID]
  gh replay --match ID [--to-tick N] [--db PATH]
  gh aar --match ID [--side home|away] [--aar-mode auto|propose|hitl]
  gh playbook --team ID [--diff] [--version N]
  gh series --games N --home ID --away ID [--seed N]
  gh footage --match ID
  gh footage --series ID [--compare i,j] [--json]
  gh engine-selftest

simulate --no-llm skips the grok-4.5 Head Coach and writes events to SQLite.
replay resimulates from seed + stored DirectiveApplied events (zero LLM).

CI / tests may set GRAPH_HOCKEY_PERIOD_SECONDS=5 so a match is not 36,000 ticks
(default regulation is 3×1200s). GRAPH_HOCKEY_OT_SECONDS is optional; when the
period is shortened, OT scales as 5:00/20:00.

LLM provider is xAI only (XAI_API_KEY, https://api.x.ai/v1).
The browser never receives API keys and never calls xAI.
Engine tests and --no-llm do not require XAI_API_KEY.
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

async function withDb<T>(path: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await openDb(path);
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}

async function cmdSimulate(argv: string[], env: EnvMap): Promise<number> {
  if (!flag(argv, "no-llm")) {
    console.error("gh simulate: live LLM path is not implemented; pass --no-llm");
    return 1;
  }
  const cfg = loadConfig(env);
  const seed = parseSeed(argv);
  const homeTeamId = parseTeam(argv, "home", "original-six");
  const awayTeamId = parseTeam(argv, "away", "expansion");
  const dbPath = opt(argv, "db") ?? defaultDbPath();
  const matchId = opt(argv, "match") ?? `sim-${seed}-${Date.now().toString(36)}`;

  const result = await withDb(dbPath, async (db) => {
    ensureSeedPlaybooks(db);
    const homePlaybook = latestPlaybook(db, homeTeamId)?.body ?? loadPlaybook(homeTeamId);
    const awayPlaybook = latestPlaybook(db, awayTeamId)?.body ?? loadPlaybook(awayTeamId);
    const homeGraph = compileTeamGraph({
      side: "home",
      playbook: homePlaybook,
      checkpointer: new MemorySaver(),
      noLlm: true,
    });
    const awayGraph = compileTeamGraph({
      side: "away",
      playbook: awayPlaybook,
      checkpointer: new MemorySaver(),
      noLlm: true,
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
      periodSeconds: cfg.periodSeconds,
      otSeconds: cfg.otSeconds,
    });
  });

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
    noLlm: true,
    periodSeconds: cfg.periodSeconds,
  };
  if (flag(argv, "json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `match ${payload.matchId}  ${payload.score.home}-${payload.score.away} ${payload.result}  events=${payload.events} epochs=${payload.epochs}`,
    );
    console.log(`eventHash ${payload.eventHash}`);
    console.log(`db ${payload.db}`);
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
