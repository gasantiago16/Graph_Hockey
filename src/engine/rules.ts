import type { MatchEvent } from "../types/events.ts";
import type { PlayerId } from "../types/ids.ts";
import {
  STRENGTHS,
  type ContactKind,
  type PenaltyClock,
  type Side,
  type Strength,
  type Vec2,
  type WhistleKind,
} from "../types/hockey.ts";
import { dist, hypotVec, isFacing, sub, type ContactEvent } from "./physics.ts";
import { wantsAutoChange } from "./fatigue.ts";
import {
  BLUE_LINE_X,
  CENTER_ICE,
  CREASE_RADIUS,
  END_ZONE_FACEOFF_X,
  FACEOFF_SPOTS,
  GOAL_DEPTH,
  GOAL_LINE_X,
  GOAL_WIDTH,
  HASH_OFFSET_Y,
  NZ_FACEOFF_X,
  RINK_HALF_WIDTH,
} from "./rink.ts";
import type { Rng } from "./rng.ts";
import { shotXg } from "./xg.ts";
import {
  boxSkaterCounts,
  extraAttackerId,
  findBySlot,
  isGoalie,
  makePlayerBody,
  onIceBodies,
  type Body,
  type LineTag,
  type WorldState,
} from "./world.ts";

export const STICK_HEIGHT_DEFAULT = 3.0;
export const HIGH_STICK_BAR = 4.0;
export const FACEOFF_PUCK_OFFSET = 1.5;
export const FACEOFF_FATIGUE_WEIGHT = 0.08;
export const ICING_REACH_FT = 8;
export const ICING_RACE_TICKS = 40;
export const DUMP_MIN_SPEED = 30;
export const SHOT_MIN_SPEED = 40;
export const SHOT_MIN_ANGLE = 0.2;
export const SMOTHER_SECONDS = 0.8;
export const NET_OFF_RELSPEED = 12;
export const POST_HIT_RADIUS = 0.8;
export const MINOR_SECONDS = 120;
export const PENALTY_REL_SPEED = 28;
export const PULL_GOALIE_SECONDS = 120;

export type MinorInfraction = "hook" | "trip" | "interference";

export type LiveSnapshot = {
  puckPos: Vec2;
  possessor: PlayerId | null;
  bodies: Record<PlayerId, Vec2>;
};

export type RuleEmit = (
  partial: Omit<MatchEvent, "id" | "seq" | "liveTick" | "stoppageSeq" | "period">,
) => MatchEvent;

export function otherSide(side: Side): Side {
  return side === "home" ? "away" : "home";
}

export function skaterCounts(strength: Strength): { home: number; away: number } {
  const parts = strength.split("v");
  return { home: Number(parts[0]), away: Number(parts[1]) };
}

export function isShorthanded(world: WorldState, side: Side): boolean {
  const { home, away } = boxSkaterCounts(world);
  return side === "home" ? home < away : away < home;
}

export function ySignOf(y: number): 1 | -1 {
  return y < 0 ? -1 : 1;
}

export function xSignOf(x: number): 1 | -1 {
  return x < 0 ? -1 : 1;
}

export function defendingNetX(world: WorldState, side: Side): number {
  return -world.attackingDir[side] * GOAL_LINE_X;
}

export function attackingNetX(world: WorldState, side: Side): number {
  return world.attackingDir[side] * GOAL_LINE_X;
}

export function endZoneDot(sx: 1 | -1, sy: 1 | -1): Vec2 {
  return { x: sx * END_ZONE_FACEOFF_X, y: sy * HASH_OFFSET_Y };
}

export function nzDot(sx: 1 | -1, sy: 1 | -1): Vec2 {
  return { x: sx * NZ_FACEOFF_X, y: sy * HASH_OFFSET_Y };
}

