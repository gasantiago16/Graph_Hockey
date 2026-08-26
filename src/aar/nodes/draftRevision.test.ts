import { describe, expect, it } from "vitest";
import { loadPlaybook } from "../../playbook/store.ts";
import type { MatchEvent } from "../../types/events.ts";
import { makeEventId } from "../../types/ids.ts";
import type { PlaybookRevision } from "../../types/play.ts";
import type { AarGraphStateType } from "../state.ts";
import { codeDraft, ensureLoserCounter, ensureMandatoryBoost } from "./draftRevision.ts";

const book = loadPlaybook("original-six");

function state(over: Partial<AarGraphStateType> = {}): AarGraphStateType {
  return {
    matchId: "m",
    side: "home",
    result: "win",
    playbook: book,
    knownEventIds: [makeEventId("m", 0), makeEventId("m", 1)],
    eventLogDigest: {
      matchId: "m",
      events: [
        { id: makeEventId("m", 0), type: "Shot", liveTick: 10, playId: "5v5-122-forecheck", xG: 0.2 },
        { id: makeEventId("m", 1), type: "Goal", liveTick: 12, playId: "5v5-122-forecheck", xG: 0.2 },
      ],
    },
    playUsage: [{ playId: "5v5-122-forecheck", xgFor: 0.2, xgAgainst: 0, seconds: 30, xgShare: 1 }],
    actualSummary: "xG 0.20-0.00",
    ...over,
  };
}

const empty: PlaybookRevision = { summary: "empty", ops: [] };

