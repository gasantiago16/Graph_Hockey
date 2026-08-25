import { describe, expect, it } from "vitest";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import {
  benchFatigueDelta,
  FATIGUE_CHANGE_THRESHOLD,
  onIceFatigueDelta,
  SHIFT_TARGET_SECONDS,
  tickFatigue,
  wantsAutoChange,
} from "./fatigue.ts";
import { DT } from "./rink.ts";
import { createRng } from "./rng.ts";
import { advanceWorld } from "./step.ts";
import { addBenchLine, createWorld, defaultDirective } from "./world.ts";

const dirs = {
  home: defaultDirective(DEFAULT_PLAY_ID),
  away: defaultDirective(DEFAULT_PLAY_ID),
};

describe("fatigue", () => {
  it("adds DT/(25+stamina/5) on ice and recovers DT/40 on the bench", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: [] },
      bench: { home: ["h-LW"], away: [] },
      bodies: {
        "h-C": { attributes: { ...baseAttrs(), stamina: 50 } },
        "h-LW": { attributes: { ...baseAttrs(), stamina: 50 } },
      },
    });
    tickFatigue(world, DT);
    expect(world.fatigue["h-C"]).toBeCloseTo(onIceFatigueDelta(DT, 50), 10);
    expect(world.fatigue["h-LW"]).toBeCloseTo(0, 10);
    world.fatigue["h-LW"] = 0.4;
    tickFatigue(world, DT);
    expect(world.fatigue["h-LW"]).toBeCloseTo(0.4 - benchFatigueDelta(DT), 10);
    expect(world.shiftTime["h-C"]).toBeCloseTo(2 * DT, 10);
    expect(world.shiftTime["h-LW"]).toBe(0);
  });

  it("auto-changes a tired skater unless lockLines, and keeps 5 skaters", () => {
    const world = createWorld({
      phase: "live",
      puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: "h-C" },
      fatigue: { "h-C": FATIGUE_CHANGE_THRESHOLD + 0.01 },
      shiftTime: { "h-C": SHIFT_TARGET_SECONDS },
    });
    addBenchLine(world, "home", "F2");
    expect(wantsAutoChange(world, "h-C", false)).toBe(true);
    expect(wantsAutoChange(world, "h-C", true)).toBe(false);

    advanceWorld(world, dirs, createRng(1));
    expect(world.onIce.home).not.toContain("h-C");
    expect(world.onIce.home).toContain("h-F2-C");
    expect(world.bench.home).toContain("h-C");
    expect(world.onIce.home.filter((id) => world.bodies[id]?.position !== "G")).toHaveLength(5);
    expect(world.lastEvents.some((e) => e.type === "LineChange")).toBe(true);

    const locked = createWorld({
      phase: "live",
      puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: "h-C" },
      fatigue: { "h-C": 0.9 },
      directives: {
        home: { ...defaultDirective(), lockLines: true },
        away: defaultDirective(),
      },
    });
    addBenchLine(locked, "home", "F2");
    advanceWorld(
      locked,
      { home: { ...defaultDirective(), lockLines: true }, away: defaultDirective() },
      createRng(1),
    );
    expect(locked.onIce.home).toContain("h-C");
    expect(locked.lastEvents.some((e) => e.type === "LineChange")).toBe(false);
  });
});

function baseAttrs() {
  return {
    speed: 50,
    accel: 50,
    agility: 50,
    shooting: 50,
    passing: 50,
    faceoff: 50,
    defense: 50,
    physical: 50,
    vision: 50,
    discipline: 50,
    stamina: 50,
  };
}