export function nearestFaceoffSpot(pos: Vec2): Vec2 {
  let best = CENTER_ICE;
  let bestD = Infinity;
  for (const s of FACEOFF_SPOTS) {
    const d = (s.x - pos.x) ** 2 + (s.y - pos.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { x: best.x, y: best.y };
}

export function dzEndDot(world: WorldState, defending: Side, puckY: number): Vec2 {
  const sx: 1 | -1 = world.attackingDir[defending] === 1 ? -1 : 1;
  return endZoneDot(sx, ySignOf(puckY));
}

export function ozEndDot(world: WorldState, attacking: Side, puckY: number): Vec2 {
  return endZoneDot(world.attackingDir[attacking], ySignOf(puckY));
}

/** Faceoff spot from the last whistle. Penalty/puck-out/net-off are wired so later PRs can reuse them. */
export function faceoffSpotFor(
  kind: WhistleKind,
  world: WorldState,
  ctx: { dumping?: Side; attacking?: Side; actorSide?: Side; netX?: number } = {},
): Vec2 {
  const puckY = world.puck.pos.y;
  switch (kind) {
    case "goal":
      return { x: CENTER_ICE.x, y: CENTER_ICE.y };
    case "icing": {
      const dumping = ctx.dumping ?? world.icingRace?.sideDumping ?? world.icingTrack?.sideDumping;
      if (dumping) return dzEndDot(world, dumping, puckY);
      return dzEndDot(world, "home", puckY);
    }
    case "offside": {
      const atk = ctx.attacking ?? world.delayedOffside?.attacking ?? "home";
      return nzDot(world.attackingDir[atk], ySignOf(puckY));
    }
    case "freeze": {
      const gId = world.puck.possessor;
      const g = gId ? world.bodies[gId] : undefined;
      const side = g?.side ?? ctx.actorSide ?? "home";
      return dzEndDot(world, side, puckY);
    }
    case "penalty": {
      const side = ctx.actorSide ?? "home";
      return dzEndDot(world, side, puckY);
    }
    case "high_stick_goal_waved_off": {
      const atk = ctx.attacking ?? ctx.actorSide ?? "home";
      return ozEndDot(world, atk, puckY);
    }
    case "net_off": {
      const netX = ctx.netX ?? world.puck.pos.x;
      return endZoneDot(xSignOf(netX), ySignOf(puckY));
    }
    case "puck_out":
      return nearestFaceoffSpot(world.puck.pos);
    case "period_end":
      return { x: CENTER_ICE.x, y: CENTER_ICE.y };
  }
}

export function puckInNet(pos: Vec2, netX: number): boolean {
  const half = GOAL_WIDTH / 2;
  if (Math.abs(pos.y) > half) return false;
  if (netX > 0) return pos.x > netX && pos.x <= netX + GOAL_DEPTH;
  return pos.x < netX && pos.x >= netX - GOAL_DEPTH;
}

export function velTowardNet(vel: Vec2, netX: number): boolean {
  return netX > 0 ? vel.x > 0 : vel.x < 0;
}

export function inCrease(pos: Vec2, world: WorldState, side: Side): boolean {
  const netX = defendingNetX(world, side);
  if (Math.hypot(pos.x - netX, pos.y) > CREASE_RADIUS) return false;
  return netX > 0 ? pos.x <= netX : pos.x >= netX;
}

export function captureSnapshot(world: WorldState): LiveSnapshot {
  const bodies: Record<PlayerId, Vec2> = {};
  for (const b of onIceBodies(world)) {
    bodies[b.id] = { x: b.pos.x, y: b.pos.y };
  }
  return {
    puckPos: { x: world.puck.pos.x, y: world.puck.pos.y },
    possessor: world.puck.possessor,
    bodies,
  };
}

export function stickHeightOf(body: Body): number {
  return body.stickHeight ?? STICK_HEIGHT_DEFAULT;
}

export function notePuckContact(world: WorldState, kind: ContactKind, playerId: PlayerId, height?: number): void {
  const body = world.bodies[playerId];
  world.lastPuckContact = {
    kind,
    playerId,
    stickHeight: height ?? (body ? stickHeightOf(body) : STICK_HEIGHT_DEFAULT),
  };
}

export function faceoffWinProbability(world: WorldState, homeC: Body, awayC: Body): number {
  const hFO = homeC.attributes?.faceoff;
  const aFO = awayC.attributes?.faceoff;
  if (hFO === undefined && aFO === undefined) return 0.5;
  const hf = hFO ?? 50;
  const af = aFO ?? 50;
  const hFat = world.fatigue[homeC.id] ?? 0;
  const aFat = world.fatigue[awayC.id] ?? 0;
  const p = 0.5 + (hf - af) / 200 + FACEOFF_FATIGUE_WEIGHT * (aFat - hFat);
  return Math.max(0.05, Math.min(0.95, p));
}

export function pickFaceoffWinner(world: WorldState, rng: Rng): Body | undefined {
  const homeC = findBySlot(world, "home", "C");
  const awayC = findBySlot(world, "away", "C");
  if (homeC && awayC) {
    return rng.next() < faceoffWinProbability(world, homeC, awayC) ? homeC : awayC;
  }
  return homeC ?? awayC;
}

export function alignFaceoffCenters(world: WorldState): void {
  const spot = world.faceoffSpot ?? CENTER_ICE;
  for (const side of ["home", "away"] as const) {
    const c = findBySlot(world, side, "C");
    if (!c) continue;
    const d = world.attackingDir[side];
    c.pos.x = spot.x - d * 1.2;
    c.pos.y = spot.y;
    c.vel.x = 0;
    c.vel.y = 0;
    c.heading = d === 1 ? 0 : Math.PI;
  }
}

function playerIdFromContact(c: ContactEvent): PlayerId | null {
  const id = c.a === "puck" ? c.b : c.a;
  return id === "puck" ? null : id;
}

function sidePlayedPuck(
  world: WorldState,
  side: Side,
  puckContacts: ContactEvent[],
  prevPossessor: PlayerId | null,
): boolean {
  if (world.puck.possessor) {
    const b = world.bodies[world.puck.possessor];
    if (b && b.side === side) return true;
  }
  // Possession at tick start counts: updatePossession already cleared a dump/shot.
  if (prevPossessor) {
    const b = world.bodies[prevPossessor];
    if (b && b.side === side) return true;
  }
  for (const c of puckContacts) {
    const id = playerIdFromContact(c);
    if (!id) continue;
    const b = world.bodies[id];
    if (b && b.side === side) return true;
  }
  return false;
}

function allAttackersTaggedUp(world: WorldState, attacking: Side): boolean {
  const dir = world.attackingDir[attacking];
  for (const b of onIceBodies(world)) {
    if (b.side !== attacking || isGoalie(b)) continue;
    if (b.pos.x * dir > BLUE_LINE_X) return false;
  }
  return true;
}

function nearestSkater(world: WorldState, side: Side, dot: Vec2): Body | undefined {
  let best: Body | undefined;
  let bestD = Infinity;
  for (const b of onIceBodies(world)) {
    if (b.side !== side || isGoalie(b)) continue;
    const d = dist(b.pos, dot);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && (!best || b.id < best.id))) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

function goalieTouched(world: WorldState, puckContacts: ContactEvent[]): boolean {
  if (world.puck.possessor) {
    const b = world.bodies[world.puck.possessor];
    if (b && isGoalie(b)) return true;
  }
  for (const c of puckContacts) {
    const id = playerIdFromContact(c);
    if (!id) continue;
    const b = world.bodies[id];
    if (b && isGoalie(b)) return true;
  }
  return false;
}

function crossedOppGoalLine(prev: Vec2, now: Vec2, dumping: Side, world: WorldState): boolean {
  const dir = world.attackingDir[dumping];
  return prev.x * dir < GOAL_LINE_X && now.x * dir >= GOAL_LINE_X;
}

function enteringAttack(prevX: number, nowX: number, world: WorldState): Side | null {
  for (const side of ["home", "away"] as const) {
    const dir = world.attackingDir[side];
    if (prevX * dir <= BLUE_LINE_X && nowX * dir > BLUE_LINE_X) return side;
  }
  return null;
}

function lastContactBody(world: WorldState): Body | undefined {
  const id = world.lastPuckContact?.playerId;
  return id ? world.bodies[id] : undefined;
}

function isStrength(value: string): value is Strength {
  return (STRENGTHS as readonly string[]).includes(value);
}

export function countOnIceSkaters(world: WorldState, side: Side): number {
  let n = 0;
  for (const id of world.onIce[side]) {
    const b = world.bodies[id];
    if (b && !isGoalie(b)) n += 1;
  }
  return n;
}

export function servingPenalty(world: WorldState, id: PlayerId): boolean {
  return (
    world.penalties.home.some((p) => p.playerId === id && p.remaining > 0) ||
    world.penalties.away.some((p) => p.playerId === id && p.remaining > 0)
  );
}

export function rosterCap(world: WorldState, side: Side): number {
  const box = boxSkaterCounts(world);
  const n = side === "home" ? box.home : box.away;
  return n + (world.goalieInNet[side] ? 0 : 1);
}

export function strengthFromSkaterCounts(home: number, away: number, world?: WorldState): Strength {
  const key = `${home}v${away}`;
  if (isStrength(key)) return key;
  if (world) {
    const adjH = world.goalieInNet.home ? home : home - 1;
    const adjA = world.goalieInNet.away ? away : away - 1;
    const key2 = `${Math.max(0, adjH)}v${Math.max(0, adjA)}`;
    if (isStrength(key2)) return key2;
  }
  return "5v5";
}

/** On-ice skater counts including EN extra attacker. PP/SH use boxSkaterCounts. */
export function situationSkaterCounts(world: WorldState): { home: number; away: number } {
  const box = boxSkaterCounts(world);
  return {
    home: box.home + (world.goalieInNet.home ? 0 : 1),
    away: box.away + (world.goalieInNet.away ? 0 : 1),
  };
}

export function syncStrength(world: WorldState): void {
  const { home, away } = situationSkaterCounts(world);
  world.strength = strengthFromSkaterCounts(home, away, world);
}

export function hasExtraSkater(world: WorldState, side: Side): boolean {
  const { home, away } = boxSkaterCounts(world);
  return side === "home" ? home > away : away > home;
}

export function iceListLegal(world: WorldState, side: Side, ids: PlayerId[]): boolean {
  let skaters = 0;
  let goalies = 0;
  for (const id of ids) {
    const b = world.bodies[id];
    if (!b) return false;
    if (isGoalie(b)) goalies += 1;
    else skaters += 1;
  }
  if (goalies > 1) return false;
  const ot = world.period === "OT";
  const maxS = goalies === 0 ? (ot ? 4 : 6) : ot ? 3 : 5;
  if (skaters > maxS) return false;
  if (skaters > rosterCap(world, side)) return false;
  return true;
}

export function moveToBench(world: WorldState, side: Side, id: PlayerId): void {
  world.onIce[side] = world.onIce[side].filter((x) => x !== id);
  if (!world.bench[side].includes(id)) world.bench[side].push(id);
  world.shiftTime[id] = 0;
}

export function moveToIce(world: WorldState, side: Side, id: PlayerId): void {
  world.bench[side] = world.bench[side].filter((x) => x !== id);
  if (!world.onIce[side].includes(id)) world.onIce[side].push(id);
  world.shiftTime[id] = 0;
}

function placeAtBenchDoor(body: Body, side: Side): void {
  body.pos.x = 0;
  body.pos.y = side === "home" ? RINK_HALF_WIDTH - body.radius - 0.5 : -(RINK_HALF_WIDTH - body.radius - 0.5);
  body.vel.x = 0;
  body.vel.y = 0;
}

function firstAvailableBenchSkater(world: WorldState, side: Side): PlayerId | undefined {
  for (const id of world.bench[side]) {
    const b = world.bodies[id];
    if (!b || isGoalie(b) || servingPenalty(world, id)) continue;
    if (world.period === "OT" && b.line && b.line !== "F1" && b.line !== "D1" && b.line !== "F4") continue;
    return id;
  }
  return undefined;
}

export function fillToRosterCap(world: WorldState): void {
  for (const side of ["home", "away"] as const) {
    while (countOnIceSkaters(world, side) < rosterCap(world, side)) {
      const id = firstAvailableBenchSkater(world, side);
      if (!id) break;
      moveToIce(world, side, id);
    }
  }
  syncStrength(world);
}

export function pullGoalieLegal(world: WorldState, side: Side): boolean {
  if (
    world.phase === "delayed_penalty" &&
    world.delayedPenalty &&
    world.delayedPenalty.against === otherSide(side)
  ) {
    return true;
  }
  const trailing = world.score[side] < world.score[otherSide(side)];
  if (world.period === 3 && world.clockRemaining <= PULL_GOALIE_SECONDS && trailing) return true;
  if (world.period === "OT" && trailing) return true;
  return false;
}

function icingDumpingSide(world: WorldState): Side | null {
  if (world.whistle !== "icing") return null;
  for (let i = world.lastEvents.length - 1; i >= 0; i--) {
    const e = world.lastEvents[i];
    if (e?.type === "Icing") {
      const payload = e.payload as { sideDumping?: Side } | undefined;
      return payload?.sideDumping ?? null;
    }
  }
  return null;
}

export function lineChangeWindowOpen(world: WorldState, side: Side): boolean {
  if (icingDumpingSide(world) === side) return false;
  if (world.phase === "whistle" || world.phase === "faceoff_drop" || world.whistle !== null) return true;
  if (world.phase !== "live" && world.phase !== "delayed_offside" && world.phase !== "delayed_penalty") {
    return false;
  }
  const x = world.puck.pos.x * world.attackingDir[side];
  return x <= BLUE_LINE_X;
}

export function tryAddSkater(world: WorldState, side: Side, playerId: PlayerId, emit: RuleEmit): boolean {
  if (world.onIce[side].includes(playerId)) return true;
  const next = [...world.onIce[side], playerId];
  if (!iceListLegal(world, side, next) || servingPenalty(world, playerId)) {
    emit({
      type: "IllegalChangeRejected",
      actor: playerId,
      payload: { side, reason: "too_many_skaters" },
    });
    return false;
  }
  moveToIce(world, side, playerId);
  return true;
}

function ensureExtraAttacker(world: WorldState, side: Side): Body {
  const id = extraAttackerId(side);
  let body = world.bodies[id];
  if (!body) {
    body = makePlayerBody(side, "C", world.attackingDir[side], { id, line: "F4" });
    world.bodies[id] = body;
    world.fatigue[id] = 0;
    world.shiftTime[id] = 0;
  }
  if (!world.onIce[side].includes(id) && !world.bench[side].includes(id)) {
    world.bench[side].push(id);
  }
  return body;
}

function restoreGoalie(world: WorldState, side: Side): void {
  const extraId = extraAttackerId(side);
  if (world.onIce[side].includes(extraId)) moveToBench(world, side, extraId);
  const gId =
    world.bench[side].find((id) => {
      const b = world.bodies[id];
      return Boolean(b && isGoalie(b));
    }) ?? Object.values(world.bodies).find((b) => b.side === side && isGoalie(b))?.id;
  if (!gId) return;
  world.goalieInNet[side] = true;
  const next = world.onIce[side].includes(gId) ? world.onIce[side] : [...world.onIce[side], gId];
  if (!iceListLegal(world, side, next)) {
    world.goalieInNet[side] = false;
    return;
  }
  if (!world.onIce[side].includes(gId)) moveToIce(world, side, gId);
  const g = world.bodies[gId];
  if (g) {
    g.pos.x = -world.attackingDir[side] * GOAL_LINE_X;
    g.pos.y = 0;
    g.vel.x = 0;
    g.vel.y = 0;
  }
}

export function restoreGoaliesOutsideWindow(world: WorldState): void {
  for (const side of ["home", "away"] as const) {
    if (world.goalieInNet[side]) continue;
    if (pullGoalieLegal(world, side)) continue;
    restoreGoalie(world, side);
  }
  syncStrength(world);
}

function applyPullGoalie(world: WorldState, side: Side, emit: RuleEmit): void {
  const want = world.directives[side].pullGoalie;
  if (!world.goalieInNet[side]) {
    if (want === false || !pullGoalieLegal(world, side)) restoreGoalie(world, side);
    return;
  }
  if (want !== true || !pullGoalieLegal(world, side)) return;
  const gId = world.onIce[side].find((id) => {
    const b = world.bodies[id];
    return Boolean(b && isGoalie(b));
  });
  if (gId) moveToBench(world, side, gId);
  world.goalieInNet[side] = false;
  const extra = ensureExtraAttacker(world, side);
  if (!world.onIce[side].includes(extra.id)) {
    if (!iceListLegal(world, side, [...world.onIce[side], extra.id])) {
      emit({
        type: "IllegalChangeRejected",
        actor: extra.id,
        payload: { side, reason: "too_many_skaters" },
      });
      if (gId) {
        moveToIce(world, side, gId);
        world.goalieInNet[side] = true;
      }
      return;
    }
    moveToIce(world, side, extra.id);
    placeAtBenchDoor(extra, side);
  }
  emit({ type: "GoaliePull", actor: extra.id, payload: { side, extraAttackerId: extra.id } });
}

function playersOnLine(world: WorldState, side: Side, line: LineTag): PlayerId[] {
  const ids: PlayerId[] = [];
  for (const [id, b] of Object.entries(world.bodies)) {
    if (b && b.side === side && b.line === line && !isGoalie(b)) ids.push(id);
  }
  ids.sort();
  return ids;
}

function unitAlreadyOn(world: WorldState, side: Side, role: "fwd" | "d", line: LineTag): boolean {
  const on = onIceByRole(world, side, role);
  return on.length > 0 && on.every((id) => world.bodies[id]?.line === line);
}

function onIceByRole(world: WorldState, side: Side, role: "fwd" | "d"): PlayerId[] {
  return world.onIce[side].filter((id) => {
    const b = world.bodies[id];
    if (!b || isGoalie(b) || b.line === "F4") return false;
    if (role === "fwd") return b.position === "C" || b.position === "LW" || b.position === "RW";
    return b.position === "LD" || b.position === "RD";
  });
}

function swapUnit(
  world: WorldState,
  side: Side,
  role: "fwd" | "d",
  to: LineTag,
  emit: RuleEmit,
): void {
  if (world.period === "OT" && to !== "F1" && to !== "D1") return;
  const incoming = playersOnLine(world, side, to).filter((id) => !servingPenalty(world, id));
  if (incoming.length === 0) return;
  const outgoing = onIceByRole(world, side, role);
  const stay = world.onIce[side].filter((id) => !outgoing.includes(id));
  const next = [...stay, ...incoming];
  if (!iceListLegal(world, side, next)) {
    emit({ type: "IllegalChangeRejected", payload: { side, reason: "too_many_skaters" } });
    return;
  }
  for (const id of outgoing) moveToBench(world, side, id);
  for (const id of incoming) {
    moveToIce(world, side, id);
    const b = world.bodies[id];
    if (b) placeAtBenchDoor(b, side);
  }
  emit({ type: "LineChange", payload: { side, unit: to } });
}

function nextLineTags(body: Body): LineTag[] {
  if (body.position === "LD" || body.position === "RD") {
    if (body.line === "D1") return ["D2", "D3", "D1"];
    if (body.line === "D2") return ["D3", "D1", "D2"];
    return ["D1", "D2", "D3"];
  }
  if (body.line === "F1") return ["F2", "F3", "F1"];
  if (body.line === "F2") return ["F3", "F1", "F2"];
  return ["F1", "F2", "F3"];
}

function findReplacement(world: WorldState, body: Body): Body | undefined {
  const allowed =
    world.period === "OT"
      ? body.position === "LD" || body.position === "RD"
        ? (["D1"] as LineTag[])
        : (["F1"] as LineTag[])
      : nextLineTags(body);
  for (const line of allowed) {
    for (const id of world.bench[body.side]) {
      const b = world.bodies[id];
      if (!b || isGoalie(b) || servingPenalty(world, id)) continue;
      if (b.position === body.position && b.line === line) return b;
    }
  }
  for (const id of world.bench[body.side]) {
    const b = world.bodies[id];
    if (!b || isGoalie(b) || servingPenalty(world, id)) continue;
    if (world.period === "OT" && b.line && b.line !== "F1" && b.line !== "D1") continue;
    if (b.position === body.position) return b;
  }
  return undefined;
}

function applyAutoChanges(world: WorldState, side: Side, emit: RuleEmit): void {
  if (world.directives[side].lockLines) return;
  if (!lineChangeWindowOpen(world, side)) return;
  for (const id of [...world.onIce[side]]) {
    if (!wantsAutoChange(world, id, false)) continue;
    const body = world.bodies[id];
    if (!body || isGoalie(body) || body.line === "F4") continue;
    const repl = findReplacement(world, body);
    if (!repl) continue;
    const next = world.onIce[side].map((x) => (x === id ? repl.id : x));
    if (!iceListLegal(world, side, next)) {
      emit({
        type: "IllegalChangeRejected",
        actor: repl.id,
        payload: { side, reason: "too_many_skaters" },
      });
      continue;
    }
    moveToBench(world, side, id);
    moveToIce(world, side, repl.id);
    placeAtBenchDoor(repl, side);
    emit({ type: "LineChange", actor: repl.id, payload: { side, off: id, on: repl.id, auto: true } });
  }
}

export function applyPersonnel(world: WorldState, emit: RuleEmit): void {
  for (const side of ["home", "away"] as const) {
    applyPullGoalie(world, side, emit);
    const plan = world.directives[side].lineChange;
    if (plan && lineChangeWindowOpen(world, side)) {
      if (plan.fwd !== "hold" && !unitAlreadyOn(world, side, "fwd", plan.fwd)) {
        swapUnit(world, side, "fwd", plan.fwd, emit);
      }
      if (plan.dpair !== "hold" && !unitAlreadyOn(world, side, "d", plan.dpair)) {
        swapUnit(world, side, "d", plan.dpair, emit);
      }
    }
    applyAutoChanges(world, side, emit);
  }
  syncStrength(world);
}

export function penaltySeverity(relSpeed: number): number {
  return Math.max(0.2, Math.min(1, relSpeed / PENALTY_REL_SPEED));
}

export function penaltyHazard(discipline: number, relSpeed: number): number {
  return (0.003 + 0.01 * (1 - discipline / 100)) * penaltySeverity(relSpeed);
}

function pickOffender(world: WorldState, a: Body, b: Body, kind: ContactKind): Body {
  if (kind === "stick-body") {
    const aF = isFacing(a, b.pos);
    const bF = isFacing(b, a.pos);
    if (aF && !bF) return a;
    if (bF && !aF) return b;
  }
  const poss = world.puck.possessor;
  if (poss === a.id) return b;
  if (poss === b.id) return a;
  const n = sub(b.pos, a.pos);
  const mag = hypotVec(n) || 1;
  const aClose = a.vel.x * (n.x / mag) + a.vel.y * (n.y / mag);
  const bClose = b.vel.x * (-n.x / mag) + b.vel.y * (-n.y / mag);
  return aClose >= bClose ? a : b;
}

function infractionFor(kind: ContactKind, involvesPossessor: boolean): MinorInfraction {
  if (kind === "stick-body") return "hook";
  return involvesPossessor ? "trip" : "interference";
}

function putInBox(world: WorldState, against: Side, playerId: PlayerId): void {
  if (!world.penalties[against].some((p) => p.playerId === playerId && p.remaining > 0)) {
    world.penalties[against].push({ playerId, remaining: MINOR_SECONDS, kind: "minor" });
  }
  if (world.onIce[against].includes(playerId)) moveToBench(world, against, playerId);
}

export function assessMinor(
  world: WorldState,
  against: Side,
  playerId: PlayerId,
  emit: RuleEmit,
  infraction: MinorInfraction = "hook",
): void {
  putInBox(world, against, playerId);
  if (world.delayedPenalty?.playerId === playerId && world.delayedPenalty.against === against) {
    world.delayedPenalty = null;
    if (world.phase === "delayed_penalty" && world.whistle === null) world.phase = "live";
  }
  emit({
    type: "Penalty",
    actor: playerId,
    payload: { against, kind: "minor", infraction, remaining: MINOR_SECONDS },
  });
  syncStrength(world);
}

function settleDelayedPenalty(
  world: WorldState,
  emit: RuleEmit,
  infraction: MinorInfraction = "hook",
): void {
  const d = world.delayedPenalty;
  if (!d) return;
  world.delayedPenalty = null;
  assessMinor(world, d.against, d.playerId, emit, infraction);
}

export function expireOneMinor(world: WorldState, side: Side): PenaltyClock | null {
  const list = world.penalties[side];
  if (list.length === 0) return null;
  let idx = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i];
    const b = list[idx];
    if (a && b && a.remaining < b.remaining) idx = i;
  }
  const [p] = list.splice(idx, 1);
  return p ?? null;
}

