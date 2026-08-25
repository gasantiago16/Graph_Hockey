import { describe, expect, it } from "vitest";
import { autoClips, toClipEvents } from "./clipper.ts";
import { jaccard, pairClips } from "./pairClips.ts";
import { formatDelta, seriesImprovement } from "./improvement.ts";
import type { Clip, ClipEvent, MatchAggregates, SeriesGameRow } from "../types/film.ts";

const aggs = (over: Partial<MatchAggregates>): MatchAggregates => ({
  xgFor: 0,
  xgAgainst: 0,
  cfPct: 50,
  zoneTimeOZ: 0,
  zoneTimeDZ: 0,
  turnovers: 0,
  foPct: 50,
  ppPct: null,
  pkPct: null,
  goalsFor: 0,
  goalsAgainst: 0,
  ...over,
});

describe("autoClips", () => {
  it("builds a goal clip with a 40-tick lookback", () => {
    const events: ClipEvent[] = [
      { id: "m:0", type: "ZoneEntry", liveTick: 80, zone: "OZ", playId: "oz-cycle-low", side: "home" },
      { id: "m:1", type: "Shot", liveTick: 95, zone: "OZ", playId: "oz-cycle-low", side: "home", xG: 0.22 },
      { id: "m:2", type: "Goal", liveTick: 96, zone: "OZ", playId: "oz-cycle-low", side: "home", xG: 0.22 },
    ];
    const clips = autoClips(events, { matchId: "m", durationLiveTicks: 200 });
    const goal = clips.find((c) => c.kind === "goal");
    expect(goal).toBeTruthy();
    expect(goal!.startLiveTick).toBe(56);
    expect(goal!.endLiveTick).toBe(111);
    expect(goal!.anchorEventId).toBe("m:2");
  });

  it("merges overlapping goal and shot into one goal clip", () => {
    const events: ClipEvent[] = [
      { id: "m:1", type: "Shot", liveTick: 100, zone: "OZ", playId: "p", side: "away", xG: 0.3 },
      { id: "m:2", type: "Goal", liveTick: 101, zone: "OZ", playId: "p", side: "away", xG: 0.3 },
    ];
    const clips = autoClips(events, { matchId: "m", durationLiveTicks: 400 });
    const goals = clips.filter((c) => c.kind === "goal");
    const shots = clips.filter((c) => c.kind === "shot");
    expect(goals).toHaveLength(1);
    expect(shots).toHaveLength(0);
    expect(goals[0]!.relatedEventIds).toEqual(expect.arrayContaining(["m:1", "m:2"]));
  });

  it("ignores low-xG shots and NZ turnovers", () => {
    const events: ClipEvent[] = [
      { id: "m:1", type: "Shot", liveTick: 50, zone: "OZ", playId: "p", side: "home", xG: 0.04 },
      { id: "m:2", type: "Turnover", liveTick: 80, zone: "NZ", playId: "p", side: "home" },
    ];
    expect(autoClips(events, { matchId: "m", durationLiveTicks: 200 })).toEqual([]);
  });

  it("keeps AAR cites even when the auto cap is full", () => {
    const events: ClipEvent[] = [];
    for (let i = 0; i < 50; i++) {
      events.push({
        id: `m:${i}`,
        type: "Shot",
        liveTick: i * 80,
        zone: "OZ",
        playId: "p",
        side: "home",
        xG: 0.13,
      });
    }
    events.push({ id: "m:goal", type: "Goal", liveTick: 10, zone: "OZ", playId: "p", side: "home", xG: 0.4 });
    const clips = autoClips(events, {
      matchId: "m",
      durationLiveTicks: 50 * 80,
      aarEventIds: ["m:goal"],
    });
    expect(clips.length).toBeLessThanOrEqual(48);
    expect(clips.some((c) => c.kind === "goal" || c.relatedEventIds.includes("m:goal"))).toBe(true);
  });

  it("maps match events (payload side + directive playId) into clip events", () => {
    const mapped = toClipEvents([
      {
        id: "m:0",
        seq: 0,
        liveTick: 4,
        stoppageSeq: 1,
        period: 1,
        type: "DirectiveApplied",
        payload: { side: "home", directive: { playId: "oz-cycle-low", pressure: "neutral" } },
      },
      {
        id: "m:1",
        seq: 1,
        liveTick: 90,
        stoppageSeq: 1,
        period: 1,
        type: "Shot",
        zone: "OZ",
        xG: 0.22,
        payload: { side: "home" },
      },
      {
        id: "m:2",
        seq: 2,
        liveTick: 91,
        stoppageSeq: 1,
        period: 1,
        type: "Goal",
        zone: "OZ",
        xG: 0.22,
        payload: { side: "home" },
      },
    ]);
    expect(mapped[1]?.side).toBe("home");
    expect(mapped[1]?.playId).toBe("oz-cycle-low");
    const clips = autoClips(mapped, { matchId: "m", durationLiveTicks: 200 });
    expect(clips.some((c) => c.kind === "goal")).toBe(true);
  });
});