describe("codeDraft", () => {
  it("replaces a 0-xG winner boost with a play that had xG", () => {
    const rev = ensureMandatoryBoost(
      state({
        result: "win",
        playUsage: [
          { playId: "5v5-122-forecheck", xgFor: 0, xgAgainst: 0, seconds: 80, xgShare: 0 },
          { playId: "oz-cycle-low", xgFor: 0.4, xgAgainst: 0, seconds: 40, xgShare: 1 },
        ],
      }),
      {
        summary: "llm",
        ops: [
          {
            op: "boost",
            playId: "5v5-122-forecheck",
            reason: "guess",
            eventIds: [makeEventId("m", 0)],
          },
        ],
      },
    );
    expect(rev.ops[0]).toMatchObject({ op: "boost", playId: "oz-cycle-low" });
    expect(rev.ops.filter((o) => o.op === "boost")).toHaveLength(1);
  });

  it("skips winner boost when playUsage.xgFor is 0", () => {
    const rev = ensureMandatoryBoost(
      state({
        result: "win",
        playUsage: [{ playId: "5v5-122-forecheck", xgFor: 0, xgAgainst: 0, seconds: 200, xgShare: 0 }],
      }),
      empty,
    );
    expect(rev.ops.some((o) => o.op === "boost")).toBe(false);
  });

  it("winner boosts 5v5 xG over a higher-xG PP play", () => {
    const rev = codeDraft(
      state({
        result: "win",
        playUsage: [
          { playId: "pp1-umbrella", xgFor: 0.74, xgAgainst: 0, seconds: 12, xgShare: 0.63 },
          { playId: "5v5-122-forecheck", xgFor: 0.43, xgAgainst: 0.1, seconds: 40, xgShare: 0.37 },
        ],
        eventLogDigest: {
          matchId: "m",
          events: [
            { id: makeEventId("m", 0), type: "Shot", liveTick: 10, playId: "5v5-122-forecheck", xG: 0.2 },
            { id: makeEventId("m", 1), type: "Shot", liveTick: 40, playId: "pp1-umbrella", xG: 0.5 },
          ],
        },
      }),
    );
    expect(rev.ops[0]).toMatchObject({ op: "boost", playId: "5v5-122-forecheck" });
  });

  it("winner still boosts PP when no even-strength play had xG", () => {
    const rev = codeDraft(
      state({
        result: "win",
        playUsage: [{ playId: "pp1-umbrella", xgFor: 0.74, xgAgainst: 0, seconds: 12, xgShare: 1 }],
        eventLogDigest: {
          matchId: "m",
          events: [{ id: makeEventId("m", 1), type: "Shot", liveTick: 40, playId: "pp1-umbrella", xG: 0.74 }],
        },
        knownEventIds: [makeEventId("m", 1)],
      }),
    );
    expect(rev.ops[0]).toMatchObject({ op: "boost", playId: "pp1-umbrella" });
  });

  it("loser add_counter targets 5v5 instead of PP umbrella", () => {
    const rev = codeDraft(
      state({
        result: "loss",
        playUsage: [
          { playId: "pp1-umbrella", xgFor: 1.3, xgAgainst: 0, seconds: 12, xgShare: 0.98 },
          { playId: "5v5-122-forecheck", xgFor: 0.03, xgAgainst: 0.1, seconds: 40, xgShare: 0.02 },
        ],
      }),
    );
    const op = rev.ops.find((o) => o.op === "add_counter");
    expect(op).toMatchObject({ playId: "oz-cycle-low" });
    expect(op && "playId" in op ? op.playId : undefined).not.toBe("5v5-122-forecheck");
    expect(op && "playId" in op ? op.playId : undefined).not.toBe("pp1-umbrella");
  });

  it("winner always gets a cited boost", () => {
    const rev = codeDraft(state({ result: "win" }));
    expect(rev.ops[0]).toMatchObject({
      op: "boost",
      playId: "5v5-122-forecheck",
      eventIds: [makeEventId("m", 0)],
    });
  });

  it("loser gets a cited add_counter on a vulnerable family", () => {
    const rev = codeDraft(state({ result: "loss" }));
    expect(rev.ops.some((o) => o.op === "add_counter")).toBe(true);
    const op = rev.ops.find((o) => o.op === "add_counter");
    expect(op).toMatchObject({ playId: "oz-cycle-low", eventIds: [makeEventId("m", 0)] });
    if (op && op.op === "add_counter") {
      expect(book.plays[0]?.vulnerableTo).toContain(op.family);
    }
  });

  it("tie boosts a play with xG share > 0.4", () => {
    const rev = ensureMandatoryBoost(
      state({
        result: "tie",
        playUsage: [{ playId: "5v5-122-forecheck", xgFor: 0.5, xgAgainst: 0.4, seconds: 40, xgShare: 0.55 }],
      }),
      empty,
    );
    expect(rev.ops[0]?.op).toBe("boost");
  });

  it("still adds add_counter when the LLM nerf is uncited", () => {
    const existing: PlaybookRevision = {
      summary: "hallucinated",
      ops: [
        {
          op: "nerf",
          playId: "5v5-122-forecheck",
          reason: "invented",
          eventIds: ["m:999"],
        },
      ],
    };
    const rev = ensureLoserCounter(state({ result: "loss" }), existing);
    expect(rev.ops.some((o) => o.op === "add_counter")).toBe(true);
  });

  it("loser add_counter uses the opponent family that generated xG", () => {
    const them = loadPlaybook("expansion");
    const events: MatchEvent[] = [
      {
        id: makeEventId("m", 0),
        seq: 0,
        liveTick: 10,
        stoppageSeq: 0,
        period: 1,
        type: "DirectiveApplied",
        payload: { side: "away", directive: { playId: "oz-crash-net", pressure: "aggressive" } },
      },
      {
        id: makeEventId("m", 1),
        seq: 1,
        liveTick: 20,
        stoppageSeq: 0,
        period: 1,
        type: "Shot",
        actor: "a-C",
        xG: 0.3,
        payload: { side: "away" },
      },
    ];
    const rev = codeDraft(
      state({
        result: "loss",
        themPlaybook: them,
        events,
        knownEventIds: [makeEventId("m", 0), makeEventId("m", 1)],
        eventLogDigest: {
          matchId: "m",
          events: [{ id: makeEventId("m", 1), type: "Shot", liveTick: 20, xG: 0.3 }],
        },
      }),
    );
    const op = rev.ops.find((o) => o.op === "add_counter");
    expect(op).toMatchObject({ op: "add_counter", playId: "oz-cycle-low", family: "crash-net" });
  });

  it("skips loser counter when the revision already counters on a different play", () => {
    const existing: PlaybookRevision = {
      summary: "has",
      ops: [
        {
          op: "add_counter",
          playId: "oz-cycle-low",
          family: "forecheck-212",
          eventIds: [makeEventId("m", 1)],
        },
      ],
    };
    const rev = ensureLoserCounter(state({ result: "loss" }), existing);
    expect(rev.ops).toHaveLength(1);
    expect(rev.ops[0]).toMatchObject({ playId: "oz-cycle-low", family: "forecheck-212" });
  });

  it("retargets add_counter off the lost-with play", () => {
    const existing: PlaybookRevision = {
      summary: "sticky",
      ops: [
        {
          op: "add_counter",
          playId: "5v5-122-forecheck",
          family: "forecheck-212",
          eventIds: [makeEventId("m", 1)],
        },
      ],
    };
    const rev = ensureLoserCounter(state({ result: "loss" }), existing);
    const op = rev.ops.find((o) => o.op === "add_counter");
    expect(op).toMatchObject({ playId: "oz-cycle-low", family: "forecheck-212" });
    expect(rev.ops.some((o) => o.op === "add_counter" && o.playId === "5v5-122-forecheck")).toBe(false);
  });
});
