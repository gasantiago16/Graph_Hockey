import { createHash } from "node:crypto";
import { createRng } from "../engine/rng.ts";
import { TICKS_PER_GAME_REG } from "../engine/rink.ts";
import { advanceWorld } from "../engine/step.ts";
import { LAST_EVENTS_CAP, createWorld, type WorldState } from "../engine/world.ts";
import type { TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import { makeEventId } from "../types/ids.ts";
import type { Side } from "../types/hockey.ts";
import type { Db } from "../persist/db.ts";
import { loadDirectivesByTick } from "../persist/events.ts";
import { loadOpeningSnapshot } from "../persist/matches.ts";
import {
  defaultDirectiveFromSnapshot,
  type OpeningSnapshot,
} from "../persist/snapshot.ts";

/** Hard cap so a corrupt log cannot spin forever. Regulation + OT + stoppages. */
export const MAX_REPLAY_ITERS = TICKS_PER_GAME_REG + 8_000;

export type ReplayOpts = {
  /** Stop after a world with liveTick >= toTick has been produced (after an advance). */
  toTick?: number;
  maxIters?: number;
};

export type ReplayStep = {
  world: WorldState;
  events: MatchEvent[];
};

export function worldFromSnapshot(snap: OpeningSnapshot): WorldState {
  const homeOnIce = snap.openingFaceoff.homeOnIce;
  const awayOnIce = snap.openingFaceoff.awayOnIce;
  const world = createWorld({
    matchId: snap.matchId,
    seed: snap.seed,
    phase: "faceoff_drop",
    faceoffSpot: { x: snap.openingFaceoff.spot.x, y: snap.openingFaceoff.spot.y },
    onIce:
      homeOnIce.length > 0 && awayOnIce.length > 0
        ? { home: [...homeOnIce], away: [...awayOnIce] }
        : undefined,
  });
  return world;
}

function appendLastEvent(world: WorldState, event: MatchEvent): void {
  world.lastEvents.push(event);
  if (world.lastEvents.length > LAST_EVENTS_CAP) {
    world.lastEvents.splice(0, world.lastEvents.length - LAST_EVENTS_CAP);
  }
}

/** Log a stored coach directive. Does not consume engine RNG. */
export function pushDirectiveApplied(world: WorldState, side: Side, directive: TeamDirective): MatchEvent {
  world.directives = { ...world.directives, [side]: directive };
  world.playId = { ...world.playId, [side]: directive.playId };
  const seq = (world.lastEvents.at(-1)?.seq ?? -1) + 1;
  const event: MatchEvent = {
    id: makeEventId(world.matchId, seq),
    seq,
    liveTick: world.liveTick,
    stoppageSeq: world.stoppageSeq,
    period: world.period,
    type: "DirectiveApplied",
    payload: { side, directive, liveTick: world.liveTick, stoppageSeq: world.stoppageSeq },
  };
  appendLastEvent(world, event);
  return event;
}

function applyStoredDirectives(
  world: WorldState,
  stored: { home?: TeamDirective; away?: TeamDirective } | undefined,
  homeDir: TeamDirective,
  awayDir: TeamDirective,
): { home: TeamDirective; away: TeamDirective; events: MatchEvent[] } {
  const events: MatchEvent[] = [];
  let home = homeDir;
  let away = awayDir;
  if (stored?.home) {
    home = stored.home;
    events.push(pushDirectiveApplied(world, "home", home));
  }
  if (stored?.away) {
    away = stored.away;
    events.push(pushDirectiveApplied(world, "away", away));
  }
  return { home, away, events };
}

/**
 * Resimulation: same seed + stored `DirectiveApplied` events, calling `advanceWorld`.
 * Not sparse `applyEvent` kinematics. No LLM.
 */
export function* replaySteps(matchId: string, db: Db, opts: ReplayOpts = {}): Generator<ReplayStep> {
  const snap = loadOpeningSnapshot(db, matchId);
  const rng = createRng(snap.seed);
  const world = worldFromSnapshot(snap);
  const dirsAt = loadDirectivesByTick(db, matchId);
  let homeDir = defaultDirectiveFromSnapshot("home", snap);
  let awayDir = defaultDirectiveFromSnapshot("away", snap);

  yield { world, events: [] };

  let iters = 0;
  while (world.phase !== "game_over") {
    if (opts.maxIters !== undefined && iters >= opts.maxIters) return;
    if (iters >= MAX_REPLAY_ITERS) {
      throw new Error(`replayMatch ${matchId} exceeded ${MAX_REPLAY_ITERS} iterations`);
    }
    const key = `${world.liveTick}:${world.stoppageSeq}`;
    const stored = dirsAt.get(key);
    if (stored) dirsAt.delete(key);
    const applied = applyStoredDirectives(world, stored, homeDir, awayDir);
    homeDir = applied.home;
    awayDir = applied.away;
    const stepEvents = advanceWorld(world, { home: homeDir, away: awayDir }, rng);
    iters += 1;
    yield { world, events: [...applied.events, ...stepEvents] };
    if (opts.toTick !== undefined && world.liveTick >= opts.toTick) return;
  }
}

/** DESIGN §14: `Generator<WorldState>`. First yield is the opening faceoff world. */
export function* replayMatch(matchId: string, db: Db, opts: ReplayOpts = {}): Generator<WorldState> {
  for (const step of replaySteps(matchId, db, opts)) {
    yield step.world;
  }
}

export function collectReplayEvents(matchId: string, db: Db, opts: ReplayOpts = {}): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (const step of replaySteps(matchId, db, opts)) {
    out.push(...step.events);
  }
  return out;
}

export function eventStreamHash(events: readonly MatchEvent[]): string {
  const rows = events.map((e) => ({
    type: e.type,
    liveTick: e.liveTick,
    stoppageSeq: e.stoppageSeq,
    xG: e.xG ?? null,
  }));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
