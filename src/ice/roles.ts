import type { Side } from "../types/hockey.ts";
import type { IceIntent } from "./types.ts";
export type { IceF1Action, IceIntent, IceRole } from "./types.ts";
export { ICE_F1_ACTIONS, ICE_ROLES } from "./types.ts";
import { GOAL_LINE_X, BLUE_LINE_X, CREASE_RADIUS, HASH_OFFSET_Y, projectInsideRink } from "../engine/rink.ts";
import {
  creaseTarget,
  inOwnCrease,
  nearestSkaterToPuck,
  OZ_ICE_SHOOT_ALONG,
  playForSide,
  routeClearOfOwnNet,
  shotPolicyOf,
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

/** Stay our side of the attacking blue until the puck is in. */
const ONSIDE_ALONG = BLUE_LINE_X - 4;
/** Puck far enough in that F2 may chase / outlet without leading the entry. */
const ESTABLISHED_OZ_ALONG = BLUE_LINE_X + 8;
const CREASE_KEEP_OUT = -GOAL_LINE_X + CREASE_RADIUS + 8;

function alongWorld(dir: 1 | -1, along: number, y: number, radius: number): { x: number; y: number } {
  return projectInsideRink({ x: dir * along, y }, radius).pos;
}

/**
 * Five-man geometry. F1 hunts or carries; F2 contests a loose puck (dump-and-chase),
 * outlets ahead on an established OZ carry (BLUE+8), else support-below; F3 slot; Ds gaps; Dw weak-side high.
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
  const z = zoneAlongAttack(puck.x, dir);
  const alongPuck = puck.x * dir;
  const taggingUp = world.delayedOffside?.attacking === side;
  const ozLive = z === "OZ" && !taggingUp;
  const f1 =
    weHaveIt && possessor
      ? possessor
      : nearestSkaterToPuck(world, side) ?? fwds[0] ?? skaters[0];

  if (f1) {
    intent.f1 = f1.id;
    intent.roles[f1.id] = "F1";
    if (world.puck.possessor !== f1.id) {
      intent.f1Action = "hunt";
      if (taggingUp && z === "OZ") {
        intent.targets[f1.id] = alongWorld(dir, ONSIDE_ALONG, f1.pos.y, f1.radius);
      } else if (!inOwnCrease(world, side, puck)) {
        intent.targets[f1.id] = { x: puck.x, y: puck.y };
      }
    } else if (taggingUp) {
      intent.f1Action = "pass";
      intent.targets[f1.id] = alongWorld(dir, ONSIDE_ALONG, f1.pos.y, f1.radius);
    } else if (z === "OZ" && world.shotLock[side]) {
      intent.f1Action = "pass";
    } else if (z === "OZ") {
      intent.f1Action = "shoot";
    } else if (z === "DZ") {
      const outlet = skaters.some(
        (b) => b.id !== f1.id && !isGoalie(b) && b.pos.x * dir > alongPuck + 8,
      );
      intent.f1Action = outlet ? "pass" : "clear";
    } else {
      const play = playForSide(world, side);
      intent.f1Action = shotPolicyOf(world, side, play) === "dump" ? "clear" : "pass";
    }
  }
  const restF = fwds.filter((b) => b.id !== f1?.id);
  const f2 = restF[0];
  const f3 = restF[1];
  if (f2) {
    intent.roles[f2.id] = "F2";
    const offY = puck.y >= 0 ? -8 : 8;
    if (!weHaveIt) {
      const holder = possessor && possessor.side !== side ? possessor : undefined;
      let f2Along: number;
      if (holder) {
        f2Along = holder.pos.x * dir;
        if (!ozLive) f2Along = Math.min(f2Along, ONSIDE_ALONG);
      } else {
        const dumpChase = ozLive && alongPuck > ESTABLISHED_OZ_ALONG;
        f2Along = dumpChase ? alongPuck - 6 : Math.min(alongPuck - 8, ONSIDE_ALONG);
      }
      intent.targets[f2.id] = alongWorld(dir, f2Along, (holder?.pos.y ?? puck.y) + offY, f2.radius);
    } else {
      // Don't send F2 ahead of the puck on a just-in OZ entry.
      const carryOut =
        ozLive && alongPuck > ESTABLISHED_OZ_ALONG && alongPuck < OZ_ICE_SHOOT_ALONG;
      let f2Along = carryOut ? alongPuck + 10 : alongPuck - 12;
      if (!ozLive) f2Along = Math.min(f2Along, ONSIDE_ALONG);
      intent.targets[f2.id] = alongWorld(dir, f2Along, puck.y + offY, f2.radius);
    }
  }
  if (f3) {
    intent.roles[f3.id] = "F3";
    const slotY = (puck.y >= 0 ? -1 : 1) * 10;
    const f3Along = ozLive ? GOAL_LINE_X - 16 : ONSIDE_ALONG;
    intent.targets[f3.id] = alongWorld(dir, f3Along, slotY, f3.radius);
  }

  const dsBody = ds[0];
  const dwBody = ds[1];
  if (dsBody) {
    intent.roles[dsBody.id] = "Ds";
    let dsAlong: number;
    if (z === "DZ") {
      dsAlong = Math.max(alongPuck - 12, CREASE_KEEP_OUT);
    } else if (z === "OZ") {
      dsAlong = Math.min(Math.max(alongPuck - 18, BLUE_LINE_X - 4), BLUE_LINE_X + 8);
    } else {
      dsAlong = -BLUE_LINE_X + 4;
    }
    if (taggingUp) dsAlong = Math.min(dsAlong, ONSIDE_ALONG);
    intent.targets[dsBody.id] = alongWorld(dir, dsAlong, puck.y * 0.4, dsBody.radius);
  }
  if (dwBody) {
    intent.roles[dwBody.id] = "Dw";
    const weakY = puck.y >= 0 ? -HASH_OFFSET_Y : HASH_OFFSET_Y;
    let dwAlong: number;
    if (z === "DZ") {
      dwAlong = Math.max(alongPuck - 8, CREASE_KEEP_OUT);
    } else if (z === "OZ") {
      dwAlong = BLUE_LINE_X - 4;
    } else {
      dwAlong = -BLUE_LINE_X + 4;
    }
    intent.targets[dwBody.id] = alongWorld(dir, dwAlong, weakY, dwBody.radius);
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