export function tickPenaltyClocks(world: WorldState, dt: number): void {
  for (const side of ["home", "away"] as const) {
    for (const p of world.penalties[side]) {
      p.remaining = Math.max(0, p.remaining - dt);
    }
    const expired = world.penalties[side].filter((p) => p.remaining <= 0);
    world.penalties[side] = world.penalties[side].filter((p) => p.remaining > 0);
    for (const p of expired) {
      if (countOnIceSkaters(world, side) < rosterCap(world, side) && world.bodies[p.playerId]) {
        moveToIce(world, side, p.playerId);
      }
    }
  }
  syncStrength(world);
}

function callMinor(world: WorldState, emit: RuleEmit, offender: Body, infraction: MinorInfraction): void {
  if (isGoalie(offender) || servingPenalty(world, offender.id) || world.delayedPenalty) return;
  const against = offender.side;
  const poss = world.puck.possessor;
  const possBody = poss ? world.bodies[poss] : undefined;
  world.delayedPenalty = { against, playerId: offender.id };
  // Loose puck or non-offending possession: delay. Offending possession: whistle now.
  if (!possBody || possBody.side !== against) {
    if (world.phase === "live" || world.phase === "delayed_offside") world.phase = "delayed_penalty";
    return;
  }
  blowWhistle(
    world,
    emit,
    "penalty",
    "Penalty",
    faceoffSpotFor("penalty", world, { actorSide: against }),
    { actor: offender.id, payload: { kind: "penalty", against, infraction } },
  );
}

