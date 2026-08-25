import { DEFAULT_PLAY_ID } from "../types/play.ts";
import type { TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import type { PlayerId } from "../types/ids.ts";
import type {
  AttackingDir,
  PenaltyClock,
  Period,
  Phase,
  Position,
  Side,
  Strength,
  Vec2,
  WhistleKind,
} from "../types/hockey.ts";
import { attackingDir, CENTER_ICE, GOAL_LINE_X, PERIOD_SECONDS } from "./rink.ts";

export const SKATER_RADIUS = 1.6;
export const GOALIE_RADIUS = 1.8;
export const SKATER_MASS = 1.0;
export const GOALIE_MASS = 1.2;

export const LAST_EVENTS_CAP = 32;

export const POS_ORDER = ["C", "LW", "RW", "LD", "RD", "G"] as const satisfies readonly Position[];

/** 5v5 slots in the attacking frame (x toward the opponent net). */
export const DEFAULT_SLOTS: { [K in Position]: Vec2 } = {
  C: { x: 8, y: 0 },
  LW: { x: 20, y: 22 },
  RW: { x: 20, y: -22 },
  LD: { x: -25, y: 18 },
  RD: { x: -25, y: -18 },
  G: { x: -GOAL_LINE_X, y: 0 },
};

export type Body = {
  id: PlayerId;
  side: Side;
  position: Position;
  pos: Vec2;
  vel: Vec2;
  heading: number;
  radius: number;
  mass: number;
};

export type IcingRace = {
  sideDumping: Side;
  dot: Vec2;
  defenderId: PlayerId;
  attackerId: PlayerId;
  startedLiveTick: number;
};

export type WorldState = {
  matchId: string;
  seed: number;
  phase: Phase;
  period: Period;
  /** Seconds remaining in this period. Decrements only in live / delayed_* at 10 Hz. */
  clockRemaining: number;
  /** Increments only on 10 Hz live/delayed steps. */
  liveTick: number;
  /** Increments on each discrete stoppage resolution. */
  stoppageSeq: number;
  attackingDir: { home: AttackingDir; away: AttackingDir };
  score: { home: number; away: number };
  strength: Strength;
  puck: { pos: Vec2; vel: Vec2; possessor: PlayerId | null; lastStick: PlayerId | null };
  bodies: Record<PlayerId, Body>;
  onIce: { home: PlayerId[]; away: PlayerId[] };
  bench: { home: PlayerId[]; away: PlayerId[] };
  fatigue: Record<PlayerId, number>;
  penalties: { home: PenaltyClock[]; away: PenaltyClock[] };
  delayedPenalty: { against: Side; playerId: PlayerId } | null;
  delayedOffside: { attacking: Side } | null;
  icingRace: IcingRace | null;
  whistle: WhistleKind | null;
  faceoffSpot: Vec2 | null;
  netStatus: { home: "on" | "off"; away: "on" | "off" };
  smotherProgress: { home: number; away: number };
  goalieInNet: { home: boolean; away: boolean };
  timeoutLeft: { home: boolean; away: boolean };
  playId: { home: string; away: string };
  directives: { home: TeamDirective; away: TeamDirective };
  lastEvents: MatchEvent[];
};

export type CreateWorldInput = {
  matchId?: string;
  seed?: number;
  phase?: Phase;
  period?: Period;
  clockRemaining?: number;
  liveTick?: number;
  stoppageSeq?: number;
  attackingDir?: { home: AttackingDir; away: AttackingDir };
  score?: { home: number; away: number };
  strength?: Strength;
  puck?: Partial<WorldState["puck"]>;
  bodies?: Partial<Record<PlayerId, Partial<Body>>>;
  onIce?: { home: PlayerId[]; away: PlayerId[] };
  bench?: { home: PlayerId[]; away: PlayerId[] };
  fatigue?: Record<PlayerId, number>;
  penalties?: { home: PenaltyClock[]; away: PenaltyClock[] };
  delayedPenalty?: WorldState["delayedPenalty"];
  delayedOffside?: WorldState["delayedOffside"];
  icingRace?: IcingRace | null;
  whistle?: WhistleKind | null;
  faceoffSpot?: Vec2 | null;
  netStatus?: { home: "on" | "off"; away: "on" | "off" };
  smotherProgress?: { home: number; away: number };
  goalieInNet?: { home: boolean; away: boolean };
  timeoutLeft?: { home: boolean; away: boolean };
  playId?: { home: string; away: string };
  directives?: { home: TeamDirective; away: TeamDirective };
  lastEvents?: MatchEvent[];
};

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function cloneVec(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export function defaultDirective(playId: string = DEFAULT_PLAY_ID): TeamDirective {
  return { playId, pressure: "neutral" };
}

export function defaultPlayerId(side: Side, position: Position): PlayerId {
  return `${side === "home" ? "h" : "a"}-${position}`;
}

export function isGoalie(body: Body): boolean {
  return body.position === "G";
}

export function onIceIds(world: WorldState): PlayerId[] {
  return [...world.onIce.home, ...world.onIce.away];
}

export function onIceBodies(world: WorldState): Body[] {
  const out: Body[] = [];
  for (const id of onIceIds(world)) {
    const b = world.bodies[id];
    if (b) out.push(b);
  }
  return out;
}

export function findBySlot(world: WorldState, side: Side, position: Position): Body | undefined {
  for (const id of world.onIce[side]) {
    const b = world.bodies[id];
    if (b && b.position === position) return b;
  }
  return undefined;
}

function slotWorldPos(position: Position, dir: AttackingDir): Vec2 {
  const slot = DEFAULT_SLOTS[position];
  return vec(slot.x * dir, slot.y);
}

function makeBody(side: Side, position: Position, dir: AttackingDir): Body {
  const goalie = position === "G";
  return {
    id: defaultPlayerId(side, position),
    side,
    position,
    pos: slotWorldPos(position, dir),
    vel: vec(0, 0),
    heading: dir === 1 ? 0 : Math.PI,
    radius: goalie ? GOALIE_RADIUS : SKATER_RADIUS,
    mass: goalie ? GOALIE_MASS : SKATER_MASS,
  };
}

function overlayBody(base: Body, patch: Partial<Body>): Body {
  return {
    ...base,
    ...patch,
    id: patch.id ?? base.id,
    side: patch.side ?? base.side,
    position: patch.position ?? base.position,
    pos: patch.pos ? cloneVec(patch.pos) : cloneVec(base.pos),
    vel: patch.vel ? cloneVec(patch.vel) : cloneVec(base.vel),
    heading: patch.heading ?? base.heading,
    radius: patch.radius ?? base.radius,
    mass: patch.mass ?? base.mass,
  };
}

/** Snapshot-like factory. Defaults to period-1 5v5 at holding slots, phase live. */
export function createWorld(input: CreateWorldInput = {}): WorldState {
  const period = input.period ?? 1;
  const dirs = input.attackingDir ?? attackingDir(period);
  const bodies: Record<PlayerId, Body> = {};
  const fatigue: Record<PlayerId, number> = {};
  const homeOnIce: PlayerId[] = [];
  const awayOnIce: PlayerId[] = [];

  for (const side of ["home", "away"] as const) {
    const dir = dirs[side];
    const ids = side === "home" ? homeOnIce : awayOnIce;
    for (const position of POS_ORDER) {
      const b = makeBody(side, position, dir);
      bodies[b.id] = b;
      fatigue[b.id] = 0;
      ids.push(b.id);
    }
  }

  if (input.bodies) {
    for (const [id, patch] of Object.entries(input.bodies)) {
      if (!patch) continue;
      const prev = bodies[id];
      if (prev) {
        bodies[id] = overlayBody(prev, patch);
      } else {
        const side = patch.side ?? "home";
        const position = patch.position ?? "C";
        const dir = dirs[side];
        bodies[id] = overlayBody(makeBody(side, position, dir), { ...patch, id });
        fatigue[id] ??= 0;
      }
    }
  }

  if (input.fatigue) {
    for (const [id, f] of Object.entries(input.fatigue)) {
      fatigue[id] = f ?? 0;
    }
  }

  const playId = input.playId ?? { home: DEFAULT_PLAY_ID, away: DEFAULT_PLAY_ID };
  const directives = input.directives ?? {
    home: defaultDirective(playId.home),
    away: defaultDirective(playId.away),
  };

  const puckIn = input.puck;
  return {
    matchId: input.matchId ?? "match-test",
    seed: input.seed ?? 1,
    phase: input.phase ?? "live",
    period,
    clockRemaining: input.clockRemaining ?? PERIOD_SECONDS,
    liveTick: input.liveTick ?? 0,
    stoppageSeq: input.stoppageSeq ?? 0,
    attackingDir: { home: dirs.home, away: dirs.away },
    score: input.score ? { ...input.score } : { home: 0, away: 0 },
    strength: input.strength ?? "5v5",
    puck: {
      pos: cloneVec(puckIn?.pos ?? CENTER_ICE),
      vel: cloneVec(puckIn?.vel ?? vec(0, 0)),
      possessor: puckIn?.possessor ?? null,
      lastStick: puckIn?.lastStick ?? null,
    },
    bodies,
    onIce: input.onIce
      ? { home: [...input.onIce.home], away: [...input.onIce.away] }
      : { home: homeOnIce, away: awayOnIce },
    bench: input.bench ? { home: [...input.bench.home], away: [...input.bench.away] } : { home: [], away: [] },
    fatigue,
    penalties: input.penalties
      ? { home: [...input.penalties.home], away: [...input.penalties.away] }
      : { home: [], away: [] },
    delayedPenalty: input.delayedPenalty ?? null,
    delayedOffside: input.delayedOffside ?? null,
    icingRace: input.icingRace ?? null,
    whistle: input.whistle ?? null,
    faceoffSpot:
      input.faceoffSpot === undefined
        ? cloneVec(CENTER_ICE)
        : input.faceoffSpot === null
          ? null
          : cloneVec(input.faceoffSpot),
    netStatus: input.netStatus ? { ...input.netStatus } : { home: "on", away: "on" },
    smotherProgress: input.smotherProgress ? { ...input.smotherProgress } : { home: 0, away: 0 },
    goalieInNet: input.goalieInNet ? { ...input.goalieInNet } : { home: true, away: true },
    timeoutLeft: input.timeoutLeft ? { ...input.timeoutLeft } : { home: true, away: true },
    playId: { ...playId },
    directives: { home: directives.home, away: directives.away },
    lastEvents: input.lastEvents ? [...input.lastEvents] : [],
  };
}
