import { defaultLineFor, onIceBodies, type Body, type WorldState } from "../engine/world.ts";
import { resolvePlay } from "../playbook/store.ts";
import type { Position, Roster } from "../types/hockey.ts";
import type { InspectSide, InspectState, SpectatorFrame } from "../types/ws.ts";

const FALLBACK_NUMBER: Record<Position, number> = {
  C: 19,
  LW: 9,
  RW: 14,
  LD: 4,
  RD: 5,
  G: 31,
};

export type SpectatorOpts = {
  rosters?: { home: Roster; away: Roster };
};

export function jerseyNumber(body: Body, rosters?: SpectatorOpts["rosters"]): number {
  const roster = rosters?.[body.side];
  if (roster) {
    const line = body.line ?? defaultLineFor(body.position);
    const hit = roster.players.find((p) => p.position === body.position && p.line === line);
    if (hit) return hit.number;
  }
  return FALLBACK_NUMBER[body.position];
}

/** World-frame public geometry. No playId, playbooks, directives, or RNG. */
export function spectatorFrame(world: WorldState, opts: SpectatorOpts = {}): SpectatorFrame {
  const last = world.lastEvents.at(-1);
  return {
    type: "snapshot",
    matchId: world.matchId,
    liveTick: world.liveTick,
    stoppageSeq: world.stoppageSeq,
    period: world.period,
    clockRemaining: world.clockRemaining,
    score: { home: world.score.home, away: world.score.away },
    strength: world.strength,
    phase: world.phase,
    puck: {
      x: world.puck.pos.x,
      y: world.puck.pos.y,
      vx: world.puck.vel.x,
      vy: world.puck.vel.y,
    },
    players: onIceBodies(world).map((b) => ({
      id: b.id,
      side: b.side,
      number: jerseyNumber(b, opts.rosters),
      position: b.position,
      x: b.pos.x,
      y: b.pos.y,
      heading: b.heading,
    })),
    lastEvent: last ? { id: last.id, type: last.type } : null,
  };
}

/** Inspected side only — never the opponent playId or the other book's plays. */
export function inspectState(world: WorldState, side: "home" | "away"): InspectState {
  const playId = world.playId[side];
  const play = resolvePlay(playId, world.playbooks?.[side]);
  return {
    type: "inspect",
    side,
    playName: play.name,
    playId,
    pressure: world.directives[side].pressure,
    strength: world.strength,
  };
}

/** `none` → no inspect message (rink + ticker + cost only). */
export function maybeInspectState(world: WorldState, inspectSide: InspectSide): InspectState | undefined {
  if (inspectSide === "home" || inspectSide === "away") return inspectState(world, inspectSide);
  return undefined;
}
