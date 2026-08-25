import type { Side } from "../types/hockey.ts";
import type { IceIntent } from "./types.ts";
export type { IceF1Action, IceIntent, IceRole } from "./types.ts";
export { ICE_F1_ACTIONS, ICE_ROLES } from "./types.ts";
import { GOAL_LINE_X, BLUE_LINE_X, HASH_OFFSET_Y, projectInsideRink } from "../engine/rink.ts";
import {
  creaseTarget,
  inOwnCrease,
  nearestSkaterToPuck,
  routeClearOfOwnNet,
} from "../engine/tactics.ts";
import { isGoalie, type Body, type WorldState } from "../engine/world.ts";

const FWD = new Set(["C", "LW", "RW"]);
const DEF = new Set(["LD", "RD"]);

function distPuck(world: WorldState, b: Body): number {
  const p = world.puck.pos;
  return Math.hypot(b.pos.x - p.x, b.pos.y - p.y);
}

function onIceSkaters(world: WorldState, side: Side): Body[] {
  const out: Body[] = [];
  for (const id of world.onIce[side]) {
    const b = world.bodies[id];
    if (b && !isGoalie(b)) out.push(b);
  }
  return out;
}

function sortByPuck(world: WorldState, bodies: Body[]): Body[] {
  return [...bodies].sort((a, b) => {
    const d = distPuck(world, a) - distPuck(world, b);
    if (Math.abs(d) > 1e-9) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Observer-relative: +X along this side's attack. */
export function zoneAlongAttack(puckX: number, dir: 1 | -1): "DZ" | "NZ" | "OZ" {
  const along = puckX * dir;
  if (along > BLUE_LINE_X) return "OZ";
  if (along < -BLUE_LINE_X) return "DZ";
  return "NZ";
}

/**
 * Five-man geometry. F1 hunts or carries; F2 support-below; F3 slot;
 * Ds gaps the puck; Dw weak-side high. Goalie crease.
 */
export function computeIceIntent(world: WorldState, side: Side): IceIntent {
  const dir = world.attackingDir[side];
  const puck = world.puck.pos;
  const intent: IceIntent = { roles: {}, targets: {} };
  const skaters = onIceSkaters(world, side);
  const fwds = sortByPuck(
    world,
    skaters.filter((b) => FWD.has(b.position)),
  );
  const ds = sortByPuck(
    world,
    skaters.filter((b) => DEF.has(b.position)),
  );

  const possessor = world.puck.possessor ? world.bodies[world.puck.possessor] : undefined;
  const weHaveIt = possessor?.side === side && possessor && !isGoalie(possessor);
  const f1 =
    weHaveIt && possessor
      ? possessor
      : nearestSkaterToPuck(world, side) ?? fwds[0] ?? skaters[0];

  if (f1) {
    intent.f1 = f1.id;
    intent.roles[f1.id] = "F1";
    if (world.puck.possessor !== f1.id) {
      intent.f1Action = "hunt";
      if (!inOwnCrease(world, side, puck)) {
        intent.targets[f1.id] = { x: puck.x, y: puck.y };
      }
    } else {
      const z = zoneAlongAttack(puck.x, dir);
      intent.f1Action = z === "OZ" ? "shoot" : z === "DZ" ? "clear" : "pass";
    }
  }

  const restF = fwds.filter((b) => b.id !== f1?.id);
  const f2 = restF[0];
  const f3 = restF[1];
  if (f2) {
    intent.roles[f2.id] = "F2";
    intent.targets[f2.id] = projectInsideRink({ x: puck.x - dir * 12, y: puck.y }, f2.radius).pos;
  }
  if (f3) {
    intent.roles[f3.id] = "F3";
    const slotY = (puck.y >= 0 ? -1 : 1) * 10;
    intent.targets[f3.id] = projectInsideRink({ x: dir * (GOAL_LINE_X - 16), y: slotY }, f3.radius).pos;
  }

  const dsBody = ds[0];
  const dwBody = ds[1];
  if (dsBody) {
    intent.roles[dsBody.id] = "Ds";
    const gapX = puck.x - dir * 18;
    const ownBlue = -dir * BLUE_LINE_X;
    const x = dir > 0 ? Math.max(ownBlue, gapX) : Math.min(ownBlue, gapX);
    intent.targets[dsBody.id] = projectInsideRink({ x, y: puck.y * 0.4 }, dsBody.radius).pos;
  }
  if (dwBody) {
    intent.roles[dwBody.id] = "Dw";
    const weakY = puck.y >= 0 ? -HASH_OFFSET_Y : HASH_OFFSET_Y;
    intent.targets[dwBody.id] = projectInsideRink({ x: -dir * (BLUE_LINE_X - 4), y: weakY }, dwBody.radius).pos;
  }

  for (const id of world.onIce[side]) {
    const g = world.bodies[id];
    if (!g || !isGoalie(g)) continue;
    intent.roles[g.id] = "G";
    intent.targets[g.id] = creaseTarget(world, g);
  }

  for (const id of Object.keys(intent.targets)) {
    const b = world.bodies[id];
    const t = intent.targets[id];
    if (!b || !t) continue;
    intent.targets[id] = routeClearOfOwnNet(world, b, t);
  }
  return intent;
}
