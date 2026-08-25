import type { Side, Vec2 } from "../types/hockey.ts";
import { dist, dot, hypotVec, sub } from "./physics.ts";
import { GOAL_LINE_X } from "./rink.ts";
import { isGoalie, onIceBodies, type Body, type WorldState } from "./world.ts";

export type XgFeatures = {
  distanceFt: number;
  angleFactor: number;
  pressure: number;
  traffic: 0 | 1;
  rebound: 0 | 1;
  rush: 0 | 1;
  pp: 0 | 1;
  sh: 0 | 1;
};

const REBOUND_TICKS = 15; // 1.5 s at 10 Hz
const RUSH_TICKS = 25; // 2.5 s
const CORRIDOR_HALF = 3; // 6 ft-wide corridor

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function normalize(v: Vec2): Vec2 | null {
  const m = hypotVec(v);
  if (m < 1e-9) return null;
  return { x: v.x / m, y: v.y / m };
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < 1e-12) return dist(p, a);
  const t = clamp(dot(sub(p, a), ab) / len2, 0, 1);
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

function skaterCounts(strength: string): { home: number; away: number } {
  const parts = strength.split("v");
  return { home: Number(parts[0]), away: Number(parts[1]) };
}

export function attackingNet(world: WorldState, side: Side): Vec2 {
  return { x: world.attackingDir[side] * GOAL_LINE_X, y: 0 };
}

export function xgLogit(f: XgFeatures): number {
  return (
    -0.85 -
    0.045 * f.distanceFt -
    1.8 * (1 - f.angleFactor) -
    0.55 * f.pressure -
    0.35 * f.traffic +
    0.55 * f.rebound +
    0.4 * f.rush +
    0.25 * f.pp -
    0.4 * f.sh
  );
}

export function xgFromLogit(logit: number): number {
  return clamp(1 / (1 + Math.exp(-logit)), 0.01, 0.95);
}

export function xgFromFeatures(f: XgFeatures): number {
  return xgFromLogit(xgLogit(f));
}

export function shotFeatures(
  world: WorldState,
  shooter: Body,
  shotVel: Vec2,
  shotPos: Vec2,
): XgFeatures {
  const net = attackingNet(world, shooter.side);
  const distanceFt = dist(shotPos, net);
  const nVel = normalize(shotVel);
  const nAim = normalize(sub(net, shooter.pos));
  const angleFactor = nVel && nAim ? Math.abs(dot(nVel, nAim)) : 0;

  let nearest = Infinity;
  let traffic: 0 | 1 = 0;
  for (const b of onIceBodies(world)) {
    if (b.side === shooter.side || b.id === shooter.id || isGoalie(b)) continue;
    const d = dist(b.pos, shooter.pos);
    if (d < nearest) nearest = d;
    if (distToSegment(b.pos, shooter.pos, net) <= CORRIDOR_HALF) traffic = 1;
  }
  const pressure = nearest === Infinity ? 0 : clamp(1 - nearest / 8, 0, 1);

  // Rebound-after-Save means lastEvents[-1] is never Save; lastEvents is also a 32-cap ring.
  const rebound: 0 | 1 =
    world.lastSaveLiveTick !== null &&
    world.lastSaveLiveTick < world.liveTick &&
    world.liveTick - world.lastSaveLiveTick <= REBOUND_TICKS
      ? 1
      : 0;
  const entryTick = world.lastZoneEntryBySide[shooter.side];
  const rush: 0 | 1 =
    entryTick !== null && world.liveTick - entryTick <= RUSH_TICKS ? 1 : 0;

  const counts = skaterCounts(world.strength);
  const us = shooter.side === "home" ? counts.home : counts.away;
  const them = shooter.side === "home" ? counts.away : counts.home;
  const pp: 0 | 1 = us > them ? 1 : 0;
  const sh: 0 | 1 = us < them ? 1 : 0;

  return { distanceFt, angleFactor, pressure, traffic, rebound, rush, pp, sh };
}

export function shotXg(world: WorldState, shooter: Body, shotVel: Vec2, shotPos: Vec2): number {
  return xgFromFeatures(shotFeatures(world, shooter, shotVel, shotPos));
}
