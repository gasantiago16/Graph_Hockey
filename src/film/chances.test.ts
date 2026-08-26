import { describe, expect, it } from "vitest";
import { loadPlaybook } from "../playbook/store.ts";
import { makeEventId } from "../types/ids.ts";
import type { MatchEvent } from "../types/events.ts";
import {
  chanceCounts,
  leadProtectWhileTrailing,
  openingPlayId,
  retrieveTopChanged,
  retrieveTopId,
  sideScorecard,
} from "./chances.ts";

function ev(seq: number, type: string, over: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: makeEventId("m", seq),
    seq,
    liveTick: over.liveTick ?? seq,
    stoppageSeq: 0,
    period: 1,
    type,
    payload: over.payload,
    actor: over.actor,
    possessor: over.possessor,
    xG: over.xG,
  };
}

describe("chanceCounts", () => {
  it("clusters Shots within 15 ticks as one chance", () => {
    const events = [
      ev(0, "Shot", { liveTick: 10, payload: { side: "home" }, actor: "h-C", xG: 0.1 }),
      ev(1, "Shot", { liveTick: 12, payload: { side: "home" }, actor: "h-C", xG: 0.1 }),
      ev(2, "Shot", { liveTick: 40, payload: { side: "home" }, actor: "h-C", xG: 0.1 }),
      ev(3, "Shot", { liveTick: 11, payload: { side: "away" }, actor: "a-C", xG: 0.2 }),
    ];
    expect(chanceCounts(events, "home")).toEqual({ shots: 3, distinctChances: 2, offsides: 0 });
    expect(chanceCounts(events, "away")).toEqual({ shots: 1, distinctChances: 1, offsides: 0 });
  });

  it("starts a new chance after a whistle or opponent possession", () => {
    const events = [
      ev(0, "Shot", { liveTick: 10, payload: { side: "home" }, actor: "h-C" }),
      ev(1, "Offside", { liveTick: 11, payload: { attacking: "home" } }),
      ev(2, "Shot", { liveTick: 12, payload: { side: "home" }, actor: "h-C" }),
      ev(3, "PossessionChange", { liveTick: 13, possessor: "a-C" }),
      ev(4, "Shot", { liveTick: 14, payload: { side: "home" }, actor: "h-C" }),
    ];
    expect(chanceCounts(events, "home")).toMatchObject({ shots: 3, distinctChances: 3, offsides: 1 });
  });
});

describe("opening + retrieve top", () => {
  it("reads the first DirectiveApplied for that side", () => {
    const events = [
      ev(0, "DirectiveApplied", {
        payload: { side: "away", directive: { playId: "stretch-pass-nz" } },
      }),
      ev(1, "DirectiveApplied", {
        payload: { side: "home", directive: { playId: "5v5-122-forecheck" } },
      }),
    ];
    expect(openingPlayId(events, "home")).toBe("5v5-122-forecheck");
    expect(openingPlayId(events, "away")).toBe("stretch-pass-nz");
  });

  it("retrieveTopId is 5v5 OZ first digest", () => {
    expect(retrieveTopId(loadPlaybook("original-six"))).toBe("5v5-122-forecheck");
    expect(retrieveTopChanged(["a", "a", "b", "b"])).toBe(1);
  });

  it("retrieveTopId stays 5v5-122-forecheck when ser-emp-7 after-g4 protect-lead has higher net xG", () => {
    const seed = loadPlaybook("original-six");
    const book = {
      ...seed,
      plays: seed.plays.map((p) => {
        if (p.id === "5v5-122-forecheck") {
          return { ...p, stats: { games: 5, xgFor: 1.1036971959752557, xgAgainst: 1.0855651089157887 } };
        }
        if (p.id === "protect-lead-1-1-3") {
          return { ...p, stats: { games: 3, xgFor: 0.24176167635919105, xgAgainst: 0.14546602452306692 } };
        }
        return p;
      }),
    };
    expect(retrieveTopId(book)).toBe("5v5-122-forecheck");
  });
});

describe("leadProtectWhileTrailing", () => {
  it("flags trailing home DirectiveApplied protect-lead-1-1-3", () => {
    const events = [
      ev(0, "Goal", { payload: { side: "away" } }),
      ev(1, "DirectiveApplied", {
        payload: { side: "home", directive: { playId: "protect-lead-1-1-3" } },
      }),
    ];
    expect(leadProtectWhileTrailing(events, "home")).toBe(true);
    expect(leadProtectWhileTrailing(events, "away")).toBe(false);
  });

  it("does not flag leading home Goal then protect-lead", () => {
    const events = [
      ev(0, "Goal", { payload: { side: "home" } }),
      ev(1, "DirectiveApplied", {
        payload: { side: "home", directive: { playId: "protect-lead-1-1-3" } },
      }),
    ];
    expect(leadProtectWhileTrailing(events, "home")).toBe(false);
  });

  it("flags tied 0-0 protect-lead and lands on the sideScorecard", () => {
    const events = [
      ev(0, "DirectiveApplied", {
        payload: { side: "home", directive: { playId: "protect-lead-1-1-3" } },
      }),
    ];
    expect(leadProtectWhileTrailing(events, "home")).toBe(true);
    const card = sideScorecard(events, "home", undefined, 1);
    expect(card.leadProtectWhileTrailing).toBe(true);
    expect(card.shots).toBe(0);
    expect(card.distinctChances).toBe(0);
  });

  it("resolves sit-on-a-lead via book family protect-113; trail-push stays false", () => {
    const seed = loadPlaybook("original-six");
    const base = seed.plays[0]!;
    const book = {
      ...seed,
      plays: [
        ...seed.plays,
        { ...base, id: "sit-on-a-lead", name: "sit-on-a-lead", family: "protect-113" },
        { ...base, id: "trail-push-1-1-3", name: "trail-push-1-1-3", family: "chase-113" },
      ],
    };
    const sit = [
      ev(0, "Goal", { payload: { side: "away" } }),
      ev(1, "DirectiveApplied", {
        payload: { side: "home", directive: { playId: "sit-on-a-lead" } },
      }),
    ];
    const push = [
      ev(0, "Goal", { payload: { side: "away" } }),
      ev(1, "DirectiveApplied", {
        payload: { side: "home", directive: { playId: "trail-push-1-1-3" } },
      }),
    ];
    expect(leadProtectWhileTrailing(sit, "home", book)).toBe(true);
    expect(sideScorecard(sit, "home", book, 1).leadProtectWhileTrailing).toBe(true);
    expect(leadProtectWhileTrailing(push, "home", book)).toBe(false);
  });
});
