import { describe, expect, it } from "vitest";
import {
  BLUE_LINE_X,
  CENTER_ICE,
  CORNER_CENTER_X,
  CORNER_CENTER_Y,
  CORNER_RADIUS,
  END_ZONE_FACEOFF_DOTS,
  END_ZONE_FACEOFF_X,
  FACEOFF_SPOTS,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_LINE_X,
  GOAL_WIDTH,
  HASH_OFFSET_Y,
  NEUTRAL_ZONE_LENGTH,
  NZ_FACEOFF_DOTS,
  RINK_LENGTH,
  RINK_WIDTH,
  attackingDir,
  isInsideRink,
} from "./rink.ts";

describe("rink geometry", () => {
  it("uses NHL-like dimensions in feet", () => {
    expect(RINK_LENGTH).toBe(200);
    expect(RINK_WIDTH).toBe(85);
    expect(CORNER_RADIUS).toBe(28);
    expect(GOAL_WIDTH).toBe(6);
    expect(GOAL_HEIGHT).toBe(4);
    expect(GOAL_DEPTH).toBe(2);
  });

  it("places the goal line at x=±89 and blue lines at x=±25", () => {
    expect(GOAL_LINE_X).toBe(89);
    expect(BLUE_LINE_X).toBe(25);
    expect(NEUTRAL_ZONE_LENGTH).toBe(50);
  });

  it("places end-zone faceoff dots at x=±69, y=±22", () => {
    expect(END_ZONE_FACEOFF_X).toBe(69);
    expect(HASH_OFFSET_Y).toBe(22);
    const keys = new Set(END_ZONE_FACEOFF_DOTS.map((p) => `${p.x},${p.y}`));
    expect(keys).toEqual(new Set(["69,22", "69,-22", "-69,22", "-69,-22"]));
  });

  it("places NZ faceoff dots at x=±20, y=±22 and center at 0,0", () => {
    expect(CENTER_ICE).toEqual({ x: 0, y: 0 });
    const keys = new Set(NZ_FACEOFF_DOTS.map((p) => `${p.x},${p.y}`));
    expect(keys).toEqual(new Set(["20,22", "20,-22", "-20,22", "-20,-22"]));
    expect(FACEOFF_SPOTS).toHaveLength(9);
  });

  it("documents attackingDir: home defends −X in period 1", () => {
    expect(attackingDir(1)).toEqual({ home: 1, away: -1 });
    expect(attackingDir(2)).toEqual({ home: -1, away: 1 });
    expect(attackingDir(3)).toEqual({ home: 1, away: -1 });
    expect(attackingDir("OT")).toEqual({ home: 1, away: -1 });
  });

  it("treats the ice as a 200×85 rounded rectangle (corner r=28)", () => {
    expect(isInsideRink({ x: 0, y: 0 })).toBe(true);
    expect(isInsideRink({ x: 99, y: 0 })).toBe(true);
    expect(isInsideRink({ x: 0, y: 42 })).toBe(true);
    expect(isInsideRink({ x: 101, y: 0 })).toBe(false);
    expect(isInsideRink({ x: 0, y: 43 })).toBe(false);
    expect(isInsideRink({ x: 100, y: 42.5 })).toBe(false);
    const onArc = {
      x: CORNER_CENTER_X + CORNER_RADIUS * Math.SQRT1_2,
      y: CORNER_CENTER_Y + CORNER_RADIUS * Math.SQRT1_2,
    };
    expect(isInsideRink(onArc, 0, 1e-9)).toBe(true);
    expect(isInsideRink({ x: onArc.x + 1, y: onArc.y + 1 })).toBe(false);
  });
});
