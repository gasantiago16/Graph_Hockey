import { makeEventId } from "../types/ids.ts";
import type { TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Phase, Vec2, Zone } from "../types/hockey.ts";
import { BLUE_LINE_X, CENTER_ICE, DT, OT_SECONDS, PERIOD_SECONDS, attackingDir } from "./rink.ts";
import type { Rng } from "./rng.ts";
import {
  attachPuckToStick,
  BODY_RESTITUTION,
  collideBodies,
  collidePuckPlayers,
  collideRink,
  integrateBody,
  integratePuck,
  PUCK_BOARD_RESTITUTION,
  PUCK_RADIUS,
  stickBodyContacts,
  updatePossession,
  type ContactEvent,
} from "./physics.ts";
import {
  findBySlot,
  LAST_EVENTS_CAP,
  onIceBodies,
  type WorldState,
} from "./world.ts";

const PHYSICS_PHASES: ReadonlySet<Phase> = new Set(["live", "delayed_offside", "delayed_penalty"]);

export function clockRuns(phase: Phase): boolean {
  return PHYSICS_PHASES.has(phase);
}

function zoneFromPuck(world: WorldState): Zone {
  const x = world.puck.pos.x * world.attackingDir.home;
  if (x > BLUE_LINE_X) return "OZ";
  if (x < -BLUE_LINE_X) return "DZ";
  return "NZ";
}

function pushEvent(
  world: WorldState,
  collected: MatchEvent[],
  partial: Omit<MatchEvent, "id" | "seq" | "liveTick" | "stoppageSeq" | "period">,
): MatchEvent {
  const seq = (world.lastEvents.at(-1)?.seq ?? -1) + 1;
  const ev: MatchEvent = {
    id: makeEventId(world.matchId, seq),
    seq,
    liveTick: world.liveTick,
    stoppageSeq: world.stoppageSeq,
    period: world.period,
    zone: partial.zone ?? zoneFromPuck(world),
    pos: partial.pos ?? { x: world.puck.pos.x, y: world.puck.pos.y },
    ...partial,
  };
  world.lastEvents.push(ev);
  if (world.lastEvents.length > LAST_EVENTS_CAP) {
    world.lastEvents.splice(0, world.lastEvents.length - LAST_EVENTS_CAP);
  }
  collected.push(ev);
  return ev;
}

function emitContacts(world: WorldState, collected: MatchEvent[], contacts: ContactEvent[]): void {
  for (const c of contacts) {
    const actor = c.a === "puck" ? (c.b === "puck" ? undefined : c.b) : c.a;
    pushEvent(world, collected, {
      type: "Contact",
      actor,
      possessor: world.puck.possessor,
      payload: { kind: c.kind, a: c.a, b: c.b },
    });
  }
}

export function stepLive(world: WorldState, dt: number, rng: Rng): MatchEvent[] {
  const events: MatchEvent[] = [];
  world.clockRemaining = Math.max(0, world.clockRemaining - dt);
  world.liveTick += 1;

  const bodies = onIceBodies(world);
  for (const body of bodies) {
    integrateBody(world, body);
  }

  if (world.puck.possessor) {
    attachPuckToStick(world);
  } else {
    integratePuck(world);
  }

  emitContacts(world, events, collideBodies(bodies));
  emitContacts(world, events, collidePuckPlayers(world));

  for (const body of bodies) {
    collideRink(body.pos, body.vel, body.radius, BODY_RESTITUTION);
  }
  collideRink(world.puck.pos, world.puck.vel, PUCK_RADIUS, PUCK_BOARD_RESTITUTION);

  const prevPossessor = world.puck.possessor;
  updatePossession(world, rng);
  if (world.puck.possessor !== prevPossessor) {
    pushEvent(world, events, {
      type: "PossessionChange",
      possessor: world.puck.possessor,
      actor: world.puck.possessor ?? prevPossessor ?? undefined,
    });
    if (world.puck.possessor) {
      emitContacts(world, events, [{ kind: "stick-puck", a: world.puck.possessor, b: "puck" }]);
    }
  }

  if (world.puck.possessor) {
    attachPuckToStick(world);
  }

  emitContacts(world, events, stickBodyContacts(world));
  return events;
}

