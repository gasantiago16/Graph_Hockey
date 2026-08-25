import { describe, expect, it } from "vitest";
import { createWorld, defaultDirective } from "../engine/world.ts";
import type { MatchEvent } from "../types/events.ts";
import { classifyReason, shouldDecide } from "./epochs.ts";

const dirs = { home: defaultDirective(), away: defaultDirective() };

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

describe("shouldDecide (stoppages only)", () => {
  it("skips live ticks with only contact/possession noise", () => {
    const world = createWorld({ phase: "live", liveTick: 10 });
    expect(classifyReason(world, [ev("Contact"), ev("PossessionChange")])).toBeNull();
    expect(shouldDecide(world, [ev("Contact")], dirs.home, dirs.away)).toEqual({});
  });

  it("labels every stoppage reason macro on both sides", () => {
    const world = createWorld({ phase: "whistle", whistle: "icing", liveTick: 20 });
    const d = shouldDecide(world, [ev("Icing")], dirs.home, dirs.away);
    expect(d.home).toEqual({ kind: "macro", reason: "icing" });
    expect(d.away).toEqual({ kind: "macro", reason: "icing" });
  });

  it("maps goal, period end, faceoff win, penalty whistle", () => {
    expect(classifyReason(createWorld({ phase: "whistle", whistle: "goal" }), [ev("Goal")])).toBe("after_goal");
    expect(classifyReason(createWorld({ phase: "whistle", whistle: "period_end" }), [ev("PeriodEnd")])).toBe(
      "period_start",
    );
    expect(
      classifyReason(createWorld({ phase: "live", liveTick: 0, faceoffSpot: { x: 0, y: 0 } }), [ev("FaceoffWin")]),
    ).toBe("period_start");
    expect(
      classifyReason(createWorld({ phase: "live", liveTick: 40, faceoffSpot: { x: 69, y: 22 } }), [ev("FaceoffWin")]),
    ).toBe("faceoff");
    expect(classifyReason(createWorld({ phase: "whistle", whistle: "penalty" }), [])).toBe("penalty_start");
    expect(classifyReason(createWorld({ phase: "whistle", whistle: "offside" }), [ev("Offside")])).toBe("offside");
  });

  it("does not invent micro reasons", () => {
    const world = createWorld({ phase: "live", liveTick: 80 });
    expect(classifyReason(world, [ev("ZoneEntry")])).toBeNull();
  });
});
