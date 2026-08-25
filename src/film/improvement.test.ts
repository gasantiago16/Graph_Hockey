import { describe, expect, it } from "vitest";
import { insertClip, insertRecording, listClips } from "../persist/clips.ts";
import { openMemoryDb } from "../persist/db.ts";
import { listImprovement } from "../persist/improvement.ts";
import { insertMatch } from "../persist/matches.ts";
import { ensureSeedPlaybooks } from "../persist/playbooks.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
import type { AarReport } from "../types/aar.ts";
import type { Clip, MatchAggregates } from "../types/film.ts";
import { EMPTY_AGGREGATES, loadSeriesImprovement, recordGameImprovement } from "./improvement.ts";

const aggs = (over: Partial<MatchAggregates>): MatchAggregates => ({ ...EMPTY_AGGREGATES, ...over });

function aar(side: "home" | "away", result: AarReport["result"], aggregates: MatchAggregates): AarReport {
  return {
    matchId: "unused",
    side,
    result,
    aggregates,
    revision: { summary: "code", ops: [] },
    noLlm: true,
  };
}

function clip(over: Partial<Clip> & Pick<Clip, "id" | "matchId" | "gameIndex" | "signature">): Clip {
  return {
    startLiveTick: 1,
    endLiveTick: 40,
    anchorEventId: `${over.matchId}:1`,
    relatedEventIds: [`${over.matchId}:1`],
    kind: "goal",
    title: "clip",
    source: "auto",
    playId: "dz-collapse",
    ...over,
  };
}

describe("recordGameImprovement + loadSeriesImprovement", () => {
  it("appends one ledger row per team and pairs G0 vs G1 on the same play+zone", async () => {
    const db = await openMemoryDb();
    try {
      ensureSeedPlaybooks(db);
      for (const gameIndex of [0, 1]) {
        const matchId = `ser-imp-g${gameIndex}`;
        insertMatch(
          db,
          makeOpeningSnapshot({
            matchId,
            seed: 100 + gameIndex,
            seriesId: "ser-imp",
            gameIndex,
          }),
        );
        insertRecording(db, {
          matchId,
          seriesId: "ser-imp",
          gameIndex,
          recordedAt: "2026-08-24T00:00:00.000Z",
          durationLiveTicks: 80,
        });
        insertClip(
          db,
          clip({
            id: `${matchId}:clip:0`,
            matchId,
            seriesId: "ser-imp",
            gameIndex,
            kind: gameIndex === 0 ? "goal" : "save",
            title: gameIndex === 0 ? "AWAY GOAL" : "Save",
            signature: gameIndex === 0 ? "dz-collapse|DZ|Goal,Shot" : "dz-collapse|DZ|Save,Shot",
            xG: 0.28,
          }),
        );
        expect(listClips(db, matchId)[0]?.gameIndex).toBe(gameIndex);
        recordGameImprovement({
          db,
          seriesId: "ser-imp",
          gameIndex,
          matchId,
          homeTeamId: "original-six",
          awayTeamId: "expansion",
          matchResult: gameIndex === 0 ? "away" : "home",
          playbookVersionBefore: { home: 1, away: 1 },
          aar: {
            home: aar("home", gameIndex === 0 ? "loss" : "win", aggs({ xgFor: 1 + gameIndex, xgAgainst: 4 - gameIndex, goalsFor: gameIndex, goalsAgainst: 1 - gameIndex, cfPct: 40 + 10 * gameIndex })),
            away: aar("away", gameIndex === 0 ? "win" : "loss", aggs({ xgFor: 4 - gameIndex, xgAgainst: 1 + gameIndex, goalsFor: 1 - gameIndex, goalsAgainst: gameIndex, cfPct: 60 - 10 * gameIndex })),
          },
        });
      }

      const rows = listImprovement(db, "ser-imp");
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.seriesId === "ser-imp")).toBe(true);
      expect(rows.filter((r) => r.gameIndex === 0).map((r) => r.teamId).sort()).toEqual([
        "expansion",
        "original-six",
      ]);

      const view = loadSeriesImprovement(db, "ser-imp");
      expect(view).toBeTruthy();
      expect(view!.games).toHaveLength(2);
      expect(view!.home.id).toBe("original-six");
      expect(view!.deltas.home.xgFor).toBe(1);
      expect(view!.deltas.home.xgAgainst).toBe(-1);
      expect(view!.pairs).toHaveLength(1);
      expect(view!.pairs[0]!.playId).toBe("dz-collapse");
      expect(view!.pairs[0]!.metricHint).toContain("Goal against");
      expect(view!.clips.every((c) => c.gameIndex !== undefined)).toBe(true);
    } finally {
      db.close();
    }
  });

  it("returns undefined when the series is unknown", async () => {
    const db = await openMemoryDb();
    try {
      expect(loadSeriesImprovement(db, "nope")).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
