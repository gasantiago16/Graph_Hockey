import { makeEventId } from "../types/ids.ts";
import type { TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Phase, Zone } from "../types/hockey.ts";
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
import { tickFatigue } from "./fatigue.ts";
import {
  applyLiveRules,
  applyOtRoster,
  applyPersonnel,
  captureSnapshot,
  completeFaceoff,
  notePuckContact,
  prepareFaceoff,
  STICK_HEIGHT_DEFAULT,
  stickHeightOf,
  tickPenaltyClocks,
} from "./rules.ts";
import { steeringTarget } from "./tactics.ts";
import { isGoalie, LAST_EVENTS_CAP, onIceBodies, type WorldState } from "./world.ts";

export function clockRuns(
  phase: Phase,
): phase is "live" | "delayed_offside" | "delayed_penalty" {
  return phase === "live" || phase === "delayed_offside" || phase === "delayed_penalty";
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
    const body = actor ? world.bodies[actor] : undefined;
    const stickHeight = body ? stickHeightOf(body) : STICK_HEIGHT_DEFAULT;
    pushEvent(world, collected, {
      type: "Contact",
      actor,
      possessor: world.puck.possessor,
      payload: { kind: c.kind, a: c.a, b: c.b, stickHeight },
    });
    if (actor && (c.kind === "stick-puck" || c.kind === "skate-puck" || c.kind === "body-puck")) {
      notePuckContact(world, c.kind, actor, stickHeight);
    }
  }
}

function emitGoalieSaves(world: WorldState, collected: MatchEvent[], contacts: ContactEvent[]): void {
  let saved = false;
  for (const c of contacts) {
    const actor = c.a === "puck" ? (c.b === "puck" ? undefined : c.b) : c.a;
    if (!actor) continue;
    const body = world.bodies[actor];
    if (!body || !isGoalie(body)) continue;
    if (saved) continue;
    saved = true;
    world.lastSaveLiveTick = world.liveTick;
    const lastShot = [...world.lastEvents].reverse().find((e) => e.type === "Shot");
    pushEvent(world, collected, {
      type: "Save",
      actor,
      xG: lastShot?.xG,
      payload: { side: body.side },
    });
    pushEvent(world, collected, {
      type: "Rebound",
      actor,
      payload: { side: body.side },
    });
  }
}

export function stepLive(world: WorldState, dt: number, rng: Rng): MatchEvent[] {
  const events: MatchEvent[] = [];
  const prev = captureSnapshot(world);
  world.clockRemaining = Math.max(0, world.clockRemaining - dt);
  world.liveTick += 1;

  const emit: (partial: Omit<MatchEvent, "id" | "seq" | "liveTick" | "stoppageSeq" | "period">) => MatchEvent = (
    partial,
  ) => pushEvent(world, events, partial);

  tickFatigue(world, dt);
  tickPenaltyClocks(world, dt);
  applyPersonnel(world, emit);

  const bodies = onIceBodies(world);
  const targets = bodies.map((body) => steeringTarget(world, body));
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const target = targets[i];
    if (!body || !target) continue;
    integrateBody(world, body, target, dt);
  }

  if (world.puck.possessor) {
    attachPuckToStick(world);
  } else {
    integratePuck(world, dt);
  }

  const bodyContacts = collideBodies(bodies);
  emitContacts(world, events, bodyContacts);
  const puckContacts = collidePuckPlayers(world);
  emitContacts(world, events, puckContacts);
  emitGoalieSaves(world, events, puckContacts);

  for (const body of bodies) {
    collideRink(body.pos, body.vel, body.radius, BODY_RESTITUTION);
  }
  collideRink(world.puck.pos, world.puck.vel, PUCK_RADIUS, PUCK_BOARD_RESTITUTION);
  collideBodies(bodies);
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

  const stickContacts = stickBodyContacts(world);
  emitContacts(world, events, stickContacts);

  applyLiveRules(world, rng, prev, emit, dt, puckContacts, [...bodyContacts, ...stickContacts]);
  return events;
}

export function setupFaceoff(world: WorldState): MatchEvent[] {
  const events: MatchEvent[] = [];
  prepareFaceoff(world, (partial) => pushEvent(world, events, partial));
  return events;
}

export function resolveFaceoff(world: WorldState, rng: Rng): MatchEvent[] {
  const events: MatchEvent[] = [];
  completeFaceoff(world, rng, (partial) => pushEvent(world, events, partial));
  return events;
}

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
  world.icingTrack = null;
  world.delayedOffside = null;
  world.delayedPenalty = null;
  if (next === "OT") applyOtRoster(world);
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
  if (clockRuns(world.phase)) {
    return stepLive(world, DT, rng);
  }
  switch (world.phase) {
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