/** Stub: park at the current/center spot and go to faceoff_drop. Full spots are PR4. */
export function setupFaceoff(world: WorldState): MatchEvent[] {
  const events: MatchEvent[] = [];
  if (!world.faceoffSpot) {
    world.faceoffSpot = { x: CENTER_ICE.x, y: CENTER_ICE.y };
  }
  if (world.whistle) {
    pushEvent(world, events, { type: "Whistle", payload: { kind: world.whistle } });
  }
  world.phase = "faceoff_drop";
  for (const body of onIceBodies(world)) {
    body.vel.x = 0;
    body.vel.y = 0;
  }
  world.puck.vel.x = 0;
  world.puck.vel.y = 0;
  return events;
}

/** Stub: home center wins, phase live. Full FO attributes/spots are PR4. */
export function resolveFaceoff(world: WorldState, _rng: Rng): MatchEvent[] {
  const events: MatchEvent[] = [];
  world.stoppageSeq += 1;
  const spot: Vec2 = world.faceoffSpot ?? CENTER_ICE;
  world.puck.pos.x = spot.x;
  world.puck.pos.y = spot.y;
  world.puck.vel.x = 0;
  world.puck.vel.y = 0;

  const center = findBySlot(world, "home", "C") ?? onIceBodies(world).find((b) => b.side === "home");
  world.puck.possessor = center?.id ?? null;
  world.puck.lastStick = center?.id ?? null;
  world.whistle = null;
  world.phase = "live";
  world.icingRace = null;
  world.delayedOffside = null;

  pushEvent(world, events, {
    type: "FaceoffWin",
    actor: center?.id,
    possessor: world.puck.possessor,
    pos: { x: spot.x, y: spot.y },
  });
  return events;
}

/** Stub period switch. OT 3v3 roster swap is later. */
export function startNextPeriod(world: WorldState): MatchEvent[] {
  const events: MatchEvent[] = [];
  if (world.period === "OT") {
    world.phase = "game_over";
    world.whistle = null;
    return events;
  }
  const next = world.period === 1 ? 2 : world.period === 2 ? 3 : "OT";
  world.period = next;
  world.clockRemaining = next === "OT" ? OT_SECONDS : PERIOD_SECONDS;
  world.liveTick = 0;
  world.attackingDir = attackingDir(next);
  world.phase = "faceoff_drop";
  world.whistle = null;
  world.faceoffSpot = { x: CENTER_ICE.x, y: CENTER_ICE.y };
  world.puck.pos.x = 0;
  world.puck.pos.y = 0;
  world.puck.vel.x = 0;
  world.puck.vel.y = 0;
  world.puck.possessor = null;
  world.icingRace = null;
  world.delayedOffside = null;
  world.delayedPenalty = null;
  return events;
}

/** Sole world mutator. Discrete stoppages do not run 10 Hz physics. */
export function advanceWorld(
  world: WorldState,
  dirs: { home: TeamDirective; away: TeamDirective },
  rng: Rng,
): MatchEvent[] {
  world.directives = dirs;
  world.playId = { home: dirs.home.playId, away: dirs.away.playId };
  switch (world.phase) {
    case "live":
    case "delayed_offside":
    case "delayed_penalty":
      return stepLive(world, DT, rng);
    case "whistle":
      return setupFaceoff(world);
    case "faceoff_drop":
      return resolveFaceoff(world, rng);
    case "intermission":
      return startNextPeriod(world);
    case "game_over":
      return [];
    default: {
      const _never: never = world.phase;
      return _never;
    }
  }
}
