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

  it("diverges for different seeds", () => {
    const a = take(1, 20);
    const b = take(2, 20);
    expect(a).not.toEqual(b);
  });
});
