import type { TeamDirective } from "../types/directive.ts";
import {
  PUBLIC_EVENT_TYPES,
  type MatchEvent,
  type PublicEvent,
  type PublicEventType,
} from "../types/events.ts";
import type { Side, Vec2, Zone } from "../types/hockey.ts";
import type { Assignment, PublicPlayer, TeamObservation } from "../types/observation.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { BLUE_LINE_X } from "../engine/rink.ts";
import type { WorldState } from "../engine/world.ts";
import { observerStrength, toDigest, zoneForSide } from "../playbook/retrieve.ts";
import { resolvePlay } from "../playbook/store.ts";
import type { SideDecision } from "./epochs.ts";

const LAST_PUBLIC_EVENTS = 25;
const SKIP_PUBLIC_TYPES = new Set<string>(["Contact", "DirectiveApplied"]);

export function shouldMirror(world: WorldState, side: Side): boolean {
  return world.attackingDir[side] === -1;
}

/** Wrap heading to (−π, π]. */
export function wrapPi(heading: number): number {
  let h = heading;
  while (h <= -Math.PI) h += 2 * Math.PI;
  while (h > Math.PI) h -= 2 * Math.PI;
  return h;
}

export function mirrorVec(v: Vec2): Vec2 {
  return { x: -v.x, y: v.y };
}

export function maybeMirrorVec(v: Vec2, mirrorX: boolean): Vec2 {
  return mirrorX ? mirrorVec(v) : { x: v.x, y: v.y };
}

export function maybeMirrorHeading(heading: number, mirrorX: boolean): number {
  return wrapPi(mirrorX ? Math.PI - heading : heading);
}

export function zoneFromAttackingX(x: number): Zone {
  if (x > BLUE_LINE_X) return "OZ";
  if (x < -BLUE_LINE_X) return "DZ";
  return "NZ";
}

function isPublicEventType(type: string): type is PublicEventType {
  return (PUBLIC_EVENT_TYPES as readonly string[]).includes(type);
}

function toPublicEvent(event: MatchEvent, mirrorX: boolean): PublicEvent | null {
  if (!isPublicEventType(event.type) || SKIP_PUBLIC_TYPES.has(event.type)) return null;
  const pos = event.pos ? maybeMirrorVec(event.pos, mirrorX) : undefined;
  return {
    id: event.id,
    liveTick: event.liveTick,
    stoppageSeq: event.stoppageSeq,
    period: event.period,
    type: event.type,
    zone: pos ? zoneFromAttackingX(pos.x) : event.zone ?? "NZ",
    pos,
    possessor: event.possessor,
    actor: event.actor,
    xG: event.xG,
  };
}

function publicPlayers(world: WorldState, side: Side, mirrorX: boolean): PublicPlayer[] {
  const ids = [...world.onIce.home, ...world.onIce.away].sort();
  const out: PublicPlayer[] = [];
  for (const id of ids) {
    const body = world.bodies[id];
    if (!body) continue;
    out.push({
      id: body.id,
      side: body.side === side ? "us" : "them",
      number: 0,
      position: body.position,
      pos: maybeMirrorVec(body.pos, mirrorX),
      vel: maybeMirrorVec(body.vel, mirrorX),
      heading: maybeMirrorHeading(body.heading, mirrorX),
    });
  }
  return out;
}

function ourAssignments(world: WorldState, side: Side): Assignment[] {
  const play = resolvePlay(world.playId[side], world.playbooks?.[side]);
  const out: Assignment[] = [];
  for (const id of world.onIce[side]) {
    const body = world.bodies[id];
    if (!body) continue;
    const slot = play.formation.slots[body.position];
    out.push({
      playerId: id,
      slot: body.position,
      role: slot?.role ?? "support",
    });
  }
  return out;
}

function benchFatigue(world: WorldState, side: Side): Record<string, number> {
  const fatigue: Record<string, number> = {};
  for (const id of world.bench[side]) {
    fatigue[id] = world.fatigue[id] ?? 0;
  }
  return fatigue;
}

/**
 * Mirror geometry so the observing team always attacks +X.
 * Never includes the opponent's playId or assignments.
 */
export function observe(world: WorldState, side: Side, decision: SideDecision): TeamObservation {
  const them: Side = side === "home" ? "away" : "home";
  const mirrorX = shouldMirror(world, side);
  const play = resolvePlay(world.playId[side], world.playbooks?.[side]);
  const lastDirective: TeamDirective = world.directives[side];
  const lastEvents = world.lastEvents
    .map((e) => toPublicEvent(e, mirrorX))
    .filter((e): e is PublicEvent => e !== null)
    .slice(-LAST_PUBLIC_EVENTS);

  const book = world.playbooks?.[side];
  const digest = (book?.plays ?? []).filter((p) => p.status !== "retired").map(toDigest);

  return {
    matchId: world.matchId,
    epochReason: decision.reason,
    epochKind: decision.kind,
    period: world.period,
    clock: world.clockRemaining,
    score: { us: world.score[side], them: world.score[them] },
    strength: observerStrength(world, side),
    zone: zoneForSide(world, side),
    phase: world.phase,
    whistle: world.whistle,
    puck: {
      pos: maybeMirrorVec(world.puck.pos, mirrorX),
      vel: maybeMirrorVec(world.puck.vel, mirrorX),
      possessor: world.puck.possessor,
    },
    players: publicPlayers(world, side, mirrorX),
    lastEvents,
    zoneTime: { usOZ: 0, themOZ: 0, nz: 0 },
    onIce: { us: [...world.onIce[side]], them: [...world.onIce[them]] },
    penalties: { us: [...world.penalties[side]], them: [...world.penalties[them]] },
    timeoutLeft: { us: world.timeoutLeft[side], them: world.timeoutLeft[them] },
    goalieInNet: { us: world.goalieInNet[side], them: world.goalieInNet[them] },
    activePlay: { id: play.id, name: play.name, version: play.version },
    lastDirective,
    bench: { fatigue: benchFatigue(world, side) },
    playbookDigest: digest.length > 0 ? digest : [{ ...toDigest(play), id: play.id || DEFAULT_PLAY_ID }],
    scoutNotes: [],
    ourAssignments: ourAssignments(world, side),
  };
}
