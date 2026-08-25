import type { ContactKind, Vec2 } from "../types/hockey.ts";
import type { PlayerId } from "../types/ids.ts";
import type { Rng } from "./rng.ts";
import { DT, RINK_HALF_LENGTH, RINK_HALF_WIDTH, projectInsideRink } from "./rink.ts";
import {
  isGoalie,
  onIceBodies,
  type Body,
  type WorldState,
} from "./world.ts";

export const SKATER_MAX_SPEED = 32;
export const GOALIE_MAX_SPEED = 18;
export const PUCK_MAX_SPEED = 150;
export const SKATER_CRUISE = 22;
export const GOALIE_CRUISE = 10;
export const SKATER_MAX_ACCEL = 14;
export const GOALIE_MAX_ACCEL = 10;
export const SKATER_TURN_RATE = 4.5;
export const GOALIE_TURN_RATE = 5.0;
export const PUCK_FRICTION_TAU = 1.35;
export const BODY_RESTITUTION = 0.15;
export const PUCK_BOARD_RESTITUTION = 0.55;
export const PUCK_GOALIE_RESTITUTION = 0.35;
export const STICK_REACH = 6.5;
export const FACING_DEG = 70;
export const FACING_RAD = (FACING_DEG * Math.PI) / 180;
export const PUCK_RADIUS = 0.5;
export const PUCK_MASS = 0.1;
export const STICK_HOLD = 3.2;
const LATERAL_TAU = 0.25;
const PAIR_ITERS = 2;

export type ContactEvent = {
  kind: ContactKind;
  a: PlayerId | "puck";
  b: PlayerId | "puck";
};

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function hypotVec(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clampMag(v: Vec2, max: number): Vec2 {
  const m = hypotVec(v);
  if (m <= max || m === 0) return { x: v.x, y: v.y };
  const s = max / m;
  return { x: v.x * s, y: v.y * s };
}

export function headingVec(heading: number): Vec2 {
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

export function shortestAngle(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function turnToward(heading: number, target: number, maxTurn: number): number {
  const d = shortestAngle(heading, target);
  const clamped = Math.max(-maxTurn, Math.min(maxTurn, d));
  return heading + clamped;
}

export function angleTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function isFacing(body: Body, target: Vec2, maxRad = FACING_RAD): boolean {
  const a = angleTo(body.pos, target);
  return Math.abs(shortestAngle(body.heading, a)) <= maxRad;
}

/** Tired skating floor: fatigue 1 → 70% of max/cruise. */
export const FATIGUE_SPEED_FLOOR = 0.7;

export function fatigueSpeedFactor(fatigue: number): number {
  const f = Math.max(0, Math.min(1, fatigue));
  return 1 - (1 - FATIGUE_SPEED_FLOOR) * f;
}

export function maxSpeedOf(body: Body, fatigue = 0): number {
  const base = isGoalie(body) ? GOALIE_MAX_SPEED : SKATER_MAX_SPEED;
  return base * fatigueSpeedFactor(fatigue);
}

export function cruiseOf(body: Body, fatigue = 0): number {
  const base = isGoalie(body) ? GOALIE_CRUISE : SKATER_CRUISE;
  return base * fatigueSpeedFactor(fatigue);
}

export function maxAccelOf(body: Body): number {
  return isGoalie(body) ? GOALIE_MAX_ACCEL : SKATER_MAX_ACCEL;
}

export function turnRateOf(body: Body): number {
  return isGoalie(body) ? GOALIE_TURN_RATE : SKATER_TURN_RATE;
}

export function collideRink(pos: Vec2, vel: Vec2, radius: number, restitution: number): boolean {
  const hit = projectInsideRink(pos, radius);
  pos.x = hit.pos.x;
  pos.y = hit.pos.y;
  if (!hit.normal) return false;
  const vn = dot(vel, hit.normal);
  if (vn > 0) {
    const s = (1 + restitution) * vn;
    vel.x -= s * hit.normal.x;
    vel.y -= s * hit.normal.y;
  }
  return true;
}

function separateAndImpulse(
  a: { pos: Vec2; vel: Vec2; radius: number; mass: number },
  b: { pos: Vec2; vel: Vec2; radius: number; mass: number },
  restitution: number,
): boolean {
  const delta = sub(b.pos, a.pos);
  let d = hypotVec(delta);
  const minD = a.radius + b.radius;
  let n: Vec2;
  if (d === 0) {
    n = { x: 1, y: 0 };
    d = 1e-9;
  } else {
    n = { x: delta.x / d, y: delta.y / d };
  }
  const overlap = minD - d;
  if (overlap <= 0) return false;

  const invA = 1 / a.mass;
  const invB = 1 / b.mass;
  const invSum = invA + invB;
  const corrA = overlap * (invA / invSum);
  const corrB = overlap * (invB / invSum);
  a.pos.x -= n.x * corrA;
  a.pos.y -= n.y * corrA;
  b.pos.x += n.x * corrB;
  b.pos.y += n.y * corrB;

  const reln = (b.vel.x - a.vel.x) * n.x + (b.vel.y - a.vel.y) * n.y;
  if (reln < 0) {
    const j = (-(1 + restitution) * reln) / invSum;
    a.vel.x -= (j * invA) * n.x;
    a.vel.y -= (j * invA) * n.y;
    b.vel.x += (j * invB) * n.x;
    b.vel.y += (j * invB) * n.y;
  }
  return true;
}

export function collideBodies(bodies: Body[]): ContactEvent[] {
  const contacts: ContactEvent[] = [];
  const seen = new Set<string>();
  for (let iter = 0; iter < PAIR_ITERS; iter++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b) continue;
        if (separateAndImpulse(a, b, BODY_RESTITUTION) && iter === 0) {
          const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            contacts.push({ kind: "body-body", a: a.id, b: b.id });
          }
        }
      }
    }
  }
  return contacts;
}

