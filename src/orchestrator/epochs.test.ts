import { describe, expect, it } from "vitest";
import { createWorld, defaultDirective } from "../engine/world.ts";
import { loadPlaybook } from "../playbook/store.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Play } from "../types/play.ts";
import {
  BENCH_REVIEW_TICKS,
  POSSESSION_REVIEW_TICKS,
  classifyReason,
  createEpochTracker,
  epochKindFor,
  shouldDecide,
} from "./epochs.ts";

const dirs = { home: defaultDirective(), away: defaultDirective() };
const six = loadPlaybook("original-six");

function ev(type: string, extra: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: "m:0",
    seq: 0,
    liveTick: 4,
    stoppageSeq: 1,
    period: 1,
    type,
    ...extra,
  };
}

function decide(
  world: ReturnType<typeof createWorld>,
  events: MatchEvent[],
  tracker = createEpochTracker(),
) {
  return shouldDecide(world, events, dirs.home, dirs.away, tracker);
}

describe("epochKindFor", () => {
  it("labels the 12-row table macro vs micro", () => {
    expect(epochKindFor("period_start")).toBe("macro");
    expect(epochKindFor("after_goal")).toBe("macro");
    expect(epochKindFor("penalty_start")).toBe("macro");
    expect(epochKindFor("special_teams_change")).toBe("macro");
    expect(epochKindFor("timeout")).toBe("macro");
    expect(epochKindFor("last_two_minutes")).toBe("macro");
    expect(epochKindFor("score_state_flip")).toBe("macro");
    expect(epochKindFor("bench_review")).toBe("macro");
    expect(epochKindFor("icing")).toBe("micro");
    expect(epochKindFor("offside")).toBe("micro");
    expect(epochKindFor("faceoff")).toBe("micro");
    expect(epochKindFor("zone_entry")).toBe("micro");
    expect(epochKindFor("possession_review")).toBe("micro");
  });
});

describe("shouldDecide stoppages", () => {
  it("skips live ticks with only contact/possession noise", () => {
    const world = createWorld({ phase: "live", liveTick: 10 });
    expect(classifyReason(world, [ev("Contact"), ev("PossessionChange")])).toBeNull();
    expect(decide(world, [ev("Contact")])).toEqual({});
  });

  it("period start / goal / penalty stay macro on both sides even when the play is valid", () => {
    const world = createWorld({
      phase: "live",
      liveTick: 0,
      faceoffSpot: { x: 0, y: 0 },
      playId: { home: "default-structure", away: "default-structure" },
    });
    const opening = decide(world, [ev("FaceoffWin")]);
    expect(opening.home).toEqual({ kind: "macro", reason: "period_start" });
    expect(opening.away).toEqual({ kind: "macro", reason: "period_start" });

    const goalWorld = createWorld({ phase: "whistle", whistle: "goal", liveTick: 20 });
    const goal = decide(goalWorld, [ev("Goal")]);
    expect(goal.home).toEqual({ kind: "macro", reason: "after_goal" });
    expect(goal.away).toEqual({ kind: "macro", reason: "after_goal" });

    expect(classifyReason(createWorld({ phase: "whistle", whistle: "penalty" }), [])).toBe("penalty_start");
    expect(classifyReason(createWorld({ phase: "whistle", whistle: "period_end" }), [ev("PeriodEnd")])).toBe(
      "period_start",
    );
  });

  it("maps icing / offside / other faceoffs as micro", () => {
    expect(classifyReason(createWorld({ phase: "whistle", whistle: "icing" }), [ev("Icing")])).toBe("icing");
    expect(classifyReason(createWorld({ phase: "whistle", whistle: "offside" }), [ev("Offside")])).toBe("offside");
    expect(
      classifyReason(createWorld({ phase: "live", liveTick: 40, faceoffSpot: { x: 69, y: 22 } }), [ev("FaceoffWin")]),
    ).toBe("faceoff");
  });

  it("classifies zone entry as micro", () => {
    const world = createWorld({ phase: "live", liveTick: 80 });
    expect(classifyReason(world, [ev("ZoneEntry")])).toBe("zone_entry");
  });

  it("does not re-fire after_goal on faceoff_drop while whistle is still goal", () => {
    const world = createWorld({
      phase: "faceoff_drop",
      whistle: "goal",
      liveTick: 37,
      faceoffSpot: { x: 0, y: 0 },
    });
    expect(classifyReason(world, [ev("Whistle")])).toBeNull();
  });
});

