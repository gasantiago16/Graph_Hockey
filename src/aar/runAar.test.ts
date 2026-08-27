import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../persist/db.ts";
import { insertEvents } from "../persist/events.ts";
import { insertMatch } from "../persist/matches.ts";
import { ensureSeedPlaybooks, latestPlaybook } from "../persist/playbooks.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { makeEventId } from "../types/ids.ts";
import type { MatchEvent } from "../types/events.ts";
import type { CompiledAarGraph } from "./aarGraph.ts";
import { codeOnlyAarReport, runPostMatchAar } from "./runAar.ts";
import { shouldApplyRevision } from "./apply.ts";

function ev(seq: number, type: string, over: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: makeEventId("m1", seq),
    seq,
    liveTick: seq * 8,
    stoppageSeq: 0,
    period: 1,
    type,
    zone: over.zone ?? "OZ",
    xG: over.xG,
    actor: over.actor ?? "h-C",
    payload: over.payload ?? { side: "home" },
    playId: over.playId ?? "5v5-122-forecheck",
  };
}

const EVENTS: MatchEvent[] = [
  ev(0, "DirectiveApplied", {
    zone: "NZ",
    payload: { side: "home", directive: { playId: "5v5-122-forecheck", pressure: "neutral" } },
  }),
  ev(1, "Shot", { xG: 0.22 }),
  ev(2, "Goal", { xG: 0.22 }),
];

const throwingGraph: CompiledAarGraph = {
  nodes: {},
  invoke: async () => {
    throw new Error("aar home timed out after 45000ms");
  },
  stream: async () => {
    throw new Error("unused");
  },
};

describe("codeOnlyAarReport", () => {
  it("drafts a cited boost for a win when the book is present", () => {
    const report = codeOnlyAarReport({
      matchId: "m1",
      side: "home",
      result: "win",
      events: EVENTS,
      playbook: loadPlaybook("original-six"),
    });
    expect(report.revision?.ops.some((o) => o.op === "boost")).toBe(true);
    expect(report.noLlm).toBe(true);
  });

  it("drafts a cited add_counter for a loss", () => {
    const report = codeOnlyAarReport({
      matchId: "m1",
      side: "home",
      result: "loss",
      events: EVENTS,
      playbook: loadPlaybook("original-six"),
    });
    expect(report.revision?.ops.some((o) => o.op === "add_counter")).toBe(true);
  });

  it("code apply does not write a pk1-box boost after a same-tick even-strength leftover", async () => {
    const events: MatchEvent[] = [
      ev(0, "DirectiveApplied", {
        liveTick: 0,
        zone: "NZ",
        payload: { side: "home", directive: { playId: "nz-122-trap", pressure: "neutral" } },
      }),
      ev(1, "DirectiveApplied", {
        liveTick: 0,
        zone: "DZ",
        payload: { side: "home", directive: { playId: "pk1-box", pressure: "passive" } },
      }),
      ev(2, "Shot", { liveTick: 20, xG: 0.32, payload: { side: "home" } }),
    ];
    const db = await openMemoryDb();
    try {
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      insertEvents(db, "m1", events);
      ensureSeedPlaybooks(db);
      const out = await runPostMatchAar({
        db,
        matchId: "m1",
        matchResult: "tie",
        homePlaybook: loadPlaybook("original-six"),
        awayPlaybook: loadPlaybook("expansion"),
        events,
        noLlm: false,
        aarMode: "code",
      });
      expect(out.home.revision?.ops.some((o) => o.op === "boost" && o.playId === "pk1-box")).toBe(false);
      expect(out.home.revision?.ops.some((o) => o.op === "boost")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("tie does not boost pk1-box after a same-tick even-strength leftover", () => {
    const events: MatchEvent[] = [
      ev(0, "DirectiveApplied", {
        liveTick: 0,
        zone: "NZ",
        payload: { side: "home", directive: { playId: "nz-122-trap", pressure: "neutral" } },
      }),
      ev(1, "DirectiveApplied", {
        liveTick: 0,
        zone: "DZ",
        payload: { side: "home", directive: { playId: "pk1-box", pressure: "passive" } },
      }),
      ev(2, "Shot", { liveTick: 20, xG: 0.32, payload: { side: "home" } }),
    ];
    const report = codeOnlyAarReport({
      matchId: "m1",
      side: "home",
      result: "tie",
      events,
      playbook: loadPlaybook("original-six"),
      noLlm: false,
    });
    expect(report.revision?.ops.some((o) => o.op === "boost" && o.playId === "pk1-box")).toBe(false);
    expect(report.revision?.ops.some((o) => o.op === "boost")).toBe(false);
  });
});

describe("runPostMatchAar", () => {
  it("live timeout still applies cited codeDraft ops", async () => {
    const db = await openMemoryDb();
    try {
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      insertEvents(db, "m1", EVENTS);
      ensureSeedPlaybooks(db);
      expect(shouldApplyRevision({ noLlm: false, aarMode: "auto" })).toBe(true);
      const book = loadPlaybook("original-six");
      const out = await runPostMatchAar({
        db,
        matchId: "m1",
        matchResult: "home",
        homePlaybook: book,
        awayPlaybook: loadPlaybook("expansion"),
        events: EVENTS,
        noLlm: false,
        homeGraph: throwingGraph,
        awayGraph: throwingGraph,
      });
      expect(out.home.revision?.ops.some((o) => o.op === "boost")).toBe(true);
      expect(latestPlaybook(db, "original-six")?.version).toBeGreaterThan(1);
    } finally {
      db.close();
    }
  });

  it("--aar-mode code applies without invoking the AAR graph", async () => {
    const db = await openMemoryDb();
    let invoked = 0;
    const graph: CompiledAarGraph = {
      nodes: {},
      invoke: async () => {
        invoked += 1;
        throw new Error("aar graph must not run in code mode");
      },
      stream: async () => {
        throw new Error("unused");
      },
    };
    try {
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      insertEvents(db, "m1", EVENTS);
      ensureSeedPlaybooks(db);
      expect(shouldApplyRevision({ noLlm: false, aarMode: "code" })).toBe(true);
      const book = loadPlaybook("original-six");
      const out = await runPostMatchAar({
        db,
        matchId: "m1",
        matchResult: "home",
        homePlaybook: book,
        awayPlaybook: loadPlaybook("expansion"),
        events: EVENTS,
        noLlm: false,
        aarMode: "code",
        homeGraph: graph,
        awayGraph: graph,
      });
      expect(invoked).toBe(0);
      expect(out.home.noLlm).not.toBe(true);
      expect(out.home.revision?.ops.some((o) => o.op === "boost")).toBe(true);
      expect(latestPlaybook(db, "original-six")?.version).toBeGreaterThan(1);
    } finally {
      db.close();
    }
  });

  it("--no-llm still never mutates the playbook", async () => {
    const db = await openMemoryDb();
    try {
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      insertEvents(db, "m1", EVENTS);
      ensureSeedPlaybooks(db);
      const book = loadPlaybook("original-six");
      const out = await runPostMatchAar({
        db,
        matchId: "m1",
        matchResult: "home",
        homePlaybook: book,
        awayPlaybook: loadPlaybook("expansion"),
        events: EVENTS,
        noLlm: true,
      });
      expect(out.home.revision?.ops.length).toBeGreaterThan(0);
      expect(out.home.noLlm).toBe(true);
      expect(latestPlaybook(db, "original-six")?.version).toBe(1);
    } finally {
      db.close();
    }
  });
});