function maybePenalties(world: WorldState, rng: Rng, emit: RuleEmit, contacts: ContactEvent[]): void {
  if (world.whistle !== null) return;
  if (world.phase !== "live" && world.phase !== "delayed_offside" && world.phase !== "delayed_penalty") return;
  const eligible = contacts.filter((c) => c.kind === "body-body" || c.kind === "stick-body");
  eligible.sort((c1, c2) => {
    const k1 = `${c1.a}|${c1.b}|${c1.kind}`;
    const k2 = `${c2.a}|${c2.b}|${c2.kind}`;
    return k1 < k2 ? -1 : k1 > k2 ? 1 : 0;
  });
  for (const c of eligible) {
    if (world.whistle !== null || world.delayedPenalty) return;
    if (c.a === "puck" || c.b === "puck") continue;
    const a = world.bodies[c.a];
    const b = world.bodies[c.b];
    if (!a || !b || a.side === b.side || isGoalie(a) || isGoalie(b)) continue;
    const offender = pickOffender(world, a, b, c.kind);
    const discipline = offender.attributes?.discipline ?? 50;
    const h = penaltyHazard(discipline, hypotVec(sub(a.vel, b.vel)));
    if (rng.next() >= h) continue;
    const infraction = infractionFor(
      c.kind,
      world.puck.possessor === a.id || world.puck.possessor === b.id,
    );
    callMinor(world, emit, offender, infraction);
  }
}

