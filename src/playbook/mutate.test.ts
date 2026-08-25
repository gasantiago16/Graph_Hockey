import { describe, expect, it, vi } from "vitest";
import type { PlayMutation, PlaybookRevision } from "../types/play.ts";
import { loadPlaybook } from "./store.ts";
import {
  BOOST_XG,
  MAX_MUTATIONS_PER_AAR,
  applyPlaybookRevision,
  type MutateContext,
  type MutatePlayUsage,
} from "./mutate.ts";

const PLAY = "5v5-122-forecheck";
const IDS = ["m:0", "m:1", "m:2", "m:3"];

function usage(over: Partial<MutatePlayUsage> = {}): MutatePlayUsage {
  return {
    playId: over.playId ?? PLAY,
    xgFor: over.xgFor ?? 0.5,
    xgAgainst: over.xgAgainst ?? 0,
    seconds: over.seconds ?? 120,
    xgShare: over.xgShare ?? 0.8,
  };
}

function ctx(over: Partial<MutateContext> = {}): MutateContext {
  return {
    result: "win",
    knownEventIds: IDS,
    playUsage: [usage()],
    mintEligible: false,
    ...over,
  };
}

function boost(over: Partial<Extract<PlayMutation, { op: "boost" }>> = {}): PlayMutation {
  return {
    op: "boost",
    playId: over.playId ?? PLAY,
    reason: over.reason ?? "worked",
    eventIds: over.eventIds ?? ["m:0"],
  };
}

function rev(ops: PlayMutation[], summary = "rev"): PlaybookRevision {
  return { summary, ops };
}

