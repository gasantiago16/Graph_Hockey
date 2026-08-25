import { describe, expect, it } from "vitest";
import type { PairedClip, SeriesGameRow, SeriesImprovement } from "../types/film.ts";
import { EMPTY_AGGREGATES } from "../film/improvement.ts";
import {
  defaultCompareGames,
  pairButtonLabel,
  pairRinkLabels,
  parseCompareParam,
  parseSeriesFilmLocation,
  renderDeltasHtml,
  renderPairsHtml,
  seriesFilmHref,
} from "./improvementBoard.ts";

const pair: PairedClip = {
  signature: "dz-collapse|DZ|Goal,Shot",
  playId: "dz-collapse",
  zone: "DZ",
  metricHint: "Goal against → save",
  early: {
    id: "g0:c0",
    matchId: "g0",
    gameIndex: 0,
    startLiveTick: 1,
    endLiveTick: 40,
    anchorEventId: "g0:1",
    relatedEventIds: ["g0:1"],
    kind: "goal",
    title: "AWAY GOAL",
    source: "auto",
    playId: "dz-collapse",
  },
  late: {
    id: "g6:c0",
    matchId: "g6",
    gameIndex: 6,
    startLiveTick: 1,
    endLiveTick: 40,
    anchorEventId: "g6:1",
    relatedEventIds: ["g6:1"],
    kind: "save",
    title: "Save",
    source: "auto",
    playId: "dz-collapse",
  },
};

function game(index: number, xgFor: number): SeriesGameRow {
  return {
    matchId: `g${index}`,
    gameIndex: index,
    score: { home: 1, away: 2 },
    result: { home: "loss", away: "win" },
    playbookVersion: { home: 1 + index, away: 1 },
    aggregates: {
      home: { ...EMPTY_AGGREGATES, xgFor, xgAgainst: 4, goalsFor: 1, cfPct: 45 },
      away: { ...EMPTY_AGGREGATES, xgFor: 4, xgAgainst: xgFor, goalsFor: 2, cfPct: 55 },
    },
    clipCounts: { goal: 1 },
  };
}

describe("improvement board query + labels", () => {
  it("parses /film/series/:id and /film?series= with compare", () => {
    expect(parseSeriesFilmLocation("/film/series/ser-1", "")).toEqual({
      seriesId: "ser-1",
      compare: undefined,
    });
    expect(parseSeriesFilmLocation("/film/series/ser-1/", "?compare=0,6")).toEqual({
      seriesId: "ser-1",
      compare: { early: 0, late: 6 },
    });
    expect(parseSeriesFilmLocation("/film", "?series=ser-9&compare=0,6")).toEqual({
      seriesId: "ser-9",
      compare: { early: 0, late: 6 },
    });
    expect(parseCompareParam("0,6")).toEqual({ early: 0, late: 6 });
    expect(parseCompareParam("nope")).toBeUndefined();
    expect(defaultCompareGames(7)).toEqual({ early: 0, late: 6 });
    expect(defaultCompareGames(1)).toBeUndefined();
    expect(seriesFilmHref("ser-1")).toBe("/film?series=ser-1");
  });

  it("labels dual-rink G{early} play vs G{late} play", () => {
    expect(pairRinkLabels(pair)).toEqual({ early: "G0 dz-collapse", late: "G6 dz-collapse" });
    expect(pairButtonLabel(pair).title).toBe("dz-collapse · DZ");
    expect(pairButtonLabel(pair).hint).toContain("G0 goal → G6 save");
  });

  it("renders deltas and pair buttons", () => {
    const improvement: SeriesImprovement = {
      seriesId: "ser-1",
      games: [game(0, 1.6), game(6, 3.2)],
      deltas: { home: { xgFor: 1.6, xgAgainst: 0, goalsFor: 0, goalsAgainst: 0, cfPct: 0 }, away: {} },
      pairs: [pair],
    };
    const html = renderDeltasHtml(improvement, "home", "Original Six");
    expect(html).toContain("Original Six");
    expect(html).toContain("G0 → G6");
    expect(html).toContain("v1 → v7");
    expect(renderPairsHtml(improvement.pairs)).toContain("dz-collapse");
    expect(renderPairsHtml([])).toContain("Jaccard");
  });
});