function classifyPuckPlayer(body: Body, puckPos: Vec2): ContactKind {
  if (isFacing(body, puckPos)) return "stick-puck";
  const a = angleTo(body.pos, puckPos);
  const ang = Math.abs(shortestAngle(body.heading, a));
  return ang > Math.PI / 2 ? "skate-puck" : "body-puck";
}

export function collidePuckPlayers(world: WorldState): ContactEvent[] {
  const contacts: ContactEvent[] = [];
  const puck = {
    pos: world.puck.pos,
    vel: world.puck.vel,
    radius: PUCK_RADIUS,
    mass: PUCK_MASS,
  };
  for (const body of onIceBodies(world)) {
    if (world.puck.possessor === body.id) continue;
    const before = dist(body.pos, world.puck.pos);
    if (before >= body.radius + PUCK_RADIUS) continue;
    const kind = classifyPuckPlayer(body, world.puck.pos);
    const rest = isGoalie(body) ? PUCK_GOALIE_RESTITUTION : BODY_RESTITUTION;
    separateAndImpulse(body, puck, rest);
    if (isGoalie(body)) applyReboundControl(body, puck);
    contacts.push({ kind, a: body.id, b: "puck" });
  }
  return contacts;
}

/** Pull the rebound toward the nearest corner in proportion to reboundControl (0–100). */
function applyReboundControl(goalie: Body, puck: { pos: Vec2; vel: Vec2 }): void {
  const rc = goalie.attributes?.reboundControl;
  if (rc === undefined || rc <= 0) return;
  const speed = hypotVec(puck.vel);
  if (speed < 1e-6) return;
  const ySign = puck.pos.y < 0 ? -1 : 1;
  const xSign = goalie.pos.x >= 0 ? 1 : -1;
  const corner = { x: xSign * RINK_HALF_LENGTH, y: ySign * RINK_HALF_WIDTH };
  const toCorner = sub(corner, puck.pos);
  const mag = hypotVec(toCorner);
  if (mag < 1e-6) return;
  const blend = Math.min(1, rc / 100);
  const mx = puck.vel.x / speed * (1 - blend) + (toCorner.x / mag) * blend;
  const my = puck.vel.y / speed * (1 - blend) + (toCorner.y / mag) * blend;
  const mm = Math.hypot(mx, my);
  if (mm < 1e-6) return;
  puck.vel.x = (mx / mm) * speed;
  puck.vel.y = (my / mm) * speed;
}

export function stickBodyContacts(world: WorldState): ContactEvent[] {
  const bodies = onIceBodies(world);
  const contacts: ContactEvent[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    if (!a) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      if (!b) continue;
      const d = dist(a.pos, b.pos);
      if (d >= STICK_REACH || d <= a.radius + b.radius) continue;
      const rel = hypotVec(sub(a.vel, b.vel));
      if (rel < 6) continue;
      const aFaces = isFacing(a, b.pos);
      const bFaces = isFacing(b, a.pos);
      if (!aFaces && !bFaces) continue;
      contacts.push({ kind: "stick-body", a: a.id, b: b.id });
    }
  }
  return contacts;
}

