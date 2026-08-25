import { describe, expect, it } from "vitest";
import { loadPlaybook } from "./store.ts";
import { cosineSimilarity, playFeatureVector, playSimilarity, tooSimilar } from "./similarity.ts";
import { defaultStructurePlay } from "./schema.ts";

describe("play similarity", () => {
  it("is 1 for a play compared with itself", () => {
    const book = loadPlaybook("original-six");
    const play = book.plays.find((p) => p.id === "5v5-122-forecheck");
    expect(play).toBeTruthy();
    expect(playSimilarity(play!, play!)).toBeCloseTo(1, 10);
  });

  it("scores 1-2-2 closer to itself than to 2-1-2", () => {
    const os = loadPlaybook("original-six");
    const ex = loadPlaybook("expansion");
    const a = os.plays.find((p) => p.id === "5v5-122-forecheck");
    const b = ex.plays.find((p) => p.id === "5v5-212-forecheck");
    const c = os.plays.find((p) => p.id === "pk1-box");
    expect(a && b && c).toBeTruthy();
    const sim212 = playSimilarity(a!, b!);
    const simPk = playSimilarity(a!, c!);
    expect(sim212).toBeLessThan(1);
    expect(simPk).toBeLessThan(sim212);
  });

  it("treats near-duplicate slot vectors as too similar", () => {
    const play = defaultStructurePlay();
    const twin = {
      ...play,
      id: "clone",
      name: "Clone",
      family: play.family,
    };
    expect(tooSimilar(play, twin)).toBe(true);
    const far = loadPlaybook("expansion").plays.find((p) => p.id === "oz-crash-net");
    expect(far).toBeTruthy();
    expect(tooSimilar(play, far!)).toBe(false);
  });

  it("builds a finite feature vector and cosine of orthogonal axes is 0", () => {
    const v = playFeatureVector(defaultStructurePlay());
    expect(v.length).toBeGreaterThan(12);
    expect(v.every((n) => Number.isFinite(n))).toBe(true);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});
