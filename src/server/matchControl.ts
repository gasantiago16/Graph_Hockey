import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import { compileTeamGraph } from "../agents/teamGraph.ts";
import { loadConfig, scaledOtSeconds, type AppConfig } from "../config.ts";
import { DT } from "../engine/rink.ts";
import type { WorldState } from "../engine/world.ts";
import type { MatchBudget } from "../llm/budgets.ts";
import { hasInjectedChatModel } from "../llm/client.ts";
import { MatchAborted, runMatch } from "../orchestrator/match.ts";
import type { Db } from "../persist/db.ts";
import { defaultSnapshotDir } from "../persist/playbookSnapshots.ts";
import { latestPlaybook } from "../persist/playbooks.ts";
import { loadPlaybook, loadTeam, SEED_TEAM_IDS } from "../playbook/store.ts";
import { makeSeriesId, parseSeriesGames, runSeries, seriesMatchId } from "../sim/series.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Roster } from "../types/hockey.ts";
import type { StartMatchBody, StartSeriesBody } from "../types/ws.ts";

/** Live LLM start: server key or test inject (FakeListChatModel). Never reads the key into WS. */
export function llmMatchAllowed(config: Pick<AppConfig, "xaiApiKey">): boolean {
  return Boolean(config.xaiApiKey) || hasInjectedChatModel();
}

export class MatchBusyError extends Error {
  constructor(readonly matchId: string) {
    super(`match already running: ${matchId}`);
    this.name = "MatchBusyError";
  }
}

export class MatchStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchStartError";
  }
}

export type MatchControlEvent =
  | {
      type: "start";
      matchId: string;
      home: { id: string; name: string };
      away: { id: string; name: string };
      seed: number;
      periodSeconds: number;
      noLlm: boolean;
      rosters: { home: Roster; away: Roster };
      seriesId?: string;
      gameIndex?: number;
      games?: number;
    }
  | { type: "tick"; world: WorldState; events: MatchEvent[]; budget: MatchBudget }
  | {
      type: "over";
      matchId: string;
      score: { home: number; away: number };
      result: "home" | "away" | "tie" | "aborted";
      seriesId?: string;
      gameIndex?: number;
      games?: number;
      seriesComplete?: boolean;
    };

export type MatchStatus = {
  running: boolean;
  matchId?: string;
  home?: string;
  away?: string;
  seed?: number;
  periodSeconds?: number;
  score?: { home: number; away: number };
  period?: WorldState["period"];
  clockRemaining?: number;
  phase?: string;
  strength?: string;
  liveTick?: number;
  seriesId?: string;
  gameIndex?: number;
  games?: number;
};

export type MatchControl = {
  start: (body: StartMatchBody) => { matchId: string; status: "running" } & StartMatchBody & { noLlm: boolean };
  startSeries: (
    body: StartSeriesBody,
  ) => { seriesId: string; matchId: string; status: "running"; games: number } & StartSeriesBody & { noLlm: boolean };
  stop: () => Promise<{ stopped: boolean; matchId?: string; seriesId?: string }>;
  status: () => MatchStatus;
  subscribe: (fn: (event: MatchControlEvent) => void) => () => void;
};

const SEED_SET = new Set<string>(SEED_TEAM_IDS);

export type CreateMatchControlOpts = {
  db: Db;
  config?: AppConfig;
  /** Wall-clock delay per engine step. Spectator uses 100 ms (10 Hz). */
  paceMs?: number;
  /** Parent dir for series playbook snapshots (`<dir>/<seriesId>/`). */
  snapshotDir?: string;
};

