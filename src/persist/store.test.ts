import { describe, expect, it } from "vitest";
import { makeEventId } from "../types/ids.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { insertClip, insertRecording, listClips } from "./clips.ts";
import { openMemoryDb } from "./db.ts";
import { insertEvents, listEvents, listEpochInvocations, loadDirectivesByTick, persistEpoch } from "./events.ts";
import { insertImprovementRow, listImprovement } from "./improvement.ts";
import { getMatch, insertAarReport, insertMatch, loadOpeningSnapshot } from "./matches.ts";
import { ensureSeedPlaybooks, getPlaybook } from "./playbooks.ts";
import { makeOpeningSnapshot } from "./snapshot.ts";

describe("persist matches/events", () => {
  it("stores OpeningSnapshot in config_json and events.id = match_id:seq", async () => {
    const db = await openMemoryDb();
    try {
      const snap = makeOpeningSnapshot({ matchId: "abc", seed: 42 });
      insertMatch(db, snap, "2026-08-24T00:00:00.000Z");
      const loaded = loadOpeningSnapshot(db, "abc");
      expect(loaded.matchId).toBe("abc");
      expect(loaded.seed).toBe(42);
      expect(loaded.homeTeamId).toBe("original-six");
      expect(loaded.rosters.home.players.length).toBe(20);
      expect(getMatch(db, "abc")?.snapshot.models.home).toBe("none");

      const events = [
        {
          id: makeEventId("abc", 0),
          seq: 0,
          liveTick: 0,
          stoppageSeq: 1,
          period: 1 as const,
          type: "FaceoffWin",
        },
        {
          id: makeEventId("abc", 1),
          seq: 1,
          liveTick: 4,
          stoppageSeq: 1,
          period: 1 as const,
          type: "DirectiveApplied",
          payload: {
            side: "home",
            directive: { playId: DEFAULT_PLAY_ID, pressure: "aggressive" },
            liveTick: 4,
            stoppageSeq: 1,
          },
        },
      ];
      insertEvents(db, "abc", events, 1199.6);
      const listed = listEvents(db, "abc");
      expect(listed.map((e) => e.id)).toEqual(["abc:0", "abc:1"]);
      expect(listed[1]?.type).toBe("DirectiveApplied");
      const dirs = loadDirectivesByTick(db, "abc");
      expect(dirs.get("4:1")?.home?.pressure).toBe("aggressive");

      persistEpoch(db, {
        matchId: "abc",
        seq: 0,
        side: "home",
        reason: "faceoff",
        epochKind: "macro",
        model: null,
        ok: false,
        billed: false,
        directive: { playId: DEFAULT_PLAY_ID, pressure: "neutral" },
      });
      expect(listEpochInvocations(db, "abc")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects event ids that are not match_id:seq", async () => {
    const db = await openMemoryDb();
    try {
      const snap = makeOpeningSnapshot({ matchId: "m", seed: 1 });
      insertMatch(db, snap, "2026-08-24T00:00:00.000Z");
      expect(() =>
        insertEvents(db, "m", [
          {
            id: "other:0",
            seq: 0,
            liveTick: 0,
            stoppageSeq: 0,
            period: 1,
            type: "Whistle",
          },
        ]),
      ).toThrow(/event id/);
    } finally {
      db.close();
    }
  });

  it("copies seed playbooks to version 1", async () => {
    const db = await openMemoryDb();
    try {
      ensureSeedPlaybooks(db);
      const book = getPlaybook(db, "original-six", 1);
      expect(book?.body.plays[0]?.id).toBe("5v5-122-forecheck");
      ensureSeedPlaybooks(db);
      expect(getPlaybook(db, "original-six", 1)?.version).toBe(1);
    } finally {
      db.close();
    }
  });

  it("round-trips recordings, clips, improvement ledger, and AAR reports", async () => {
    const db = await openMemoryDb();
    try {
      const snap = makeOpeningSnapshot({ matchId: "m1", seed: 2 });
      insertMatch(db, snap, "2026-08-24T00:00:00.000Z");
      insertRecording(db, {
        matchId: "m1",
        seriesId: "s1",
        gameIndex: 0,
        recordedAt: "2026-08-24T00:00:00.000Z",
        durationLiveTicks: 200,
      });
      insertClip(db, {
        id: "m1:clip:0",
        matchId: "m1",
        seriesId: "s1",
        startLiveTick: 80,
        endLiveTick: 111,
        anchorEventId: "m1:2",
        relatedEventIds: ["m1:2"],
        kind: "goal",
        title: "HOME GOAL",
        side: "home",
        playId: "oz-cycle-low",
        xG: 0.22,
        source: "auto",
        signature: "oz-cycle-low|OZ|Goal",
      });
      expect(listClips(db, "m1")).toHaveLength(1);
      insertImprovementRow(db, {
        seriesId: "s1",
        teamId: "original-six",
        gameIndex: 0,
        matchId: "m1",
        playbookVersionBefore: 1,
        playbookVersionAfter: 1,
        result: "win",
        metrics: {
          aggregates: {
            xgFor: 1,
            xgAgainst: 0.5,
            cfPct: 55,
            zoneTimeOZ: 10,
            zoneTimeDZ: 8,
            turnovers: 1,
            foPct: 50,
            ppPct: null,
            pkPct: null,
            goalsFor: 1,
            goalsAgainst: 0,
          },
          clipCounts: { goal: 1 },
        },
        aarOps: [],
        pairedClipIds: [],
      });
      expect(listImprovement(db, "s1")[0]?.result).toBe("win");
      insertAarReport(db, "m1", "home", { summary: "ok" }, false);
    } finally {
      db.close();
    }
  });
});
