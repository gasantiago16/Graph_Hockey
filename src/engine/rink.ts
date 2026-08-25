import type { AttackingDir, Period, Vec2 } from "../types/hockey.ts";

/** NHL ice, feet. Origin at center ice. +X toward the away net. +Y toward home bench. */
export const RINK_LENGTH = 200;
export const RINK_WIDTH = 85;
export const CORNER_RADIUS = 28;

export const GOAL_LINE_FROM_END = 11;
export const BLUE_LINE_FROM_END = 75;
export const GOAL_LINE_X = RINK_LENGTH / 2 - GOAL_LINE_FROM_END;
export const BLUE_LINE_X = RINK_LENGTH / 2 - BLUE_LINE_FROM_END;
export const NEUTRAL_ZONE_LENGTH = BLUE_LINE_X * 2;

export const GOAL_WIDTH = 6;
export const GOAL_HEIGHT = 4;
/** v1 simplification — NHL net depth is ~3.3 ft (40 in). */
export const GOAL_DEPTH = 2;
export const CREASE_RADIUS = 6;
export const FACEOFF_CIRCLE_R = 15;
/** Lateral hash / faceoff-dot offset. Longitudinal offset from the goal line is 20 ft, not this. */
export const HASH_OFFSET_Y = 22;
export const END_ZONE_DOT_OFFSET_X = 20;
export const END_ZONE_FACEOFF_X = GOAL_LINE_X - END_ZONE_DOT_OFFSET_X;
export const NZ_FACEOFF_X = 20;

export const DT = 0.1;
export const PERIOD_SECONDS = 1200;
export const PERIODS = 3;
export const OT_SECONDS = 300;
export const TICKS_PER_PERIOD = 12_000;
export const TICKS_PER_GAME_REG = 36_000;

export const CENTER_ICE: Vec2 = { x: 0, y: 0 };

const signs = [1, -1] as const;

export const NZ_FACEOFF_DOTS: readonly Vec2[] = signs.flatMap((sx) =>
  signs.map((sy) => ({ x: sx * NZ_FACEOFF_X, y: sy * HASH_OFFSET_Y })),
);

export const END_ZONE_FACEOFF_DOTS: readonly Vec2[] = signs.flatMap((sx) =>
  signs.map((sy) => ({ x: sx * END_ZONE_FACEOFF_X, y: sy * HASH_OFFSET_Y })),
);

/** All 9 NHL faceoff spots. */
export const FACEOFF_SPOTS: readonly Vec2[] = [
  CENTER_ICE,
  ...NZ_FACEOFF_DOTS,
  ...END_ZONE_FACEOFF_DOTS,
];

/**
 * Home typically defends −X in period 1 (attacks +X in periods 1 and 3).
 * Teams switch after each period. OT keeps period-3 ends.
 */
export function attackingDir(period: Period): { home: AttackingDir; away: AttackingDir } {
  const home: AttackingDir = period === 2 ? -1 : 1;
  return { home, away: home === 1 ? -1 : 1 };
}
