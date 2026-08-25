import { describe, expect, it } from "vitest";
import { GOAL_LINE_X } from "./rink.ts";
import { createWorld } from "./world.ts";
import { shotFeatures, xgFromFeatures, xgLogit } from "./xg.ts";

describe("xG logistic §4.5", () => {
  it("matches the documented logit for a square 20 ft chance", () => {
    const f = {
      distanceFt: 20,
      angleFactor: 1,
      pressure: 0,
      traffic: 0 as const,
      rebound: 0 as const,
      rush: 0 as const,
      pp: 0 as const,
      sh: 0 as const,
    };
    expect(xgLogit(f)).toBeCloseTo(-1.75, 10);
    const xg = xgFromFeatures(f);
    expect(xg).toBeGreaterThanOrEqual(0.01);
    expect(xg).toBeLessThanOrEqual(0.95);
    expect(xg).toBeCloseTo(1 / (1 + Math.exp(1.75)), 10);
  });

  it("clamps to [0.01, 0.95]", () => {
    const tiny = xgFromFeatures({
      distanceFt: 200,
      angleFactor: 0,
      pressure: 1,
      traffic: 1,
      rebound: 0,
      rush: 0,
      pp: 0,
      sh: 1,
    });
    const huge = xgFromFeatures({
      distanceFt: 0,
      angleFactor: 1,
      pressure: 0,
      traffic: 0,
      rebound: 1,
      rush: 1,
      pp: 1,
      sh: 0,
    });
    expect(tiny).toBe(0.01);
    expect(huge).toBeLessThanOrEqual(0.95);
    expect(huge).toBeGreaterThan(0.5);
  });

  it("does not count the opposing goalie as traffic on a square 20 ft shot", () => {
    const shotPos = { x: GOAL_LINE_X - 20, y: 0 };
    const world = createWorld({
      bodies: {
        "h-C": { pos: shotPos, heading: 0 },
      },
    });
    const shooter = world.bodies["h-C"];
    expect(shooter).toBeTruthy();
    const clear = shotFeatures(world, shooter!, { x: 80, y: 0 }, shotPos);
    expect(clear.traffic).toBe(0);
    expect(clear.pressure).toBe(0);
    expect(xgLogit(clear)).toBeCloseTo(-1.75, 5);

    const screened = createWorld({
      bodies: {
        "h-C": { pos: shotPos, heading: 0 },
        "a-C": { pos: { x: GOAL_LINE_X - 8, y: 0 }, heading: Math.PI },
      },
    });
    const screenedShot = shotFeatures(screened, screened.bodies["h-C"]!, { x: 80, y: 0 }, shotPos);
    expect(screenedShot.traffic).toBe(1);
  });

  it("sets rebound from lastSaveLiveTick, not lastEvents[-1]", () => {
    const world = createWorld({
      liveTick: 20,
      lastSaveLiveTick: 10,
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: {
        "h-C": { pos: { x: 50, y: 0 }, heading: 0 },
        "a-C": { pos: { x: 0, y: 30 }, heading: 0 },
      },
    });
    const f = shotFeatures(world, world.bodies["h-C"]!, { x: 80, y: 0 }, { x: 50, y: 0 });
    expect(f.rebound).toBe(1);
  });

  it("sets sh=1 when the shooter is shorthanded (4v5)", () => {
    const world = createWorld({
      strength: "4v5",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: {
        "h-C": { pos: { x: 50, y: 0 }, heading: 0 },
        "a-C": { pos: { x: 0, y: 30 }, heading: 0 },
      },
    });
    const shooter = world.bodies["h-C"];
    expect(shooter).toBeTruthy();
    const f = shotFeatures(world, shooter!, { x: 80, y: 0 }, { x: 50, y: 0 });
    expect(f.sh).toBe(1);
    expect(f.pp).toBe(0);
  });
});
