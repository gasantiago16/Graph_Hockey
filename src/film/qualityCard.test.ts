import { describe, expect, it } from "vitest";
import { loadPlaybook } from "../playbook/store.ts";
import {
  coadaptFlag,
  combinedChanceMean,
  evenNonDefault,
  evenShare,
  formatQualityCard,
  seriesQualityCard,
} from "./qualityCard.ts";

const home = loadPlaybook("original-six");
const away = loadPlaybook("expansion");

describe("combinedChanceMean", () => {
  it("is per-game sum of both sides, then mean", () => {
    expect(
      combinedChanceMean([
        { homeChances: 8, awayChances: 1 },
        { homeChances: 3, awayChances: 8 },
      ]),
    ).toBe(10);
    expect(combinedChanceMean([])).toBe(0);
  });
});

describe("evenShare / evenNonDefault", () => {
  it("counts 5v5 mix as even and 122 as default for original-six", () => {
    const mix = [
      { playId: "5v5-122-forecheck", directives: 7 },
      { playId: "pk1-box", directives: 11 },
      { playId: "nz-122-trap", directives: 1 },
    ];
    expect(evenShare(mix, home)).toEqual({ even: 8, total: 19, pct: (8 / 19) * 100 });
    expect(evenNonDefault(mix, home)).toEqual({ nonDefault: 1, even: 8 });
  });

  it("does not count protect-lead as non-default transfer", () => {
    const mix = [
      { playId: "5v5-122-forecheck", directives: 7 },
      { playId: "protect-lead-1-1-3", directives: 2 },
    ];
    expect(evenNonDefault(mix, home)).toEqual({ nonDefault: 0, even: 9 });
  });
});

describe("coadaptFlag", () => {
  it("labels opposing Δ xG as coadapt, not a quality fail", () => {
    expect(coadaptFlag(-0.042, 0.288)).toBe("coadapt");
    expect(coadaptFlag(0.1, -0.05)).toBe("coadapt");
    expect(coadaptFlag(0.1, 0.2)).toBe("both-up");
    expect(coadaptFlag(-0.1, -0.2)).toBe("both-down");
    expect(coadaptFlag(0.1, 0)).toBe("home-up");
    expect(coadaptFlag(0, 0.1)).toBe("away-up");
  });
});

describe("seriesQualityCard", () => {
  it("builds Evaluate-8-shaped combined mean and prints the card", () => {
    const games = [
      { homeChances: 8, awayChances: 1, homeOffsides: 0, awayOffsides: 2, homeXg: 0.771, awayXg: 0.01, homeMix: [{ playId: "5v5-122-forecheck", directives: 10 }], awayMix: [{ playId: "5v5-212-forecheck", directives: 10 }] },
      { homeChances: 8, awayChances: 3, homeOffsides: 0, awayOffsides: 0, homeXg: 0.7, awayXg: 0.36, homeMix: [{ playId: "5v5-122-forecheck", directives: 10 }], awayMix: [{ playId: "5v5-212-forecheck", directives: 10 }] },
    ];
    const card = seriesQualityCard(games, home, away, 4);
    expect(card.combinedChanceMean).toBeCloseTo(10);
    expect(card.homeChanceMean).toBe(8);
    expect(card.awayChanceMean).toBe(2);
    expect(card.offsMax).toEqual({ home: 0, away: 2 });
    expect(card.flag).toBe("coadapt");
    expect(card.evenNonDefault.home).toEqual({ nonDefault: 0, even: 20 });
    const lines = formatQualityCard(card);
    expect(lines[0]).toContain("combinedChanceMean");
    expect(lines.some((l) => l.includes("flag     coadapt"))).toBe(true);
    expect(lines.some((l) => l.includes("evenNonDefault  home 0/20"))).toBe(true);
  });
});
