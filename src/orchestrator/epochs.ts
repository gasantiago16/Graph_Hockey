import type { TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import type { EpochKind, EpochReason, WhistleKind } from "../types/hockey.ts";
import type { WorldState } from "../engine/world.ts";

export const POSSESSION_REVIEW_TICKS = 80;

export type SideDecision = { kind: EpochKind; reason: EpochReason };
export type ShouldDecide = { home?: SideDecision; away?: SideDecision };

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

/** PR 8: stoppages only (whistle / faceoff / period / goal). No micro/macro split yet. */
export function classifyReason(world: WorldState, ev: readonly MatchEvent[]): EpochReason | null {
  if (world.phase === "game_over") return null;

  const types = new Set(ev.map((e) => e.type));

  if (types.has("Goal")) return "after_goal";
  if (types.has("PeriodEnd")) return "period_start";
  if (types.has("Penalty")) return "penalty_start";
  if (types.has("Timeout")) return "timeout";
  if (types.has("Icing")) return "icing";
  if (types.has("Offside")) return "offside";

  if (world.phase === "whistle") {
    return whistleReason(world.whistle);
  }

  if (types.has("FaceoffWin")) {
    const spot = world.faceoffSpot;
    const center = !spot || (spot.x === 0 && spot.y === 0);
    if (world.liveTick === 0 && center) return "period_start";
    return "faceoff";
  }

  if (
    types.has("Freeze") ||
    types.has("PuckOut") ||
    types.has("NetOff") ||
    types.has("HighStickGoalWavedOff")
  ) {
    return "faceoff";
  }

  return null;
}

/**
 * Stoppage epochs only. Every reason is labeled `macro` so PR 10's router has a producer.
 * Micro / playStillValid skip land in PR 12.
 */
export function shouldDecide(
  world: WorldState,
  ev: readonly MatchEvent[],
  _homeDir?: TeamDirective,
  _awayDir?: TeamDirective,
): ShouldDecide {
  const reason = classifyReason(world, ev);
  if (!reason) return {};
  const decision: SideDecision = { kind: "macro", reason };
  return { home: decision, away: decision };
}
