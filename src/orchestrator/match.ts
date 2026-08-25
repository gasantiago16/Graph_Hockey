import { DT, OT_SECONDS, PERIOD_SECONDS } from "../engine/rink.ts";
import { createRng } from "../engine/rng.ts";
import { advanceWorld } from "../engine/step.ts";
import { defaultDirective, type WorldState } from "../engine/world.ts";
import { createBudget, EPOCH_TIMEOUT_MS, type MatchBudget } from "../llm/budgets.ts";
import { insertEvents, persistEpoch } from "../persist/events.ts";
import { finishMatch, insertMatch, type MatchResultLabel } from "../persist/matches.ts";
import { makeOpeningSnapshot, type OpeningSnapshot } from "../persist/snapshot.ts";
import type { Db } from "../persist/db.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { collectReplayEvents, eventStreamHash, pushDirectiveApplied, worldFromSnapshot } from "../sim/replay.ts";
import type { TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Side } from "../types/hockey.ts";
import type { Playbook } from "../types/play.ts";
import type { CompiledTeamGraph } from "../agents/teamGraph.ts";
import { shouldDecide } from "./epochs.ts";
import { invokeTeam } from "./invokeTeam.ts";
import { observe } from "./observe.ts";

export type MatchOptions = {
  matchId: string;
  seed: number;
  homeTeamId: string;
  awayTeamId: string;
  homePlaybook: Playbook;
  awayPlaybook: Playbook;
  homeGraph: CompiledTeamGraph;
  awayGraph: CompiledTeamGraph;
  db: Db;
  timeoutMs?: number;
  periodSeconds?: number;
  otSeconds?: number;
  startedAt?: string;
  homePlaybookVersion?: number;
  awayPlaybookVersion?: number;
};

export type MatchResult = {
  matchId: string;
  seed: number;
  score: { home: number; away: number };
  result: MatchResultLabel;
  events: MatchEvent[];
  eventHash: string;
  liveTick: number;
  stoppageSeq: number;
  epochs: number;
  snapshot: OpeningSnapshot;
};

export function matchIterCap(periodSeconds: number, otSeconds: number): number {
  const live = Math.ceil((3 * periodSeconds + otSeconds) / DT);
  return live + 8_000;
}

function resultLabel(score: { home: number; away: number }): MatchResultLabel {
  if (score.home > score.away) return "home";
  if (score.away > score.home) return "away";
  return "tie";
}

function attachBooks(world: WorldState, home: Playbook, away: Playbook): void {
  world.playbooks = { home, away };
}

/**
 * Host loop: tick world, observe, invoke stub graphs at stoppages. Not a LangGraph.
 * Does not run AAR (later PR).
 */
export async function runMatch(opts: MatchOptions): Promise<MatchResult> {
  const periodSeconds = opts.periodSeconds ?? PERIOD_SECONDS;
  const otSeconds = opts.otSeconds ?? OT_SECONDS;
  const timeoutMs = opts.timeoutMs ?? EPOCH_TIMEOUT_MS;
  const snap = makeOpeningSnapshot({
    matchId: opts.matchId,
    seed: opts.seed,
    homeTeamId: opts.homeTeamId,
    awayTeamId: opts.awayTeamId,
    homePlaybookVersion: opts.homePlaybookVersion ?? 1,
    awayPlaybookVersion: opts.awayPlaybookVersion ?? 1,
    models: { home: "none", away: "none" },
    periodSeconds,
    otSeconds,
  });
  insertMatch(opts.db, snap, opts.startedAt);

  const rng = createRng(opts.seed);
  const world = worldFromSnapshot(snap);
  attachBooks(world, opts.homePlaybook, opts.awayPlaybook);

  const events: MatchEvent[] = [];
  let homeDir: TeamDirective = defaultDirective();
  let awayDir: TeamDirective = defaultDirective();
  const budget: MatchBudget = createBudget();
  let epochIndex = 0;
  const maxIters = matchIterCap(periodSeconds, otSeconds);
  let iters = 0;

  while (true) {
    if (world.phase === "game_over") break;
    if (iters >= maxIters) {
      throw new Error(`runMatch ${opts.matchId} exceeded ${maxIters} iterations`);
    }
    const ev = advanceWorld(world, { home: homeDir, away: awayDir }, rng);
    events.push(...ev);
    insertEvents(opts.db, opts.matchId, ev);
    iters += 1;

    const decision = shouldDecide(world, ev, homeDir, awayDir);
    const sides = (["home", "away"] as const).filter((s) => decision[s]);
    if (sides.length === 0) continue;

    const jobs = sides.map((side) => {
      const obs = observe(world, side, decision[side]!);
      return invokeTeam({
        graph: side === "home" ? opts.homeGraph : opts.awayGraph,
        side,
        obs,
        last: side === "home" ? homeDir : awayDir,
        epochIndex,
        matchId: opts.matchId,
        budget,
        timeoutMs,
      }).then((r) => ({ side, r, reason: decision[side]!.reason, kind: decision[side]!.kind }));
    });

    const settled = await Promise.all(jobs);
    const dirEvents: MatchEvent[] = [];
    for (const { side, r, reason, kind } of settled) {
      if (side === "home") homeDir = r.directive;
      else awayDir = r.directive;
      dirEvents.push(pushDirectiveApplied(world, side, r.directive));
      persistEpoch(opts.db, {
        matchId: opts.matchId,
        seq: epochIndex,
        side,
        reason,
        epochKind: kind,
        model: "none",
        promptTokens: r.usage.promptTokens,
        completionTokens: r.usage.completionTokens,
        reasoningTokens: r.usage.reasoningTokens,
        ok: r.ok,
        billed: r.billed,
        directive: r.directive,
      });
    }
    events.push(...dirEvents);
    insertEvents(opts.db, opts.matchId, dirEvents);
    epochIndex += 1;
  }

  const result = resultLabel(world.score);
  finishMatch(opts.db, opts.matchId, world.score, result);

  return {
    matchId: opts.matchId,
    seed: opts.seed,
    score: { ...world.score },
    result,
    events,
    eventHash: eventStreamHash(events),
    liveTick: world.liveTick,
    stoppageSeq: world.stoppageSeq,
    epochs: epochIndex,
    snapshot: snap,
  };
}

export function replayHash(matchId: string, db: Db): string {
  return eventStreamHash(collectReplayEvents(matchId, db));
}

export function seedPlaybookFor(teamId: string): Playbook {
  return loadPlaybook(teamId);
}
