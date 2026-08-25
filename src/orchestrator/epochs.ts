import type { TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import type { EpochKind, EpochReason, Period, Phase, Side, Strength, WhistleKind } from "../types/hockey.ts";
import type { WorldState } from "../engine/world.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { asPlayStrength, playStillValid } from "../playbook/retrieve.ts";
import { resolvePlay } from "../playbook/store.ts";

export const POSSESSION_REVIEW_TICKS = 80;
export const BENCH_REVIEW_TICKS = 900;
export const LAST_TWO_MINUTES_SECONDS = 120;

export type SideDecision = { kind: EpochKind; reason: EpochReason };
export type ShouldDecide = { home?: SideDecision; away?: SideDecision };

const MACRO_REASONS: ReadonlySet<EpochReason> = new Set([
  "period_start",
  "after_goal",
  "penalty_start",
  "special_teams_change",
  "timeout",
  "last_two_minutes",
  "score_state_flip",
  "bench_review",
]);

export function epochKindFor(reason: EpochReason): EpochKind {
  return MACRO_REASONS.has(reason) ? "macro" : "micro";
}

/** Per-match counters that cannot be recovered from a single WorldState snapshot. */
export type EpochTracker = {
  possessorSide: Side | null;
  possessorStreak: number;
  lastTwoMinutes: { 3?: boolean; OT?: boolean };
  leadSign: number;
  lastStrength: Strength | null;
  primed: boolean;
};

export function createEpochTracker(): EpochTracker {
  return {
    possessorSide: null,
    possessorStreak: 0,
    lastTwoMinutes: {},
    leadSign: 0,
    lastStrength: null,
    primed: false,
  };
}

function clockRuns(phase: Phase): boolean {
  return phase === "live" || phase === "delayed_offside" || phase === "delayed_penalty";
}

function possessorSideOf(world: WorldState): Side | null {
  const id = world.puck.possessor;
  if (!id) return null;
  return world.bodies[id]?.side ?? null;
}

function isSpecialTeamsStrength(strength: string): boolean {
  const tag = asPlayStrength(strength);
  return tag === "PP" || tag === "PK";
}

function specialTeamsChanged(prev: string, next: string): boolean {
  if (prev === next) return false;
  return isSpecialTeamsStrength(prev) || isSpecialTeamsStrength(next);
}

function isCenterSpot(world: WorldState): boolean {
  const spot = world.faceoffSpot;
  return !spot || (spot.x === 0 && spot.y === 0);
}

function tickPossession(tracker: EpochTracker, world: WorldState): void {
  if (!clockRuns(world.phase)) {
    tracker.possessorSide = null;
    tracker.possessorStreak = 0;
    return;
  }
  const side = possessorSideOf(world);
  if (!side) {
    tracker.possessorSide = null;
    tracker.possessorStreak = 0;
    return;
  }
  if (side === tracker.possessorSide) {
    tracker.possessorStreak += 1;
  } else {
    tracker.possessorSide = side;
    tracker.possessorStreak = 1;
  }
}

function commitTracker(tracker: EpochTracker, world: WorldState): void {
  tracker.leadSign = Math.sign(world.score.home - world.score.away);
  tracker.lastStrength = world.strength;
  tracker.primed = true;
}

function whistleReason(kind: WhistleKind | null): EpochReason {
  switch (kind) {
    case "goal":
      return "after_goal";
    case "period_end":
      return "period_start";
    case "penalty":
      return "penalty_start";
    case "icing":
      return "icing";
    case "offside":
      return "offside";
    default:
      return "faceoff";
  }
}

function whistleIs(world: WorldState, kind: WhistleKind): boolean {
  return world.phase === "whistle" && world.whistle === kind;
}

function isPeriodStart(world: WorldState, types: ReadonlySet<string>): boolean {
  if (types.has("PeriodEnd") || whistleIs(world, "period_end")) return true;
  if (types.has("FaceoffWin") && world.liveTick === 0 && isCenterSpot(world)) return true;
  return false;
}

function isOtherFaceoff(world: WorldState, types: ReadonlySet<string>): boolean {
  if (types.has("FaceoffWin") || types.has("Freeze") || types.has("PuckOut") || types.has("NetOff") || types.has("HighStickGoalWavedOff")) {
    return true;
  }
  if (world.phase !== "whistle") return false;
  const k = world.whistle;
  return k === "freeze" || k === "puck_out" || k === "net_off" || k === "high_stick_goal_waved_off" || k === null;
}

/**
 * 12-row whistle table (first match wins). Macro rows preempt micro.
 * Tracker-backed rows (last two minutes, lead flip, ST change, possession) no-op without a tracker.
 */
export function classifyReason(
  world: WorldState,
  ev: readonly MatchEvent[],
  tracker?: EpochTracker,
): EpochReason | null {
  if (world.phase === "game_over") return null;

  const types = new Set(ev.map((e) => e.type));

  if (isPeriodStart(world, types)) return "period_start";
  if (types.has("Goal") || whistleIs(world, "goal")) return "after_goal";
  if (types.has("Penalty") || whistleIs(world, "penalty")) return "penalty_start";
  if (
    tracker?.primed &&
    tracker.lastStrength &&
    specialTeamsChanged(tracker.lastStrength, world.strength)
  ) {
    return "special_teams_change";
  }
  if (types.has("Timeout")) return "timeout";

  if (
    tracker &&
    (world.period === 3 || world.period === "OT") &&
    world.clockRemaining <= LAST_TWO_MINUTES_SECONDS &&
    world.liveTick > 0
  ) {
    const key: Extract<Period, 3 | "OT"> = world.period === "OT" ? "OT" : 3;
    if (!tracker.lastTwoMinutes[key]) {
      tracker.lastTwoMinutes[key] = true;
      return "last_two_minutes";
    }
  }

  if (tracker?.primed) {
    const sign = Math.sign(world.score.home - world.score.away);
    if (sign !== tracker.leadSign) return "score_state_flip";
  }

  if (world.liveTick > 0 && world.liveTick % BENCH_REVIEW_TICKS === 0) {
    return "bench_review";
  }

  if (types.has("Icing") || whistleIs(world, "icing")) return "icing";
  if (types.has("Offside") || whistleIs(world, "offside")) return "offside";
  if (isOtherFaceoff(world, types)) return "faceoff";
  if (world.phase === "whistle") return whistleReason(world.whistle);
  if (types.has("ZoneEntry")) return "zone_entry";
  if (
    tracker &&
    tracker.possessorStreak > 0 &&
    tracker.possessorStreak % POSSESSION_REVIEW_TICKS === 0
  ) {
    return "possession_review";
  }

  return null;
}

function playForSide(world: WorldState, side: Side, dir?: TeamDirective) {
  const playId = world.playId[side] || dir?.playId || DEFAULT_PLAY_ID;
  return resolvePlay(playId, world.playbooks?.[side]);
}

/**
 * Per-side epoch filter. Micro + playStillValid skips that side only. Macro never skips.
 */
export function shouldDecide(
  world: WorldState,
  ev: readonly MatchEvent[],
  homeDir?: TeamDirective,
  awayDir?: TeamDirective,
  tracker?: EpochTracker,
): ShouldDecide {
  if (tracker) tickPossession(tracker, world);
  const reason = classifyReason(world, ev, tracker);
  if (tracker) commitTracker(tracker, world);
  if (!reason) return {};

  const kind = epochKindFor(reason);
  const dirs = { home: homeDir, away: awayDir };
  const out: ShouldDecide = {};
  for (const side of ["home", "away"] as const) {
    if (kind === "micro") {
      const play = playForSide(world, side, dirs[side]);
      if (playStillValid(play, world, side)) continue;
    }
    out[side] = { kind, reason };
  }
  return out;
}