export function desiredVelocity(world: WorldState, body: Body, target: Vec2): Vec2 {
  const fatigue = world.fatigue[body.id] ?? 0;
  const race = world.icingRace;
  if (race && (body.id === race.defenderId || body.id === race.attackerId)) {
    const delta = sub(race.dot, body.pos);
    const d = hypotVec(delta);
    if (d < 0.5) return { x: 0, y: 0 };
    const speed = maxSpeedOf(body, fatigue);
    return { x: (delta.x / d) * speed, y: (delta.y / d) * speed };
  }
  const possessor = world.puck.possessor === body.id;
  const cap = possessor ? maxSpeedOf(body, fatigue) : cruiseOf(body, fatigue);
  const delta = sub(target, body.pos);
  const d = hypotVec(delta);
  if (d < 1.5) return { x: 0, y: 0 };
  const speed = Math.min(cap, d * 4);
  return { x: (delta.x / d) * speed, y: (delta.y / d) * speed };
}

export function integrateBody(world: WorldState, body: Body, target: Vec2, dt: number = DT): void {
  const fatigue = world.fatigue[body.id] ?? 0;
  const desired = desiredVelocity(world, body, target);
  const accel = clampMag(scale(sub(desired, body.vel), 1 / dt), maxAccelOf(body));
  body.vel.x += accel.x * dt;
  body.vel.y += accel.y * dt;
  body.vel = clampMag(body.vel, maxSpeedOf(body, fatigue));

  const fwd = headingVec(body.heading);
  const along = dot(body.vel, fwd);
  const lat = sub(body.vel, scale(fwd, along));
  const damp = Math.exp(-dt / LATERAL_TAU);
  body.vel.x = fwd.x * along + lat.x * damp;
  body.vel.y = fwd.y * along + lat.y * damp;

  body.pos.x += body.vel.x * dt;
  body.pos.y += body.vel.y * dt;

  const aim =
    hypotVec(desired) > 0.4
      ? Math.atan2(desired.y, desired.x)
      : angleTo(body.pos, world.puck.pos);
  body.heading = turnToward(body.heading, aim, turnRateOf(body) * dt);
}

export function integratePuck(world: WorldState, dt: number = DT): void {
  const damp = Math.exp(-dt / PUCK_FRICTION_TAU);
  world.puck.vel.x *= damp;
  world.puck.vel.y *= damp;
  world.puck.vel = clampMag(world.puck.vel, PUCK_MAX_SPEED);
  world.puck.pos.x += world.puck.vel.x * dt;
  world.puck.pos.y += world.puck.vel.y * dt;
}

export function attachPuckToStick(world: WorldState): void {
  const id = world.puck.possessor;
  if (!id) return;
  const body = world.bodies[id];
  if (!body) return;
  const fwd = headingVec(body.heading);
  world.puck.pos.x = body.pos.x + fwd.x * STICK_HOLD;
  world.puck.pos.y = body.pos.y + fwd.y * STICK_HOLD;
  world.puck.vel.x = body.vel.x;
  world.puck.vel.y = body.vel.y;
  collideRink(world.puck.pos, world.puck.vel, PUCK_RADIUS, PUCK_BOARD_RESTITUTION);
}

function pickTied(candidates: Body[], rng: Rng): Body {
  if (candidates.length === 1) {
    const only = candidates[0];
    if (only) return only;
  }
  const i = Math.min(candidates.length - 1, Math.floor(rng.next() * candidates.length));
  const chosen = candidates[i] ?? candidates[0];
  if (!chosen) {
    throw new Error("pickTied: empty candidate list");
  }
  return chosen;
}

/**
 * Stick possession: reach 6.5 ft AND facing ≤ 70°.
 * Nobody facing → loose puck; lastStick is unchanged. Closest facing wins; tie → RNG.
 */
export function updatePossession(world: WorldState, rng: Rng): void {
  const puckPos = world.puck.pos;
  const facing: Body[] = [];
  for (const body of onIceBodies(world)) {
    if (dist(body.pos, puckPos) > STICK_REACH) continue;
    if (isFacing(body, puckPos)) facing.push(body);
  }
  if (facing.length === 0) {
    world.puck.possessor = null;
    return;
  }
  facing.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let bestD = Infinity;
  let best: Body[] = [];
  for (const b of facing) {
    const d = dist(b.pos, puckPos);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = [b];
    } else if (Math.abs(d - bestD) <= 1e-9) {
      best.push(b);
    }
  }
  const winner = pickTied(best, rng);
  world.puck.possessor = winner.id;
  world.puck.lastStick = winner.id;
}