describe("applyPlaybookRevision caps", () => {
  it("rejects uncited ops and does not bump version", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const book = loadPlaybook("original-six");
      const out = applyPlaybookRevision(book, rev([boost({ eventIds: ["ghost:1"] })]), ctx({ playUsage: [] }));
      expect(out.applied).toEqual([]);
      expect(out.bumped).toBe(false);
      expect(out.book.version).toBe(book.version);
      expect(out.rejected.some((r) => r.includes("unknown") || r.includes("ghost:1"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects the 4th mutation (max 3)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const book = loadPlaybook("original-six");
      const ops = [
        boost({ eventIds: ["m:0"] }),
        boost({ playId: "oz-cycle-low", eventIds: ["m:1"] }),
        boost({ playId: "nz-122-trap", eventIds: ["m:2"] }),
        boost({ playId: "dz-collapse", eventIds: ["m:3"] }),
      ];
      const out = applyPlaybookRevision(book, { summary: "too many", ops } as PlaybookRevision, ctx());
      expect(out.applied).toHaveLength(MAX_MUTATIONS_PER_AAR);
      expect(out.rejected.some((r) => r.includes("max-ops"))).toBe(true);
      expect(out.bumped).toBe(true);
      expect(out.book.version).toBe(book.version + 1);
    } finally {
      warn.mockRestore();
    }
  });

  it("retargets default-structure boosts onto the seed default play", () => {
    const book = loadPlaybook("original-six");
    const out = applyPlaybookRevision(
      book,
      rev([boost({ playId: "default-structure" })]),
      ctx({ playUsage: [usage({ playId: "default-structure" })] }),
    );
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]).toMatchObject({ op: "boost", playId: PLAY });
    expect(out.book.plays.find((p) => p.id === PLAY)!.stats.xgFor).toBeGreaterThan(0);
  });

  it("boosts lock in what worked and bump book version", () => {
    const book = loadPlaybook("original-six");
    const before = book.plays.find((p) => p.id === PLAY)!;
    const out = applyPlaybookRevision(book, rev([boost()]), ctx());
    const after = out.book.plays.find((p) => p.id === PLAY)!;
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]?.op).toBe("boost");
    expect(after.stats.xgFor).toBeCloseTo(before.stats.xgFor + BOOST_XG + 0.5);
    expect(after.stats.games).toBe(before.stats.games + 1);
    expect(out.book.version).toBe(book.version + 1);
    expect(book.plays.find((p) => p.id === PLAY)?.stats.xgFor).toBe(before.stats.xgFor);
  });

  it("rolls playUsage into stats and bumps with empty ops", () => {
    const book = loadPlaybook("original-six");
    const before = book.plays.find((p) => p.id === PLAY)!;
    const out = applyPlaybookRevision(book, rev([]), ctx({ result: "loss" }));
    const after = out.book.plays.find((p) => p.id === PLAY)!;
    expect(out.applied).toEqual([]);
    expect(out.bumped).toBe(true);
    expect(after.stats.games).toBe(before.stats.games + 1);
    expect(after.stats.xgFor).toBeCloseTo(before.stats.xgFor + 0.5);
    expect(out.book.version).toBe(book.version + 1);
  });

  it("winner cannot retire a used play", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const book = loadPlaybook("original-six");
      const out = applyPlaybookRevision(
        book,
        rev([
          boost(),
          { op: "retire", playId: PLAY, reason: "rewrite", eventIds: ["m:1"] },
        ]),
        ctx({ playUsage: [usage({ seconds: 200 })] }),
      );
      expect(out.applied.every((o) => o.op !== "retire")).toBe(true);
      expect(out.rejected.some((r) => r.includes("winner-retire-used"))).toBe(true);
      expect(out.book.plays.find((p) => p.id === PLAY)?.status).toBe("active");
    } finally {
      warn.mockRestore();
    }
  });

  it("winner mint without a signature cluster is rejected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const book = loadPlaybook("original-six");
      const out = applyPlaybookRevision(
        book,
        rev([
          boost(),
          {
            op: "mint",
            basedOn: PLAY,
            name: "OZ crash copy",
            patch: { family: "crash-net", assignments: { shotPolicy: "crash", forecheck: "2-1-2" } },
            eventIds: ["m:1"],
          },
        ]),
        ctx({ mintEligible: false, mintClusters: [] }),
      );
      expect(out.applied.every((o) => o.op !== "mint")).toBe(true);
      expect(out.rejected.some((r) => r.includes("mint-ineligible"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("winner mint is allowed when the basedOn play has a signature cluster", () => {
    const book = loadPlaybook("original-six");
    const out = applyPlaybookRevision(
      book,
      rev([
        boost(),
        {
          op: "mint",
          basedOn: PLAY,
          name: "OZ crash copy",
          patch: {
            family: "crash-net",
            assignments: { shotPolicy: "crash", forecheck: "2-1-2", nz: "2-3", dz: "over" },
          },
          eventIds: ["m:1"],
        },
      ]),
      ctx({
        mintEligible: true,
        mintClusters: [{ playId: PLAY }],
      }),
    );
    expect(out.applied.some((o) => o.op === "mint")).toBe(true);
    expect(out.book.plays.some((p) => p.origin === "minted" && p.parentId === PLAY)).toBe(true);
  });

  it("converts a near-duplicate mint into tweak_slot", () => {
    const book = loadPlaybook("original-six");
    const out = applyPlaybookRevision(
      book,
      rev([
        boost(),
        {
          op: "mint",
          basedOn: PLAY,
          name: "Almost the same",
          patch: { name: "Almost the same" },
          eventIds: ["m:1"],
        },
      ]),
      ctx({ mintEligible: true, mintClusters: [{ playId: PLAY }] }),
    );
    expect(out.applied.some((o) => o.op === "mint")).toBe(false);
    expect(out.applied.some((o) => o.op === "tweak_slot")).toBe(true);
    expect(out.book.plays.filter((p) => p.origin === "minted")).toHaveLength(0);
  });

  it("loser allows at most one tweak_assignment and prefers add_counter", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const book = loadPlaybook("original-six");
      const out = applyPlaybookRevision(
        book,
        rev([
          {
            op: "tweak_assignment",
            playId: PLAY,
            patch: { shotPolicy: "shoot" },
            eventIds: ["m:0"],
          },
          {
            op: "tweak_assignment",
            playId: "oz-cycle-low",
            patch: { shotPolicy: "hold" },
            eventIds: ["m:1"],
          },
          {
            op: "add_counter",
            playId: PLAY,
            family: "stretch-pass",
            eventIds: ["m:2"],
          },
        ]),
        ctx({ result: "loss", playUsage: [usage({ xgShare: 0.2 })] }),
      );
      expect(out.applied.filter((o) => o.op === "tweak_assignment")).toHaveLength(1);
      expect(out.applied.some((o) => o.op === "add_counter")).toBe(true);
      expect(out.rejected.some((r) => r.includes("loser-tweak-assignment-cap"))).toBe(true);
      expect(out.book.plays.find((p) => p.id === PLAY)?.counters).toContain("stretch-pass");
    } finally {
      warn.mockRestore();
    }
  });

  it("retire requires games >= 3 or a catastrophic used play", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const book = loadPlaybook("original-six");
      const young = applyPlaybookRevision(
        book,
        rev([{ op: "retire", playId: "nz-122-trap", reason: "bad", eventIds: ["m:0"] }]),
        ctx({ result: "loss", playUsage: [usage({ playId: "nz-122-trap", seconds: 10, xgAgainst: 0.2, xgFor: 0 })] }),
      );
      expect(young.rejected.some((r) => r.includes("retire-ineligible"))).toBe(true);

      const aged = structuredClone(book);
      const trap = aged.plays.find((p) => p.id === "nz-122-trap")!;
      trap.stats = { ...trap.stats, games: 3 };
      const ok = applyPlaybookRevision(
        aged,
        rev([{ op: "retire", playId: "nz-122-trap", reason: "enough tape", eventIds: ["m:0"] }]),
        ctx({ result: "loss", playUsage: [] }),
      );
      expect(ok.book.plays.find((p) => p.id === "nz-122-trap")?.status).toBe("retired");
    } finally {
      warn.mockRestore();
    }
  });

  it("loser may retire a catastrophic play used >= 90s", () => {
    const book = loadPlaybook("original-six");
    const out = applyPlaybookRevision(
      book,
      rev([{ op: "retire", playId: PLAY, reason: "hemorrhaging xG", eventIds: ["m:0"] }]),
      ctx({
        result: "loss",
        playUsage: [usage({ xgFor: 0.1, xgAgainst: 1.8, seconds: 95, xgShare: 0.1 })],
      }),
    );
    expect(out.book.plays.find((p) => p.id === PLAY)?.status).toBe("retired");
  });

  it("tweak_trigger adds a predicate", () => {
    const book = loadPlaybook("original-six");
    const out = applyPlaybookRevision(
      book,
      rev([
        {
          op: "tweak_trigger",
          playId: PLAY,
          add: [{ kind: "score", eq: "trailing" }],
          eventIds: ["m:0"],
        },
      ]),
      ctx({ result: "loss" }),
    );
    const play = out.book.plays.find((p) => p.id === PLAY)!;
    const preds = [...(play.triggers[0]?.all ?? []), ...(play.triggers[0]?.any ?? [])];
    expect(preds.some((p) => p.kind === "score" && p.eq === "trailing")).toBe(true);
  });
});
