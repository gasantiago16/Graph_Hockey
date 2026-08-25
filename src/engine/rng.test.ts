import { describe, expect, it } from "vitest";
import { createRng } from "./rng.ts";

function take(seed: number, n: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
}

describe("createRng (mulberry32)", () => {
  it("returns values in [0, 1)", () => {
    const values = take(42, 10_000);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("yields the same sequence for the same seed", () => {
    expect(take(42, 32)).toEqual(take(42, 32));
    expect(take(0, 8)).toEqual(take(0, 8));
  });

  it("matches the canonical mulberry32 stream for seed 42 and 0", () => {
    expect(take(42, 8)).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
      0.6697340414393693,
      0.17481389874592423,
      0.5265925421845168,
      0.2732279943302274,
      0.6247446539346129,
    ]);
    expect(take(0, 8)).toEqual([
      0.26642920868471265,
      0.0003297457005828619,
      0.2232720274478197,
      0.1462021479383111,
      0.46732782293111086,
      0.5450490827206522,
      0.6152513844426721,
      0.6489853798411787,
    ]);
  });

  it("diverges for different seeds", () => {
    const a = take(1, 20);
    const b = take(2, 20);
    expect(a).not.toEqual(b);
  });
});
