import type { PlayParams } from "../types/directive.ts";
import type { Position, Side, ShotPolicy, Vec2 } from "../types/hockey.ts";
import type { FormationSlot, Landmark, Play, SlotRole } from "../types/play.ts";
import { resolvePlay } from "../playbook/store.ts";
import {
  BLUE_LINE_X,
  CREASE_RADIUS,
  END_ZONE_FACEOFF_X,
  GOAL_LINE_X,
  GOAL_WIDTH,
  HASH_OFFSET_Y,
  RINK_HALF_WIDTH,
  projectInsideRink,
} from "./rink.ts";
import { headingVec, STICK_REACH } from "./physics.ts";
import { DEFAULT_SLOTS, isGoalie, type Body, type WorldState } from "./world.ts";

export const PASS_RELEASE_SPEED = 55;
export const SHOT_RELEASE_SPEED = 72;
export const PASS_MIN_SEP = 8;
export const PASS_MAX_SEP = 48;
/** cos(heading vs release dir). ~0.75 ≈ 41°. */
export const RELEASE_FACING = 0.75;

const RECEIVE_ROLES = new Set<SlotRole>(["support", "weak-side", "net-front", "puck", "point"]);

export const UTILITY_TEMPERATURE = 0.15;

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function hypot(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function normalize(v: Vec2): Vec2 | null {
  const m = hypot(v);
  if (m < 1e-9) return null;
  return { x: v.x / m, y: v.y / m };
}

export function playForSide(world: WorldState, side: Side): Play {
  return resolvePlay(world.playId[side], world.playbooks?.[side]);
}

export function landmarkPos(world: WorldState, side: Side, landmark: Landmark): Vec2 {
  const dir = world.attackingDir[side];
  const puck = world.puck.pos;
  switch (landmark) {
    case "puck":
      return { x: puck.x, y: puck.y };
    case "net-us":
      return { x: -dir * GOAL_LINE_X, y: 0 };
    case "net-them":
      return { x: dir * GOAL_LINE_X, y: 0 };
    case "blue-atk":
      return { x: dir * BLUE_LINE_X, y: 0 };
    case "blue-def":
      return { x: -dir * BLUE_LINE_X, y: 0 };
    case "dot-strong": {
      const sy: 1 | -1 = puck.y < 0 ? -1 : 1;
      return { x: dir * END_ZONE_FACEOFF_X, y: sy * HASH_OFFSET_Y };
    }
    default: {
      const _never: never = landmark;
      return _never;
    }
  }
}

export function slotWorldTarget(world: WorldState, side: Side, slot: FormationSlot): Vec2 {
  const dir = world.attackingDir[side];
  const lm = landmarkPos(world, side, slot.landmark);
  return { x: lm.x + slot.rel.x * dir, y: lm.y + slot.rel.y };
}

function creaseDepthFt(world: WorldState, side: Side): number {
  const depth = world.directives[side].goalie?.creaseDepth ?? "mid";
  if (depth === "deep") return 1.4;
  if (depth === "challenge") return 5.2;
  return 3.2;
}

function clampCrease(pos: Vec2, net: Vec2, dir: 1 | -1, radius: number): Vec2 {
  let x = pos.x;
  let y = pos.y;
  const towardIce = dir;
  if ((x - net.x) * towardIce < 0.4) x = net.x + towardIce * 0.4;
  const maxY = GOAL_WIDTH / 2 + 1.5;
  if (y > maxY) y = maxY;
  if (y < -maxY) y = -maxY;
  const dx = x - net.x;
  const dy = y - net.y;
  const d = Math.hypot(dx, dy);
  const maxR = Math.max(1, CREASE_RADIUS - radius);
  if (d > maxR && d > 0) {
    const s = maxR / d;
    x = net.x + dx * s;
    y = net.y + dy * s;
  }
  return projectInsideRink({ x, y }, radius).pos;
}

/** Angle-bisector of puck-to-posts, parked at creaseDepth in front of our net. */
export function creaseTarget(world: WorldState, body: Body): Vec2 {
  const dir = world.attackingDir[body.side];
  const net = { x: -dir * GOAL_LINE_X, y: 0 };
  const postL = { x: net.x, y: GOAL_WIDTH / 2 };
  const postR = { x: net.x, y: -GOAL_WIDTH / 2 };
  const puck = world.puck.pos;
  const nL = normalize(sub(postL, puck));
  const nR = normalize(sub(postR, puck));
  const towardNet = nL && nR ? normalize({ x: nL.x + nR.x, y: nL.y + nR.y }) : normalize(sub(net, puck));
  const depth = creaseDepthFt(world, body.side);
  const targetX = net.x + dir * depth;
  if (!towardNet || Math.abs(towardNet.x) < 1e-6) {
    return clampCrease({ x: targetX, y: 0 }, net, dir, body.radius);
  }
  const t = (targetX - puck.x) / towardNet.x;
  if (t < 0) {
    return clampCrease({ x: targetX, y: 0 }, net, dir, body.radius);
  }
  return clampCrease(
    { x: puck.x + towardNet.x * t, y: puck.y + towardNet.y * t },
    net,
    dir,
    body.radius,
  );
}

function dumpTarget(world: WorldState, side: Side, spot: "strong-corner" | "weak-corner" | "soft-area"): Vec2 {
  const dir = world.attackingDir[side];
  const strong: 1 | -1 = world.puck.pos.y < 0 ? -1 : 1;
  const sy = spot === "weak-corner" ? ((-strong) as 1 | -1) : strong;
  if (spot === "soft-area") {
    return projectInsideRink({ x: dir * (BLUE_LINE_X + 8), y: sy * 28 }, 1.6).pos;
  }
  return projectInsideRink({ x: dir * (GOAL_LINE_X - 6), y: sy * (RINK_HALF_WIDTH - 10) }, 1.6).pos;
}

export function shotPolicyOf(world: WorldState, side: Side, play: Play): ShotPolicy {
  const params: PlayParams | undefined = world.directives[side].playParams;
  return params?.shotPolicy ?? play.assignments.shotPolicy;
}

/** LLM overlay only. Seed assignment pass/shoot still uses the old skate-to-net path (goldens). */
function overlayShotPolicy(world: WorldState, side: Side): ShotPolicy | undefined {
  return world.directives[side].playParams?.shotPolicy;
}

/** Nearest on-ice teammate who can take a pass. Goalies and gap/crease slots skipped. */
export function passReceiver(world: WorldState, carrier: Body): Body | undefined {
  const play = playForSide(world, carrier.side);
  let best: Body | undefined;
  let bestScore = Infinity;
  for (const id of world.onIce[carrier.side]) {
    if (id === carrier.id) continue;
    const mate = world.bodies[id];
    if (!mate || isGoalie(mate)) continue;
    const role = play.formation.slots[mate.position]?.role;
    if (role === "crease" || role === "gap") continue;
    const d = hypot(sub(mate.pos, carrier.pos));
    if (d < PASS_MIN_SEP || d > PASS_MAX_SEP) continue;
    const score = role && RECEIVE_ROLES.has(role) ? d : d + 20;
    if (score < bestScore) {
      bestScore = score;
      best = mate;
    }
  }
  return best;
}

function possessorTarget(world: WorldState, body: Body, play: Play): Vec2 {
  const dir = world.attackingDir[body.side];
  const overlay = overlayShotPolicy(world, body.side);
  const policy = overlay ?? play.assignments.shotPolicy;
  const dumpSpot = play.assignments.dumpSpot ?? "strong-corner";
  if (policy === "dump" || policy === "cycle") {
    return dumpTarget(world, body.side, dumpSpot);
  }
  if (policy === "hold") {
    const slot = play.formation.slots[body.position];
    if (slot && slot.role !== "puck") {
      return projectInsideRink(slotWorldTarget(world, body.side, slot), body.radius).pos;
    }
    return { x: body.pos.x, y: body.pos.y };
  }
  if (overlay === "pass") {
    const recv = passReceiver(world, body);
    if (recv) return { x: recv.pos.x, y: recv.pos.y };
  }
  return { x: dir * GOAL_LINE_X, y: 0 };
}

function facingRelease(body: Body, dest: Vec2): Vec2 | undefined {
  const to = sub(dest, body.pos);
  const mag = hypot(to);
  if (mag < 1e-6) return undefined;
  const n = { x: to.x / mag, y: to.y / mag };
  const face = headingVec(body.heading);
  if (face.x * n.x + face.y * n.y < RELEASE_FACING) return undefined;
  return n;
}

/**
 * Directed pass/shot: impulse the puck and clear possession.
 * dump/cycle/hold never release here (goldens).
 */
export function maybeReleasePuck(world: WorldState): boolean {
  const id = world.puck.possessor;
  if (!id) return false;
  const body = world.bodies[id];
  if (!body || isGoalie(body)) return false;
  const play = playForSide(world, body.side);
  const overlay = overlayShotPolicy(world, body.side);
  if (!overlay || overlay === "dump" || overlay === "cycle" || overlay === "hold") return false;

  let dest: Vec2;
  let speed: number;
  if (overlay === "pass") {
    const recv = passReceiver(world, body);
    if (!recv) return false;
    dest = recv.pos;
    speed = PASS_RELEASE_SPEED;
  } else {
    const dir = world.attackingDir[body.side];
    if (body.pos.x * dir < BLUE_LINE_X - 8) return false;
    dest = { x: dir * GOAL_LINE_X, y: 0 };
    speed = SHOT_RELEASE_SPEED;
  }

  const n = facingRelease(body, dest);
  if (!n) return false;
  const launch = STICK_REACH + 1.1;
  world.puck.possessor = null;
  world.puck.pos = { x: body.pos.x + n.x * launch, y: body.pos.y + n.y * launch };
  world.puck.vel = { x: n.x * speed, y: n.y * speed };
  return true;
}

function fallbackTarget(body: Body, dir: 1 | -1): Vec2 {
  const slot = DEFAULT_SLOTS[body.position];
  return { x: slot.x * dir, y: slot.y };
}

export function steeringTarget(world: WorldState, body: Body): Vec2 {
  const play = playForSide(world, body.side);
  const dir = world.attackingDir[body.side];
  const slot = play.formation.slots[body.position as Position];

  if (world.puck.possessor === body.id) {
    return possessorTarget(world, body, play);
  }

  if (isGoalie(body) && (!slot || slot.role === "crease")) {
    return creaseTarget(world, body);
  }

  if (!slot) {
    return projectInsideRink(fallbackTarget(body, dir), body.radius).pos;
  }

  if (slot.role === "crease") {
    return creaseTarget(world, body);
  }

  return projectInsideRink(slotWorldTarget(world, body.side, slot), body.radius).pos;
}

export function softmax(scores: readonly number[], temperature = UTILITY_TEMPERATURE): number[] {
  const t = Math.max(1e-6, temperature);
  let max = -Infinity;
  for (const s of scores) if (s > max) max = s;
  const exps = scores.map((s) => Math.exp((s - max) / t));
  let sum = 0;
  for (const e of exps) sum += e;
  if (sum <= 0) return scores.map(() => 1 / Math.max(1, scores.length));
  return exps.map((e) => e / sum);
}