describe("pairClips", () => {
  it("pairs same play+zone across early and late games", () => {
    const clips: Clip[] = [
      {
        id: "g0:c0",
        matchId: "g0",
        gameIndex: 0,
        startLiveTick: 1,
        endLiveTick: 50,
        anchorEventId: "g0:1",
        relatedEventIds: ["g0:1"],
        kind: "goal",
        title: "AWAY GOAL",
        source: "auto",
        signature: "dz-collapse|DZ|Goal,Shot",
        playId: "dz-collapse",
        xG: 0.28,
      },
      {
        id: "g6:c0",
        matchId: "g6",
        gameIndex: 6,
        startLiveTick: 1,
        endLiveTick: 50,
        anchorEventId: "g6:1",
        relatedEventIds: ["g6:1"],
        kind: "save",
        title: "Save",
        source: "auto",
        signature: "dz-collapse|DZ|Save,Shot",
        playId: "dz-collapse",
        xG: 0.27,
      },
    ];
    const pairs = pairClips(clips, 7);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.playId).toBe("dz-collapse");
    expect(pairs[0]!.metricHint).toContain("Goal against");
  });

  it("jaccard is 1 for identical bags", () => {
    expect(jaccard(["Shot", "Goal"], ["Goal", "Shot"])).toBe(1);
    expect(jaccard(["Shot"], ["Goal"])).toBe(0);
  });
});

describe("seriesImprovement", () => {
  it("records last-minus-first deltas for both teams", () => {
    const games: SeriesGameRow[] = [
      {
        matchId: "g0",
        gameIndex: 0,
        score: { home: 2, away: 5 },
        result: { home: "loss", away: "win" },
        playbookVersion: { home: 1, away: 1 },
        aggregates: {
          home: aggs({ xgFor: 1.6, xgAgainst: 4.4, cfPct: 41, goalsFor: 2, goalsAgainst: 5 }),
          away: aggs({ xgFor: 4.4, xgAgainst: 1.6, cfPct: 59, goalsFor: 5, goalsAgainst: 2 }),
        },
        clipCounts: { goal: 7 },
      },
      {
        matchId: "g6",
        gameIndex: 6,
        score: { home: 4, away: 1 },
        result: { home: "win", away: "loss" },
        playbookVersion: { home: 5, away: 4 },
        aggregates: {
          home: aggs({ xgFor: 3.2, xgAgainst: 2.1, cfPct: 54, goalsFor: 4, goalsAgainst: 1 }),
          away: aggs({ xgFor: 2.1, xgAgainst: 3.2, cfPct: 46, goalsFor: 1, goalsAgainst: 4 }),
        },
        clipCounts: { goal: 5 },
      },
    ];
    const imp = seriesImprovement("demo", games, []);
    expect(imp.deltas.home.xgFor).toBe(1.6);
    expect(imp.deltas.home.xgAgainst).toBe(-2.3);
    expect(imp.deltas.home.goalsFor).toBe(2);
    expect(formatDelta("home", imp)).toContain("home Δ xG +1.6/-2.3");
  });
});
