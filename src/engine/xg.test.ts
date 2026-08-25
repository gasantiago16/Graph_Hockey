import { describe, expect, it } from "vitest";
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
