import { describe, expect, it } from "vitest";
import { applyAarRevision } from "../aar/apply.ts";
import { openMemoryDb } from "../persist/db.ts";
import { insertEvents } from "../persist/events.ts";
import { insertAarReport, insertMatch } from "../persist/matches.ts";
import { ensureSeedPlaybooks, latestPlaybook } from "../persist/playbooks.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { makeEventId } from "../types/ids.ts";
import type { AarReport } from "../types/aar.ts";
import { aarApiResponse, playbookApiResponse } from "./reports.ts";

function aarBody(over: Partial<AarReport> = {}): AarReport {
  return {
    matchId: "m1",
    side: "home",
    result: "win",
    intentSummary: "Hold structure",
    actualSummary: "xG 1-0",
    causes: [{ claim: "goal", eventIds: ["m1:0"], playIds: ["5v5-122-forecheck"] }],
    revision: {
      summary: "lock",
      ops: [{ op: "boost", playId: "5v5-122-forecheck", reason: "goal sequence", eventIds: ["m1:0"] }],
    },
    playbook: loadPlaybook("original-six"),
    ...over,
  };
}

async function primed() {
  const db = await openMemoryDb();
  insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
  insertEvents(db, "m1", [
    {
      id: makeEventId("m1", 0),
      seq: 0,
      liveTick: 4,
      stoppageSeq: 0,
      period: 1,
      type: "DirectiveApplied",
      payload: { side: "home", directive: { playId: "5v5-122-forecheck", pressure: "neutral" } },
    },
    {
      id: makeEventId("m1", 1),
      seq: 1,
      liveTick: 10,
      stoppageSeq: 0,
      period: 1,
      type: "Shot",
      zone: "OZ",
      xG: 0.2,
      actor: "h-C",
      payload: { side: "home" },
    },
    {
      id: makeEventId("m1", 2),
      seq: 2,
      liveTick: 12,
      stoppageSeq: 0,
      period: 1,
      type: "Goal",
      zone: "OZ",
      xG: 0.2,
      payload: { side: "home" },
    },
  ]);
  ensureSeedPlaybooks(db);
  return db;
}

describe("GET /api/aar payload", () => {
  it("returns stored supposed/actual/why/ops and strips playbook", async () => {
    const db = await primed();
    try {
      insertAarReport(db, "m1", "home", aarBody(), false);
      const bad = aarApiResponse(db, "m1", "neither");
      expect(bad.status).toBe(400);
      const missing = aarApiResponse(db, "m1", "away");
      expect(missing.status).toBe(404);
      const out = aarApiResponse(db, "m1", "home");
      expect(out.status).toBe(200);
      const body = out.body as Record<string, unknown>;
      expect(body.matchId).toBe("m1");
      expect(body.side).toBe("home");
      expect(body.applied).toBe(false);
      expect(body.intentSummary).toBe("Hold structure");
      expect(body.actualSummary).toBe("xG 1-0");
      expect(body.teamId).toBe("original-six");
      expect(body).not.toHaveProperty("playbook");
      expect(body).not.toHaveProperty("eventLogDigest");
      expect(JSON.stringify(body)).not.toContain("XAI_API_KEY");
      const revision = body.revision as { ops: { eventIds: string[] }[] };
      expect(revision.ops[0]?.eventIds).toEqual(["m1:0"]);
    } finally {
      db.close();
    }
  });
});

describe("GET /api/playbook/:team?diff=1", () => {
  it("returns digest and version diff after an applied AAR", async () => {
    const db = await primed();
    try {
      const seed = playbookApiResponse(db, "original-six", { diff: "1" });
      expect(seed.status).toBe(200);
      const seedBody = seed.body as { version: number; diff: { changed: unknown[] }; plays: { id: string }[] };
      expect(seedBody.version).toBe(1);
      expect(seedBody.diff.changed).toEqual([]);
      expect(seedBody.plays.some((p) => p.id === "5v5-122-forecheck")).toBe(true);
      expect(JSON.stringify(seedBody)).not.toContain("formation");
      expect(JSON.stringify(seedBody)).not.toContain("XAI_API_KEY");

      applyAarRevision({
        db,
        teamId: "original-six",
        playbook: loadPlaybook("original-six"),
        report: aarBody(),
        mode: "auto",
      });
      expect(latestPlaybook(db, "original-six")?.version).toBe(2);

      const diff = playbookApiResponse(db, "original-six", { diff: "1", match: "m1" });
      expect(diff.status).toBe(200);
      const body = diff.body as {
        version: number;
        aarMatchId: string | null;
        diff: { fromVersion: number; toVersion: number; changed: { id: string; fields?: string[] }[] };
      };
      expect(body.version).toBe(2);
      expect(body.aarMatchId).toBe("m1");
      expect(body.diff.fromVersion).toBe(1);
      expect(body.diff.toVersion).toBe(2);
      expect(body.diff.changed.some((c) => c.id === "5v5-122-forecheck")).toBe(true);

      expect(playbookApiResponse(db, "no-such-team").status).toBe(404);
      expect(playbookApiResponse(db, "original-six", { version: "99" }).status).toBe(404);
      expect(playbookApiResponse(db, "original-six", { match: "missing" }).status).toBe(404);
    } finally {
      db.close();
    }
  });
});
