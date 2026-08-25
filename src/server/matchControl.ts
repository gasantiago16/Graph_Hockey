import { MemorySaver } from "@langchain/langgraph";
import { compileTeamGraph } from "../agents/teamGraph.ts";
import { loadConfig, scaledOtSeconds, type AppConfig } from "../config.ts";
import { DT } from "../engine/rink.ts";
import type { WorldState } from "../engine/world.ts";
import type { MatchBudget } from "../llm/budgets.ts";
import { MatchAborted, runMatch } from "../orchestrator/match.ts";
import type { Db } from "../persist/db.ts";
import { latestPlaybook } from "../persist/playbooks.ts";
import { loadPlaybook, loadTeam, SEED_TEAM_IDS } from "../playbook/store.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Roster } from "../types/hockey.ts";
import type { StartMatchBody } from "../types/ws.ts";

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
      noLlm: true;
      rosters: { home: Roster; away: Roster };
    }
  | { type: "tick"; world: WorldState; events: MatchEvent[]; budget: MatchBudget }
  | {
      type: "over";
      matchId: string;
      score: { home: number; away: number };
      result: "home" | "away" | "tie" | "aborted";
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
};

export type MatchControl = {
  start: (body: StartMatchBody) => { matchId: string; status: "running" } & StartMatchBody & { noLlm: true };
  stop: () => Promise<{ stopped: boolean; matchId?: string }>;
  status: () => MatchStatus;
  subscribe: (fn: (event: MatchControlEvent) => void) => () => void;
};

const SEED_SET = new Set<string>(SEED_TEAM_IDS);

export type CreateMatchControlOpts = {
  db: Db;
  config?: AppConfig;
  /** Wall-clock delay per engine step. Spectator uses 100 ms (10 Hz). */
  paceMs?: number;
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
    };
  }

  function start(body: StartMatchBody) {
    if (live) throw new MatchBusyError(live.matchId);
    if (body.noLlm === false) {
      throw new MatchStartError("LLM matches are not available; send noLlm: true");
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
    const homePlaybook = latestPlaybook(opts.db, home)?.body ?? loadPlaybook(home);
    const awayPlaybook = latestPlaybook(opts.db, away)?.body ?? loadPlaybook(away);

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
      noLlm: true,
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
          noLlm: true,
        });
        const awayGraph = compileTeamGraph({
          side: "away",
          playbook: awayPlaybook,
          checkpointer: new MemorySaver(),
          noLlm: true,
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
      noLlm: true as const,
      periodSeconds,
    };
  }

  async function stop(): Promise<{ stopped: boolean; matchId?: string }> {
    if (!live || !ac) return { stopped: false };
    const matchId = live.matchId;
    ac.abort();
    if (job) {
      try {
        await job;
      } catch {
        // execute() swallows; job should resolve
      }
    }
    return { stopped: true, matchId };
  }

  return {
    start,
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
