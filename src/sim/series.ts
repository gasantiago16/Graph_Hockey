import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import type { AarMode } from "../aar/apply.ts";
import { compileTeamGraph } from "../agents/teamGraph.ts";
import { scaledOtSeconds } from "../config.ts";
import { PERIOD_SECONDS } from "../engine/rink.ts";
import { MatchAborted, runMatch, type MatchOptions, type MatchResult } from "../orchestrator/match.ts";
import type { Db } from "../persist/db.ts";
import {
  defaultSnapshotDir,
  filterSnapshotTeams,
  restorePlaybookSnapshot,
  snapshotPlaybooksToDir,
  type PlaybookSnapshot,
} from "../persist/playbookSnapshots.ts";
import { ensureSeedPlaybooks, latestPlaybook } from "../persist/playbooks.ts";
import { loadPlaybook, loadTeam, SEED_TEAM_IDS } from "../playbook/store.ts";
import type { Roster } from "../types/hockey.ts";
import type { TeamLlmProfile } from "../llm/profiles.ts";
import type { Playbook } from "../types/play.ts";

/** DESIGN: default self-play series length. */
export const DEFAULT_SERIES_GAMES = 7;
export const MAX_SERIES_GAMES = 21;

export function gameSeed(seed: number, gameIndex: number): number {
  return (seed + gameIndex) >>> 0;
}

export function seriesMatchId(seriesId: string, gameIndex: number): string {
  return `${seriesId}-g${gameIndex}`;
}

export function makeSeriesId(seed: number, now = Date.now()): string {
  return `ser-${(seed >>> 0).toString(16)}-${now.toString(36)}`;
}

export function parseSeriesGames(raw: number | undefined): number {
  const n = raw === undefined ? DEFAULT_SERIES_GAMES : raw;
  if (!Number.isInteger(n) || n < 1 || n > MAX_SERIES_GAMES) {
    throw new Error(`games must be an integer 1..${MAX_SERIES_GAMES}`);
  }
  return n;
}

function requireSeedTeam(id: string, label: string): void {
  if (!(SEED_TEAM_IDS as readonly string[]).includes(id)) {
    throw new Error(`unknown ${label} team '${id}' (expected ${SEED_TEAM_IDS.join("|")})`);
  }
}

function throwIfAborted(signal: AbortSignal | undefined, matchId: string): void {
  if (signal?.aborted) throw new MatchAborted(matchId);
}

function currentBook(db: Db, teamId: string): { version: number; body: Playbook } {
  const row = latestPlaybook(db, teamId);
  if (row) return { version: row.version, body: row.body };
  const body = loadPlaybook(teamId);
  return { version: body.version > 0 ? body.version : 1, body };
}

export type SeriesGameStart = {
  seriesId: string;
  gameIndex: number;
  games: number;
  matchId: string;
  seed: number;
  home: { id: string; name: string };
  away: { id: string; name: string };
  noLlm: boolean;
  periodSeconds: number;
  rosters: { home: Roster; away: Roster };
};

export type SeriesGameOver = {
  seriesId: string;
  gameIndex: number;
  games: number;
  matchId: string;
  score: { home: number; away: number };
  result: MatchResult["result"];
  seriesComplete: boolean;
};

export type RunSeriesOpts = {
  db: Db;
  homeTeamId: string;
  awayTeamId: string;
  seed: number;
  games?: number;
  seriesId?: string;
  noLlm?: boolean;
  aarMode?: AarMode;
  periodSeconds?: number;
  otSeconds?: number;
  timeoutMs?: number;
  paceMs?: number;
  signal?: AbortSignal;
  /** Directory for this series (`before.json`, `after-game-N.json`). */
  snapshotDir?: string;
  record?: boolean;
  models?: { home: string; away: string };
  homeProfile?: TeamLlmProfile;
  awayProfile?: TeamLlmProfile;
  startedAt?: string;
  /**
   * Restore these books after seed insert, before game 0.
   * Physics seed is independent — this is agent memory, not env.reset.
   */
  fromSnapshot?: PlaybookSnapshot;
  /** Which sides to restore from `fromSnapshot`. Default both. Omitted sides keep seed. */
  fromSnapshotSides?: { home: boolean; away: boolean };
  /** Rank retrieve/leftover from seed JSON. Carried books still write AAR. */
  retrieveSeed?: boolean;
  onGameStart?: (info: SeriesGameStart) => void;
  onTick?: MatchOptions["onTick"];
  onGameOver?: (info: SeriesGameOver) => void | Promise<void>;
};

