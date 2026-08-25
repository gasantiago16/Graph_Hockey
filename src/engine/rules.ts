import type { MatchEvent } from "../types/events.ts";
import type { PlayerId } from "../types/ids.ts";
import type { ContactKind, Side, Strength, Vec2, WhistleKind } from "../types/hockey.ts";
import { dist, hypotVec, type ContactEvent } from "./physics.ts";
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
} from "./rink.ts";
import type { Rng } from "./rng.ts";
import { shotXg } from "./xg.ts";
import {
  findBySlot,
  isGoalie,
  onIceBodies,
  type Body,
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
  const { home, away } = skaterCounts(world.strength);
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

function sidePlayedPuck(world: WorldState, side: Side, puckContacts: ContactEvent[]): boolean {
  if (world.puck.possessor) {
    const b = world.bodies[world.puck.possessor];
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

function clearLiveFlags(world: WorldState): void {
  world.icingRace = null;
  world.icingTrack = null;
  world.delayedOffside = null;
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
  emit({
    type,
    actor: extra.actor,
    xG: extra.xG,
    payload: extra.payload ?? { kind },
  });
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
  clearLiveFlags(world);
  world.whistle = "goal";
  world.faceoffSpot = spot;
  world.delayedOffside = null;
  if (world.period === "OT") {
    world.phase = "game_over";
    return;
  }
  world.phase = "whistle";
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

function maybeGoal(world: WorldState, emit: RuleEmit): boolean {
  if (world.whistle !== null) return false;
  if (world.phase !== "live" && world.phase !== "delayed_offside" && world.phase !== "delayed_penalty") {
    return false;
  }
  for (const scoring of ["home", "away"] as const) {
    const netX = attackingNetX(world, scoring);
    if (!puckInNet(world.puck.pos, netX)) continue;
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
    } else if (sidePlayedPuck(world, atk, puckContacts)) {
      blowWhistle(world, emit, "offside", "Offside", faceoffSpotFor("offside", world, { attacking: atk }), {
        payload: { attacking: atk },
      });
      return true;
    } else if (allAttackersTaggedUp(world, atk)) {
      world.delayedOffside = null;
      if (world.phase === "delayed_offside") world.phase = "live";
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
    if (sidePlayedPuck(world, entering, puckContacts)) {
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

function maybeShot(world: WorldState, prev: LiveSnapshot, emit: RuleEmit): void {
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
): void {
  if (updateSmother(world, emit, dt)) return;
  maybeShot(world, prev, emit);
  if (maybeGoal(world, emit)) return;
  if (maybeNetOff(world, emit)) return;
  if (maybeOffside(world, prev, emit, puckContacts)) return;
  if (maybeIcing(world, rng, prev, emit, puckContacts)) return;
  maybePeriodEnd(world, emit);
}

export function prepareFaceoff(world: WorldState, emit: RuleEmit): void {
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
  emit({
    type: "FaceoffWin",
    actor: winner?.id,
    possessor: world.puck.possessor,
    pos: { x: world.puck.pos.x, y: world.puck.pos.y },
    payload: winner ? { side: winner.side } : undefined,
  });
}