function maybeResolveDelayedTurnover(world: WorldState, emit: RuleEmit): boolean {
  const d = world.delayedPenalty;
  if (!d || world.whistle !== null) return false;
  const poss = world.puck.possessor;
  if (!poss) return false;
  const b = world.bodies[poss];
  if (!b || b.side !== d.against) return false;
  blowWhistle(
    world,
    emit,
    "penalty",
    "Penalty",
    faceoffSpotFor("penalty", world, { actorSide: d.against }),
    { actor: d.playerId, payload: { kind: "penalty", against: d.against } },
  );
  return true;
}

const OT_KEEP = ["C", "LW", "LD", "G"] as const;

function pickOtPlayer(world: WorldState, side: Side, position: (typeof OT_KEEP)[number]): PlayerId | undefined {
  const prefer: LineTag = position === "G" ? "G1" : position === "LD" ? "D1" : "F1";
  const pool = [...world.onIce[side], ...world.bench[side]];
  const match = pool.filter((id) => world.bodies[id]?.position === position && !servingPenalty(world, id));
  return match.find((id) => world.bodies[id]?.line === prefer) ?? match[0];
}

/** 2F + 1D + G from F1 C / F1 LW / D1 LD / G1. Boxed players stay off the ice. */
export function applyOtRoster(world: WorldState): void {
  for (const side of ["home", "away"] as const) {
    const chosen: PlayerId[] = [];
    for (const position of OT_KEEP) {
      const id = pickOtPlayer(world, side, position);
      if (id) chosen.push(id);
    }
    const all = new Set([...world.onIce[side], ...world.bench[side]]);
    const ice = new Set(chosen);
    world.onIce[side] = chosen.filter((id) => !servingPenalty(world, id));
    world.bench[side] = [...all].filter((id) => !ice.has(id) || servingPenalty(world, id));
    world.goalieInNet[side] = world.onIce[side].some((id) => {
      const b = world.bodies[id];
      return Boolean(b && isGoalie(b));
    });
  }
  fillToRosterCap(world);
}