export type SeriesGameResult = {
  gameIndex: number;
  gameSeed: number;
  match: MatchResult;
  snapshotPath: string;
  snapshot: PlaybookSnapshot;
  playbookVersions: { home: number; away: number };
};

export type SeriesResult = {
  seriesId: string;
  seed: number;
  games: number;
  homeTeamId: string;
  awayTeamId: string;
  noLlm: boolean;
  matches: SeriesGameResult[];
  snapshotDir: string;
  beforeSnapshotPath: string;
  beforeSnapshot: PlaybookSnapshot;
  snapshotPaths: string[];
  carriedFromSnapshot: boolean;
  carriedSides: { home: boolean; away: boolean };
};

/**
 * Run N games sequentially. `gameSeed = seed + gameIndex` (game 0 uses `seed`).
 * AAR auto-apply (when not `--no-llm`) mutates playbooks between games.
 * Playbooks are snapshotted before the series and after each game.
 */
export async function runSeries(opts: RunSeriesOpts): Promise<SeriesResult> {
  requireSeedTeam(opts.homeTeamId, "home");
  requireSeedTeam(opts.awayTeamId, "away");
  const games = parseSeriesGames(opts.games);
  const noLlm = opts.noLlm !== false;
  const seed = opts.seed >>> 0;
  const seriesId = opts.seriesId ?? makeSeriesId(seed);
  const periodSeconds = opts.periodSeconds ?? PERIOD_SECONDS;
  const otSeconds = opts.otSeconds ?? scaledOtSeconds(periodSeconds);
  const snapDir = opts.snapshotDir ?? join(defaultSnapshotDir(), seriesId);
  mkdirSync(snapDir, { recursive: true });

  ensureSeedPlaybooks(opts.db);
  const carry = opts.fromSnapshotSides ?? { home: true, away: true };
  if (opts.fromSnapshot) {
    if (!carry.home && !carry.away) {
      throw new Error("--from-snapshot with no sides to restore (home-seed and away-seed)");
    }
    const needHome = carry.home ? opts.homeTeamId : undefined;
    const needAway = carry.away ? opts.awayTeamId : undefined;
    assertSnapshotCoversTeams(opts.fromSnapshot, needHome, needAway);
    const teamIds = [needHome, needAway].filter((id): id is string => typeof id === "string");
    restorePlaybookSnapshot(opts.db, filterSnapshotTeams(opts.fromSnapshot, teamIds));
  }
  const teamIds = [opts.homeTeamId, opts.awayTeamId];
  const before = snapshotPlaybooksToDir(opts.db, {
    seriesId,
    gameIndex: null,
    teamIds,
    dir: snapDir,
  });

  const homeRoster = loadTeam(opts.homeTeamId);
  const awayRoster = loadTeam(opts.awayTeamId);
  const matches: SeriesGameResult[] = [];
  const snapshotPaths = [before.path];

  for (let gameIndex = 0; gameIndex < games; gameIndex++) {
    const matchId = seriesMatchId(seriesId, gameIndex);
    throwIfAborted(opts.signal, matchId);
    const gSeed = gameSeed(seed, gameIndex);
    const home = currentBook(opts.db, opts.homeTeamId);
    const away = currentBook(opts.db, opts.awayTeamId);
    opts.onGameStart?.({
      seriesId,
      gameIndex,
      games,
      matchId,
      seed: gSeed,
      home: { id: opts.homeTeamId, name: homeRoster.name },
      away: { id: opts.awayTeamId, name: awayRoster.name },
      noLlm,
      periodSeconds,
      rosters: { home: homeRoster, away: awayRoster },
    });

    const retrieveSeed = opts.retrieveSeed === true;
    const homeGraph = compileTeamGraph({
      side: "home",
      playbook: home.body,
      checkpointer: new MemorySaver(),
      noLlm,
      profile: noLlm ? undefined : opts.homeProfile,
      retrievePlaybook: retrieveSeed ? loadPlaybook(opts.homeTeamId) : undefined,
    });
    const awayGraph = compileTeamGraph({
      side: "away",
      playbook: away.body,
      checkpointer: new MemorySaver(),
      noLlm,
      profile: noLlm ? undefined : opts.awayProfile,
      retrievePlaybook: retrieveSeed ? loadPlaybook(opts.awayTeamId) : undefined,
    });

    const match = await runMatch({
      matchId,
      seed: gSeed,
      homeTeamId: opts.homeTeamId,
      awayTeamId: opts.awayTeamId,
      homePlaybook: home.body,
      awayPlaybook: away.body,
      homeGraph,
      awayGraph,
      db: opts.db,
      timeoutMs: opts.timeoutMs,
      periodSeconds,
      otSeconds,
      startedAt: opts.startedAt,
      homePlaybookVersion: home.version,
      awayPlaybookVersion: away.version,
      signal: opts.signal,
      onTick: opts.onTick,
      paceMs: opts.paceMs,
      noLlm,
      aarMode: opts.aarMode,
      models: opts.models ?? (noLlm ? { home: "none", away: "none" } : undefined),
      homeProfile: noLlm ? undefined : opts.homeProfile,
      awayProfile: noLlm ? undefined : opts.awayProfile,
      record: opts.record,
      seriesId,
      gameIndex,
      retrieveSeed,
    });

    const after = snapshotPlaybooksToDir(opts.db, {
      seriesId,
      gameIndex,
      teamIds,
      dir: snapDir,
    });
    snapshotPaths.push(after.path);
    matches.push({
      gameIndex,
      gameSeed: gSeed,
      match,
      snapshotPath: after.path,
      snapshot: after.snapshot,
      playbookVersions: {
        home: latestPlaybook(opts.db, opts.homeTeamId)?.version ?? home.version,
        away: latestPlaybook(opts.db, opts.awayTeamId)?.version ?? away.version,
      },
    });

    await opts.onGameOver?.({
      seriesId,
      gameIndex,
      games,
      matchId,
      score: match.score,
      result: match.result,
      seriesComplete: gameIndex === games - 1,
    });
  }

  return {
    seriesId,
    seed,
    games,
    homeTeamId: opts.homeTeamId,
    awayTeamId: opts.awayTeamId,
    noLlm,
    matches,
    snapshotDir: snapDir,
    beforeSnapshotPath: before.path,
    beforeSnapshot: before.snapshot,
    snapshotPaths,
    carriedFromSnapshot: opts.fromSnapshot !== undefined,
    carriedSides: opts.fromSnapshot
      ? { home: carry.home, away: carry.away }
      : { home: false, away: false },
  };
}

function assertSnapshotCoversTeams(
  snapshot: PlaybookSnapshot,
  homeTeamId: string | undefined,
  awayTeamId: string | undefined,
): void {
  const ids = new Set(snapshot.books.map((b) => b.teamId));
  const need = [homeTeamId, awayTeamId].filter((id): id is string => typeof id === "string");
  const missing = need.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw new Error(
      `--from-snapshot/--from-db missing team books (have ${[...ids].join(",") || "none"}; need ${need.join(" and ")})`,
    );
  }
}