export function createMatchControl(opts: CreateMatchControlOpts): MatchControl {
  const config = opts.config ?? loadConfig();
  const paceMs = opts.paceMs ?? DT * 1000;
  const listeners = new Set<(event: MatchControlEvent) => void>();

  let ac: AbortController | null = null;
  let job: Promise<void> | null = null;
  const liveWorld: { current: WorldState | null } = { current: null };
  let lastScore = { home: 0, away: 0 };
  let live: {
    matchId: string;
    home: string;
    away: string;
    seed: number;
    periodSeconds: number;
    seriesId?: string;
    gameIndex?: number;
    games?: number;
  } | null = null;

  function emit(event: MatchControlEvent): void {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function status(): MatchStatus {
    if (!live) return { running: false };
    return {
      running: true,
      matchId: live.matchId,
      home: live.home,
      away: live.away,
      seed: live.seed,
      periodSeconds: live.periodSeconds,
      score: liveWorld.current ? { ...liveWorld.current.score } : { ...lastScore },
      period: liveWorld.current?.period,
      clockRemaining: liveWorld.current?.clockRemaining,
      phase: liveWorld.current?.phase,
      strength: liveWorld.current?.strength,
      liveTick: liveWorld.current?.liveTick,
      seriesId: live.seriesId,
      gameIndex: live.gameIndex,
      games: live.games,
    };
  }

  function start(body: StartMatchBody) {
    if (live) throw new MatchBusyError(live.matchId);
    const noLlm = body.noLlm !== false;
    if (!noLlm && !llmMatchAllowed(config)) {
      throw new MatchStartError("LLM matches need XAI_API_KEY (or an injected chat model); send noLlm: true");
    }
    const home = body.home;
    const away = body.away;
    if (!SEED_SET.has(home)) {
      throw new MatchStartError(`unknown home team '${home}' (expected ${SEED_TEAM_IDS.join("|")})`);
    }
    if (!SEED_SET.has(away)) {
      throw new MatchStartError(`unknown away team '${away}' (expected ${SEED_TEAM_IDS.join("|")})`);
    }
    const seed = body.seed ?? (Math.floor(Math.random() * 0x1_0000_0000) >>> 0);
    const periodSeconds = body.periodSeconds ?? config.periodSeconds;
    const otSeconds = scaledOtSeconds(periodSeconds);
    const matchId = `live-${seed}-${Date.now().toString(36)}`;
    const homeRoster = loadTeam(home);
    const awayRoster = loadTeam(away);
    const homeRow = latestPlaybook(opts.db, home);
    const awayRow = latestPlaybook(opts.db, away);
    const homePlaybook = homeRow?.body ?? loadPlaybook(home);
    const awayPlaybook = awayRow?.body ?? loadPlaybook(away);

    const controller = new AbortController();
    ac = controller;
    live = { matchId, home, away, seed, periodSeconds };
    liveWorld.current = null;
    lastScore = { home: 0, away: 0 };

    emit({
      type: "start",
      matchId,
      home: { id: home, name: homeRoster.name },
      away: { id: away, name: awayRoster.name },
      seed,
      periodSeconds,
      noLlm,
      rosters: { home: homeRoster, away: awayRoster },
    });

    job = (async () => {
      let outcome: { score: { home: number; away: number }; result: "home" | "away" | "tie" | "aborted" } | null =
        null;
      try {
        const homeGraph = compileTeamGraph({
          side: "home",
          playbook: homePlaybook,
          checkpointer: new MemorySaver(),
          noLlm,
        });
        const awayGraph = compileTeamGraph({
          side: "away",
          playbook: awayPlaybook,
          checkpointer: new MemorySaver(),
          noLlm,
        });
        const result = await runMatch({
          matchId,
          seed,
          homeTeamId: home,
          awayTeamId: away,
          homePlaybook,
          awayPlaybook,
          homeGraph,
          awayGraph,
          db: opts.db,
          timeoutMs: config.epochTimeoutMs,
          periodSeconds,
          otSeconds,
          signal: controller.signal,
          paceMs,
          noLlm,
          homePlaybookVersion: homeRow?.version ?? 1,
          awayPlaybookVersion: awayRow?.version ?? 1,
          models: noLlm
            ? { home: "none", away: "none" }
            : { home: config.coachModel, away: config.coachModel },
          onTick: (next, events, budget) => {
            liveWorld.current = next;
            lastScore = { home: next.score.home, away: next.score.away };
            emit({ type: "tick", world: next, events, budget });
          },
        });
        outcome = { score: { ...result.score }, result: result.result };
      } catch (err) {
        if (!(err instanceof MatchAborted)) {
          console.error(err);
        }
        outcome = { score: { ...lastScore }, result: "aborted" };
      } finally {
        if (live?.matchId === matchId) live = null;
        if (ac === controller) ac = null;
        job = null;
      }
      if (outcome) emit({ type: "over", matchId, score: outcome.score, result: outcome.result });
    })();

    return {
      matchId,
      status: "running" as const,
      home,
      away,
      seed,
      noLlm,
      periodSeconds,
    };
  }

  function startSeries(body: StartSeriesBody) {
    if (live) throw new MatchBusyError(live.matchId);
    const noLlm = body.noLlm !== false;
    if (!noLlm && !llmMatchAllowed(config)) {
      throw new MatchStartError("LLM matches need XAI_API_KEY (or an injected chat model); send noLlm: true");
    }
    const home = body.home;
    const away = body.away;
    if (!SEED_SET.has(home)) {
      throw new MatchStartError(`unknown home team '${home}' (expected ${SEED_TEAM_IDS.join("|")})`);
    }
    if (!SEED_SET.has(away)) {
      throw new MatchStartError(`unknown away team '${away}' (expected ${SEED_TEAM_IDS.join("|")})`);
    }
    let games: number;
    try {
      games = parseSeriesGames(body.games);
    } catch (err) {
      throw new MatchStartError(err instanceof Error ? err.message : String(err));
    }
    const seed = body.seed ?? (Math.floor(Math.random() * 0x1_0000_0000) >>> 0);
    const periodSeconds = body.periodSeconds ?? config.periodSeconds;
    const otSeconds = scaledOtSeconds(periodSeconds);
    const seriesId = makeSeriesId(seed);
    const firstMatchId = seriesMatchId(seriesId, 0);
    const homeRoster = loadTeam(home);
    const awayRoster = loadTeam(away);

    const controller = new AbortController();
    ac = controller;
    live = {
      matchId: firstMatchId,
      home,
      away,
      seed,
      periodSeconds,
      seriesId,
      gameIndex: 0,
      games,
    };
    liveWorld.current = null;
    lastScore = { home: 0, away: 0 };

    job = (async () => {
      try {
        await runSeries({
          db: opts.db,
          homeTeamId: home,
          awayTeamId: away,
          seed,
          games,
          seriesId,
          noLlm,
          periodSeconds,
          otSeconds,
          timeoutMs: config.epochTimeoutMs,
          paceMs,
          snapshotDir: join(opts.snapshotDir ?? defaultSnapshotDir(), seriesId),
          signal: controller.signal,
          models: noLlm
            ? { home: "none", away: "none" }
            : { home: config.coachModel, away: config.coachModel },
          onGameStart: (info) => {
            live = {
              matchId: info.matchId,
              home,
              away,
              seed: info.seed,
              periodSeconds,
              seriesId,
              gameIndex: info.gameIndex,
              games,
            };
            liveWorld.current = null;
            lastScore = { home: 0, away: 0 };
            emit({
              type: "start",
              matchId: info.matchId,
              home: info.home,
              away: info.away,
              seed: info.seed,
              periodSeconds,
              noLlm,
              rosters: { home: homeRoster, away: awayRoster },
              seriesId,
              gameIndex: info.gameIndex,
              games,
            });
          },
          onTick: (next, events, budget) => {
            liveWorld.current = next;
            lastScore = { home: next.score.home, away: next.score.away };
            emit({ type: "tick", world: next, events, budget });
          },
          onGameOver: (info) => {
            emit({
              type: "over",
              matchId: info.matchId,
              score: info.score,
              result: info.result,
              seriesId,
              gameIndex: info.gameIndex,
              games,
              seriesComplete: info.seriesComplete,
            });
          },
        });
      } catch (err) {
        if (!(err instanceof MatchAborted)) {
          console.error(err);
        }
        emit({
          type: "over",
          matchId: live?.matchId ?? firstMatchId,
          score: { ...lastScore },
          result: "aborted",
          seriesId,
          gameIndex: live?.gameIndex,
          games,
          seriesComplete: true,
        });
      } finally {
        if (live?.seriesId === seriesId) live = null;
        if (ac === controller) ac = null;
        job = null;
      }
    })();

    return {
      seriesId,
      matchId: firstMatchId,
      status: "running" as const,
      home,
      away,
      seed,
      noLlm,
      periodSeconds,
      games,
    };
  }

  async function stop(): Promise<{ stopped: boolean; matchId?: string; seriesId?: string }> {
    if (!live || !ac) return { stopped: false };
    const matchId = live.matchId;
    const seriesId = live.seriesId;
    ac.abort();
    if (job) {
      try {
        await job;
      } catch {
        // execute() swallows; job should resolve
      }
    }
    return { stopped: true, matchId, seriesId };
  }

  return {
    start,
    startSeries,
    stop,
    status,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
