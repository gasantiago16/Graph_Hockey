import { describe, expect, it, vi } from "vitest";
import { openMemoryDb } from "../persist/db.ts";
import { insertEvents } from "../persist/events.ts";
import { getAarReport, insertMatch } from "../persist/matches.ts";
import { ensureSeedPlaybooks, latestPlaybook } from "../persist/playbooks.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { makeEventId } from "../types/ids.ts";
import type { AarReport } from "../types/aar.ts";
import type { PlayMutation } from "../types/play.ts";
import { applyAarRevision, parseAarMode, persistAarReport, shouldApplyRevision } from "./apply.ts";

const BOOST: PlayMutation = {
  op: "boost",
  playId: "5v5-122-forecheck",
  reason: "goal sequence",
  eventIds: ["m1:0"],
};

function report(over: Partial<AarReport> = {}): AarReport {
  return {
    matchId: "m1",
    side: "home",
    result: "win",
    actualSummary: "xG 1-0",
    revision: { summary: "lock the 1-2-2", ops: [BOOST] },
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
      liveTick: 10,
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

describe("aar-mode", () => {
  it("defaults to auto and skips apply for noLlm or propose", () => {
    expect(parseAarMode(undefined)).toBe("auto");
    expect(parseAarMode("propose")).toBe("propose");
    expect(parseAarMode("hitl")).toBe("hitl");
    expect(() => parseAarMode("nope")).toThrow(/aar-mode/);
    expect(shouldApplyRevision({})).toBe(true);
    expect(shouldApplyRevision({ aarMode: "auto" })).toBe(true);
    expect(shouldApplyRevision({ aarMode: "propose" })).toBe(false);
    expect(shouldApplyRevision({ aarMode: "hitl" })).toBe(false);
    expect(shouldApplyRevision({ noLlm: true, aarMode: "auto" })).toBe(false);
  });
});

describe("persistAarReport", () => {
  it("writes aar_reports without applying", async () => {
    const db = await openMemoryDb();
    try {
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      persistAarReport(
        db,
        {
          matchId: "m1",
          side: "home",
          result: "win",
          actualSummary: "xG 1-0",
          revision: { summary: "ok", ops: [] },
        },
        false,
      );
      const row = getAarReport(db, "m1", "home");
      expect(row?.applied).toBe(false);
      expect((row?.body as { actualSummary?: string }).actualSummary).toBe("xG 1-0");
    } finally {
      db.close();
    }
  });
});

describe("applyAarRevision", () => {
  it("auto bumps playbook version when a cited boost applies", async () => {
    const db = await primed();
    try {
      expect(latestPlaybook(db, "original-six")?.version).toBe(1);
      const out = applyAarRevision({
        db,
        teamId: "original-six",
        playbook: loadPlaybook("original-six"),
        report: report(),
        mode: "auto",
      });
      expect(out.applied).toBe(true);
      expect(out.toVersion).toBe(2);
      expect(latestPlaybook(db, "original-six")?.version).toBe(2);
      expect(getAarReport(db, "m1", "home")?.applied).toBe(true);
      expect(out.ops.some((o) => o.op === "boost")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("propose writes the report and does not bump version", async () => {
    const db = await primed();
    try {
      const out = applyAarRevision({
        db,
        teamId: "original-six",
        playbook: loadPlaybook("original-six"),
        report: report(),
        mode: "propose",
      });
      expect(out.applied).toBe(false);
      expect(out.toVersion).toBe(1);
      expect(latestPlaybook(db, "original-six")?.version).toBe(1);
      expect(getAarReport(db, "m1", "home")?.applied).toBe(false);
      const body = getAarReport(db, "m1", "home")?.body as { revision?: { ops: unknown[] } };
      expect(body.revision?.ops).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("rejects uncited ops and does not bump version", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = await primed();
    try {
      const out = applyAarRevision({
        db,
        teamId: "original-six",
        playbook: loadPlaybook("original-six"),
        report: report({
          revision: {
            summary: "hallucinated cite",
            ops: [{ op: "boost", playId: "5v5-122-forecheck", reason: "nope", eventIds: ["m1:99"] }],
          },
        }),
        mode: "auto",
      });
      expect(out.applied).toBe(false);
      expect(latestPlaybook(db, "original-six")?.version).toBe(1);
      expect(out.rejectedOps.some((r) => r.includes("unknown") || r.includes("m1:99"))).toBe(true);
    } finally {
      warn.mockRestore();
      db.close();
    }
  });

  it("rolls match xG into play stats when ops are empty", async () => {
    const db = await openMemoryDb();
    try {
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      insertEvents(db, "m1", [
        {
          id: makeEventId("m1", 0),
          seq: 0,
          liveTick: 5,
          stoppageSeq: 0,
          period: 1,
          type: "DirectiveApplied",
          payload: { side: "home", directive: { playId: "5v5-122-forecheck", pressure: "neutral" } },
        },
        {
          id: makeEventId("m1", 1),
          seq: 1,
          liveTick: 20,
          stoppageSeq: 0,
          period: 1,
          type: "Shot",
          zone: "OZ",
          xG: 0.4,
          actor: "h-C",
          payload: { side: "home" },
        },
      ]);
      ensureSeedPlaybooks(db);
      const out = applyAarRevision({
        db,
        teamId: "original-six",
        playbook: loadPlaybook("original-six"),
        report: {
          matchId: "m1",
          side: "home",
          result: "loss",
          revision: { summary: "no ops", ops: [] },
        },
        mode: "auto",
      });
      expect(out.applied).toBe(true);
      expect(out.toVersion).toBe(2);
      const play = latestPlaybook(db, "original-six")?.body.plays.find((p) => p.id === "5v5-122-forecheck");
      expect(play?.stats.games).toBe(1);
      expect(play?.stats.xgFor).toBeCloseTo(0.4);
    } finally {
      db.close();
    }
  });

  it("noLlm never applies even in auto mode", async () => {
    const db = await primed();
    try {
      const out = applyAarRevision({
        db,
        teamId: "original-six",
        playbook: loadPlaybook("original-six"),
        report: report({ noLlm: true }),
        mode: "auto",
        noLlm: true,
      });
      expect(out.applied).toBe(false);
      expect(latestPlaybook(db, "original-six")?.version).toBe(1);
    } finally {
      db.close();
    }
  });
});