function clearLiveFlags(world: WorldState): void {
  world.icingRace = null;
  world.icingTrack = null;
  world.delayedOffside = null;
  world.shotLock.home = false;
  world.shotLock.away = false;
}

function blowWhistle(
  world: WorldState,
  emit: RuleEmit,
  kind: WhistleKind,
  type: MatchEvent["type"],
  spot: Vec2,
  extra: { actor?: PlayerId; payload?: unknown; xG?: number } = {},
): void {
  world.whistle = kind;
  world.faceoffSpot = { x: spot.x, y: spot.y };
  clearLiveFlags(world);
  world.phase = "whistle";
  if (type !== "Penalty") {
    emit({
      type,
      actor: extra.actor,
      xG: extra.xG,
      payload: extra.payload ?? { kind },
    });
  }
  const infraction = (extra.payload as { infraction?: MinorInfraction } | undefined)?.infraction;
  settleDelayedPenalty(world, emit, infraction);
  restoreGoaliesOutsideWindow(world);
  fillToRosterCap(world);
}

function awardGoal(world: WorldState, emit: RuleEmit, scoring: Side, actor: PlayerId | undefined, xG?: number): void {
  world.score[scoring] += 1;
  const spot = faceoffSpotFor("goal", world);
  emit({
    type: "Goal",
    actor,
    xG,
    payload: { side: scoring },
  });
  if (hasExtraSkater(world, scoring)) {
    expireOneMinor(world, otherSide(scoring));
  }
  clearLiveFlags(world);
  world.whistle = "goal";
  world.faceoffSpot = spot;
  world.delayedOffside = null;
  world.phase = world.period === "OT" ? "game_over" : "whistle";
  settleDelayedPenalty(world, emit);
  restoreGoaliesOutsideWindow(world);
  fillToRosterCap(world);
}

function lastShotXg(world: WorldState): number | undefined {
  for (let i = world.lastEvents.length - 1; i >= 0; i--) {
    const e = world.lastEvents[i];
    if (e && e.type === "Shot") return e.xG;
  }
  return undefined;
}

function updateSmother(world: WorldState, emit: RuleEmit, dt: number): boolean {
  for (const side of ["home", "away"] as const) {
    const g = findBySlot(world, side, "G");
    const holding = Boolean(g && world.puck.possessor === g.id && inCrease(g.pos, world, side));
    if (holding && g) {
      world.smotherProgress[side] += dt / SMOTHER_SECONDS;
      if (world.smotherProgress[side] >= 1) {
        blowWhistle(world, emit, "freeze", "Freeze", faceoffSpotFor("freeze", world, { actorSide: side }), {
          actor: g.id,
        });
        return true;
      }
    } else {
      world.smotherProgress[side] = 0;
    }
  }
  return false;
}

export function crossedIntoNet(prev: Vec2, now: Vec2, netX: number): boolean {
  return !puckInNet(prev, netX) && puckInNet(now, netX);
}