describe("playStillValid skip", () => {
  it("skips a micro side whose play is still valid and still invokes the other side", () => {
    const world = createWorld({
      phase: "live",
      liveTick: 40,
      playId: { home: "5v5-122-forecheck", away: "5v5-122-forecheck" },
      playbooks: { home: six, away: six },
      puck: { pos: { x: 50, y: 0 } },
    });
    const d = decide(world, [ev("ZoneEntry")]);
    expect(d.home).toBeUndefined();
    expect(d.away).toEqual({ kind: "micro", reason: "zone_entry" });
  });

  it("skips both sides on icing when default-structure remains valid", () => {
    const world = createWorld({ phase: "whistle", whistle: "icing", liveTick: 20 });
    expect(decide(world, [ev("Icing")])).toEqual({});
  });

  it("does not skip macro when the play is still valid", () => {
    const world = createWorld({
      phase: "whistle",
      whistle: "goal",
      liveTick: 20,
      playId: { home: "default-structure", away: "default-structure" },
    });
    const d = decide(world, [ev("Goal")]);
    expect(d.home?.kind).toBe("macro");
    expect(d.away?.kind).toBe("macro");
  });
});

describe("tracker-backed live epochs", () => {
  it("fires possession_review on the 80th consecutive live tick with the same possessor side", () => {
    const world = createWorld({
      phase: "live",
      liveTick: 1,
      puck: { possessor: "h-C" },
      playId: { home: "ot-3v3-2-1-spread", away: "default-structure" },
      playbooks: { home: six, away: six },
    });
    const tracker = createEpochTracker();
    for (let i = 1; i < POSSESSION_REVIEW_TICKS; i++) {
      world.liveTick = i;
      expect(decide(world, [], tracker)).toEqual({});
    }
    world.liveTick = POSSESSION_REVIEW_TICKS;
    expect(classifyReason(world, [], tracker)).toBeNull();
    const d = decide(world, [], tracker);
    expect(d.home).toEqual({ kind: "micro", reason: "possession_review" });
    expect(d.away).toBeUndefined();
  });

  it("resets the possession streak when the possessor side changes", () => {
    const world = createWorld({
      phase: "live",
      puck: { possessor: "h-C" },
      playId: { home: "ot-3v3-2-1-spread", away: "ot-3v3-2-1-spread" },
      playbooks: { home: six, away: six },
    });
    const tracker = createEpochTracker();
    for (let i = 0; i < 40; i++) decide(world, [], tracker);
    world.puck.possessor = "a-C";
    for (let i = 0; i < 40; i++) expect(decide(world, [], tracker)).toEqual({});
    expect(tracker.possessorStreak).toBe(40);
  });

  it("fires last_two_minutes once per 3rd period when the clock is inside two minutes", () => {
    const world = createWorld({
      phase: "live",
      period: 3,
      liveTick: 1,
      clockRemaining: 119,
      periodSeconds: 1200,
    });
    const tracker = createEpochTracker();
    const first = decide(world, [], tracker);
    expect(first.home).toEqual({ kind: "macro", reason: "last_two_minutes" });
    expect(first.away).toEqual({ kind: "macro", reason: "last_two_minutes" });
    world.clockRemaining = 60;
    world.liveTick = 2;
    expect(decide(world, [], tracker)).toEqual({});
  });

  it("fires bench_review every 900 live ticks of the period", () => {
    const world = createWorld({ phase: "live", liveTick: BENCH_REVIEW_TICKS, clockRemaining: 1110 });
    expect(classifyReason(world, [])).toBe("bench_review");
    expect(decide(world, []).home).toEqual({ kind: "macro", reason: "bench_review" });
  });

  it("fires special_teams_change when strength flips onto PP/PK without a Penalty event", () => {
    const world = createWorld({ phase: "live", liveTick: 30, strength: "5v5" });
    const tracker = createEpochTracker();
    decide(world, [], tracker);
    world.strength = "5v4";
    const d = decide(world, [], tracker);
    expect(d.home).toEqual({ kind: "macro", reason: "special_teams_change" });
  });

  it("lets after_goal preempt a lead-change on the same tick", () => {
    const world = createWorld({ phase: "whistle", whistle: "goal", liveTick: 20, score: { home: 0, away: 0 } });
    const tracker = createEpochTracker();
    decide(world, [], tracker);
    world.score = { home: 1, away: 0 };
    expect(classifyReason(world, [ev("Goal")], tracker)).toBe("after_goal");
  });

  it("macro rows preempt micro on the same tick", () => {
    const world = createWorld({
      phase: "whistle",
      whistle: "goal",
      liveTick: BENCH_REVIEW_TICKS,
    });
    expect(classifyReason(world, [ev("Goal"), ev("Icing")])).toBe("after_goal");
  });
});

describe("invalid 3v3 play at 5v5", () => {
  it("is not playStillValid so a micro epoch still invokes that side", () => {
    const play = six.plays.find((p: Play) => p.id === "ot-3v3-2-1-spread");
    expect(play).toBeTruthy();
    const world = createWorld({
      phase: "live",
      liveTick: 12,
      playId: { home: "ot-3v3-2-1-spread", away: "default-structure" },
      playbooks: { home: six, away: six },
      puck: { pos: { x: 50, y: 0 } },
    });
    const d = decide(world, [ev("ZoneEntry")]);
    expect(d.home).toEqual({ kind: "micro", reason: "zone_entry" });
    expect(d.away).toBeUndefined();
  });
});