function maybeGoal(world: WorldState, prev: LiveSnapshot, emit: RuleEmit): boolean {
  if (world.whistle !== null) return false;
  if (world.phase !== "live" && world.phase !== "delayed_offside" && world.phase !== "delayed_penalty") {
    return false;
  }
  for (const scoring of ["home", "away"] as const) {
    const netX = attackingNetX(world, scoring);
    if (!crossedIntoNet(prev.puckPos, world.puck.pos, netX)) continue;
    const defending = otherSide(scoring);
    if (world.netStatus[defending] !== "on") continue;

    const contact = world.lastPuckContact;
    const lastBody = lastContactBody(world);

    if (world.delayedOffside && lastBody && lastBody.side === world.delayedOffside.attacking) {
      continue;
    }

    if (contact?.kind === "skate-puck" && velTowardNet(world.puck.vel, netX)) {
      continue;
    }
    if (contact?.kind !== "stick-puck") continue;

    if (contact.stickHeight > HIGH_STICK_BAR) {
      blowWhistle(
        world,
        emit,
        "high_stick_goal_waved_off",
        "HighStickGoalWavedOff",
        faceoffSpotFor("high_stick_goal_waved_off", world, { attacking: scoring }),
        { actor: contact.playerId, payload: { side: scoring, stickHeight: contact.stickHeight } },
      );
      return true;
    }

    awardGoal(world, emit, scoring, contact.playerId, lastShotXg(world));
    return true;
  }
  return false;
}

function nearPost(pos: Vec2, netX: number): boolean {
  const half = GOAL_WIDTH / 2;
  for (const py of [-half, half]) {
    if (Math.hypot(pos.x - netX, pos.y - py) < POST_HIT_RADIUS) return true;
  }
  return false;
}

function maybeNetOff(world: WorldState, emit: RuleEmit): boolean {
  const speed = hypotVec(world.puck.vel);
  if (speed <= NET_OFF_RELSPEED) return false;
  for (const defending of ["home", "away"] as const) {
    if (world.netStatus[defending] !== "on") continue;
    const netX = defendingNetX(world, defending);
    if (!nearPost(world.puck.pos, netX)) continue;
    world.netStatus[defending] = "off";
    blowWhistle(world, emit, "net_off", "NetOff", faceoffSpotFor("net_off", world, { netX }), {
      actor: world.lastPuckContact?.playerId,
      payload: { defending },
    });
    return true;
  }
  return false;
}

function maybeOffside(
  world: WorldState,
  prev: LiveSnapshot,
  emit: RuleEmit,
  puckContacts: ContactEvent[],
): boolean {
  if (world.delayedOffside) {
    const atk = world.delayedOffside.attacking;
    const dir = world.attackingDir[atk];
    if (world.puck.pos.x * dir <= BLUE_LINE_X) {
      world.delayedOffside = null;
      if (world.phase === "delayed_offside") world.phase = "live";
    } else if (allAttackersTaggedUp(world, atk)) {
      world.delayedOffside = null;
      if (world.phase === "delayed_offside") world.phase = "live";
    } else if (puckInNet(world.puck.pos, attackingNetX(world, atk))) {
      blowWhistle(world, emit, "offside", "Offside", faceoffSpotFor("offside", world, { attacking: atk }), {
        payload: { attacking: atk },
      });
      return true;
    } else if (sidePlayedPuck(world, atk, puckContacts, prev.possessor)) {
      blowWhistle(world, emit, "offside", "Offside", faceoffSpotFor("offside", world, { attacking: atk }), {
        payload: { attacking: atk },
      });
      return true;
    }
  }

  const entering = enteringAttack(prev.puckPos.x, world.puck.pos.x, world);
  if (!entering) return false;
  const dir = world.attackingDir[entering];
  let offside = false;
  for (const b of onIceBodies(world)) {
    if (b.side !== entering || isGoalie(b)) continue;
    const prevPos = prev.bodies[b.id];
    if (prevPos && prevPos.x * dir > BLUE_LINE_X) {
      offside = true;
      break;
    }
  }
  if (offside) {
    if (sidePlayedPuck(world, entering, puckContacts, prev.possessor)) {
      blowWhistle(world, emit, "offside", "Offside", faceoffSpotFor("offside", world, { attacking: entering }), {
        payload: { attacking: entering },
      });
      return true;
    }
    world.delayedOffside = { attacking: entering };
    if (world.phase === "live") world.phase = "delayed_offside";
    return false;
  }
  const poss = world.puck.possessor ? world.bodies[world.puck.possessor] : undefined;
  if (poss && poss.side === entering) {
    world.lastZoneEntryBySide[entering] = world.liveTick;
    emit({ type: "ZoneEntry", actor: poss.id, payload: { side: entering } });
  }
  return false;
}

function callIcing(world: WorldState, emit: RuleEmit, dumping: Side, actor?: PlayerId): void {
  blowWhistle(world, emit, "icing", "Icing", faceoffSpotFor("icing", world, { dumping }), {
    actor,
    payload: { sideDumping: dumping },
  });
}

/** Returns false when a race cannot be formed (call icing immediately). */
function startIcingRace(world: WorldState, dumping: Side): boolean {
  const sy = ySignOf(world.puck.pos.y);
  const sx = xSignOf(world.puck.pos.x);
  const dot = endZoneDot(sx, sy);
  const defender = nearestSkater(world, dumping, dot);
  const attacker = nearestSkater(world, otherSide(dumping), dot);
  world.icingTrack = null;
  if (!defender || !attacker) return false;
  world.icingRace = {
    sideDumping: dumping,
    dot,
    defenderId: defender.id,
    attackerId: attacker.id,
    startedLiveTick: world.liveTick,
  };
  return true;
}

function resolveIcingRace(world: WorldState, rng: Rng, emit: RuleEmit): boolean {
  const race = world.icingRace;
  if (!race) return false;
  const def = world.bodies[race.defenderId];
  const atk = world.bodies[race.attackerId];
  const defIn = def ? dist(def.pos, race.dot) < ICING_REACH_FT : false;
  const atkIn = atk ? dist(atk.pos, race.dot) < ICING_REACH_FT : false;
  let call: "icing" | "waive" | null = null;
  if (defIn && atkIn) call = rng.next() < 0.5 ? "icing" : "waive";
  else if (defIn) call = "icing";
  else if (atkIn) call = "waive";
  else if (world.liveTick - race.startedLiveTick >= ICING_RACE_TICKS) call = "icing";
  if (call === "icing") {
    callIcing(world, emit, race.sideDumping, def?.id);
    return true;
  }
  if (call === "waive") {
    world.icingRace = null;
    return true;
  }
  return false;
}

function maybeIcing(
  world: WorldState,
  rng: Rng,
  prev: LiveSnapshot,
  emit: RuleEmit,
  puckContacts: ContactEvent[],
): boolean {
  if (world.icingRace && goalieTouched(world, puckContacts)) {
    world.icingRace = null;
    world.icingTrack = null;
    return false;
  }
  if (resolveIcingRace(world, rng, emit)) return world.whistle === "icing";

  if (world.icingTrack) {
    const dumping = world.icingTrack.sideDumping;
    if (goalieTouched(world, puckContacts) || world.puck.possessor !== null || puckContacts.length > 0) {
      world.icingTrack = null;
    } else if (crossedOppGoalLine(prev.puckPos, world.puck.pos, dumping, world)) {
      const netX = attackingNetX(world, dumping);
      if (puckInNet(world.puck.pos, netX)) {
        world.icingTrack = null;
      } else if (isShorthanded(world, dumping)) {
        world.icingTrack = null;
      } else if (!startIcingRace(world, dumping)) {
        callIcing(world, emit, dumping);
        return true;
      }
    }
  }

  if (!world.icingRace && prev.possessor && !world.puck.possessor) {
    const shooter = world.bodies[prev.possessor];
    if (shooter) {
      const dir = world.attackingDir[shooter.side];
      const fromOwn = prev.puckPos.x * dir < 0;
      const toward = world.puck.vel.x * dir > 0;
      const speed = hypotVec(world.puck.vel);
      if (fromOwn && toward && speed >= DUMP_MIN_SPEED) {
        world.icingTrack = { sideDumping: shooter.side, shooterId: shooter.id };
      } else if (!world.icingTrack) {
        world.icingTrack = null;
      }
    }
  }
  return false;
}

function maybeShot(
  world: WorldState,
  prev: LiveSnapshot,
  emit: RuleEmit,
  stickRelease: WorldState["stickRelease"],
): void {
  if (stickRelease === "pass" || stickRelease === "clear") return;
  if (!prev.possessor || world.puck.possessor) return;
  const shooter = world.bodies[prev.possessor];
  if (!shooter || isGoalie(shooter)) return;
  const speed = hypotVec(world.puck.vel);
  if (speed < SHOT_MIN_SPEED) return;
  const net = { x: attackingNetX(world, shooter.side), y: 0 };
  const toNet = { x: net.x - shooter.pos.x, y: net.y - shooter.pos.y };
  const aimMag = Math.hypot(toNet.x, toNet.y);
  if (aimMag < 1e-6) return;
  const angleFactor = Math.abs((world.puck.vel.x * toNet.x + world.puck.vel.y * toNet.y) / (speed * aimMag));
  if (angleFactor < SHOT_MIN_ANGLE) return;
  const xG = shotXg(world, shooter, world.puck.vel, prev.puckPos);
  emit({
    type: "Shot",
    actor: shooter.id,
    xG,
    payload: { side: shooter.side },
  });
}

function maybePeriodEnd(world: WorldState, emit: RuleEmit): boolean {
  if (world.clockRemaining > 0) return false;
  blowWhistle(world, emit, "period_end", "PeriodEnd", CENTER_ICE);
  return true;
}

/** Live / delayed_* rule machine. Mutates world; first whistle wins. */
export function applyLiveRules(
  world: WorldState,
  rng: Rng,
  prev: LiveSnapshot,
  emit: RuleEmit,
  dt: number,
  puckContacts: ContactEvent[],
  playerContacts: ContactEvent[] = [],
): void {
  const stickRelease = world.stickRelease;
  world.stickRelease = null;
  if (world.whistle !== null) return;
  maybePenalties(world, rng, emit, playerContacts);
  if (world.whistle !== null) return;
  if (maybeResolveDelayedTurnover(world, emit)) return;
  if (updateSmother(world, emit, dt)) return;
  maybeShot(world, prev, emit, stickRelease);
  if (maybeGoal(world, prev, emit)) return;
  if (maybeNetOff(world, emit)) return;
  if (maybeOffside(world, prev, emit, puckContacts)) return;
  if (maybeIcing(world, rng, prev, emit, puckContacts)) return;
  maybePeriodEnd(world, emit);
}

export function prepareFaceoff(world: WorldState, emit: RuleEmit): void {
  applyPersonnel(world, emit);
  fillToRosterCap(world);
  if (world.whistle === "period_end") {
    if (world.period === "OT" || (world.period === 3 && world.score.home !== world.score.away)) {
      world.phase = "game_over";
    } else {
      world.phase = "intermission";
    }
    return;
  }
  if (!world.faceoffSpot) {
    world.faceoffSpot = faceoffSpotFor(world.whistle ?? "freeze", world);
  }
  if (world.whistle) {
    emit({ type: "Whistle", payload: { kind: world.whistle } });
  }
  world.phase = "faceoff_drop";
  for (const body of onIceBodies(world)) {
    body.vel.x = 0;
    body.vel.y = 0;
  }
  world.puck.vel.x = 0;
  world.puck.vel.y = 0;
  const spot = world.faceoffSpot;
  world.puck.pos.x = spot.x;
  world.puck.pos.y = spot.y;
  world.puck.possessor = null;
  alignFaceoffCenters(world);
}

export function completeFaceoff(world: WorldState, rng: Rng, emit: RuleEmit): void {
  world.stoppageSeq += 1;
  const spot: Vec2 = world.faceoffSpot ?? CENTER_ICE;
  const winner = pickFaceoffWinner(world, rng);
  if (winner) {
    const dir = world.attackingDir[winner.side];
    world.puck.pos.x = spot.x + dir * FACEOFF_PUCK_OFFSET;
    world.puck.pos.y = spot.y;
    world.puck.possessor = winner.id;
    world.puck.lastStick = winner.id;
    notePuckContact(world, "stick-puck", winner.id, stickHeightOf(winner));
  } else {
    world.puck.pos.x = spot.x;
    world.puck.pos.y = spot.y;
    world.puck.possessor = null;
  }
  world.puck.vel.x = 0;
  world.puck.vel.y = 0;
  world.whistle = null;
  world.phase = "live";
  world.icingRace = null;
  world.icingTrack = null;
  world.delayedOffside = null;
  world.delayedPenalty = null;
  emit({
    type: "FaceoffWin",
    actor: winner?.id,
    possessor: world.puck.possessor,
    pos: { x: world.puck.pos.x, y: world.puck.pos.y },
    payload: winner ? { side: winner.side } : undefined,
  });
}
