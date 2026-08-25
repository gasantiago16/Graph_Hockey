import { describe, expect, it } from "vitest";
import { makeEventId } from "../../types/ids.ts";
import type { MatchEvent } from "../../types/events.ts";
import {
  annotateEvents,
  bagJaccard,
  buildEventDigest,
  computeActual,
  extractSequences,
  findMintClusters,
  isHighValueEvent,
  themFamilyFromEvents,
} from "./actual.ts";
import { loadPlaybook } from "../../playbook/store.ts";

function ev(over: Partial<MatchEvent> & { seq: number; type: string }): MatchEvent {
  return {
    id: over.id ?? makeEventId("m", over.seq),
    seq: over.seq,
    liveTick: over.liveTick ?? over.seq * 10,
    stoppageSeq: over.stoppageSeq ?? 0,
    period: over.period ?? 1,
    type: over.type,
    zone: over.zone ?? "OZ",
    xG: over.xG,
    actor: over.actor,
    payload: over.payload,
    playId: over.playId,
  };
}

describe("actual.ts (code, not LLM)", () => {
  it("annotates playId from DirectiveApplied and flips zone for away", () => {
    const events: MatchEvent[] = [
      ev({ seq: 0, type: "Shot", zone: "OZ", payload: { side: "home" }, xG: 0.2, actor: "h-C" }),
      ev({
        seq: 1,
        type: "DirectiveApplied",
        payload: { side: "away", directive: { playId: "5v5-212-forecheck", pressure: "aggressive" } },
      }),
      ev({ seq: 2, type: "Shot", zone: "OZ", payload: { side: "away" }, xG: 0.15, actor: "a-C" }),
    ];
    const home = annotateEvents(events, "home");
    const away = annotateEvents(events, "away");
    expect(home[0]?.zone).toBe("OZ");
    expect(away[0]?.zone).toBe("DZ");
    expect(away[2]?.playId).toBe("5v5-212-forecheck");
    expect(home[2]?.playId).not.toBe("5v5-212-forecheck");
  });

  it("digest keeps last 80 high-value events (goals, xG>0.12 shots, OZ turnovers)", () => {
    const events: MatchEvent[] = [
      ev({ seq: 0, type: "Contact" }),
      ev({ seq: 1, type: "Shot", xG: 0.04, payload: { side: "home" } }),
      ev({ seq: 2, type: "Shot", xG: 0.2, payload: { side: "home" } }),
      ev({ seq: 3, type: "Goal", xG: 0.2, payload: { side: "home" }, actor: "h-C" }),
      ev({ seq: 4, type: "Turnover", zone: "OZ", payload: { side: "home" } }),
    ];
    const actual = computeActual("m", events, "home");
    expect(actual.digest.events.some((e) => e.type === "Contact")).toBe(false);
    expect(actual.digest.events.some((e) => e.type === "Shot" && (e.xG ?? 0) < 0.12)).toBe(false);
    expect(actual.digest.events.map((e) => e.type)).toEqual(["Shot", "Goal", "Turnover"]);
    expect(isHighValueEvent({ id: "m:1", type: "Shot", liveTick: 1, xG: 0.04 })).toBe(false);
    expect(buildEventDigest("m", annotateEvents(events, "home")).matchId).toBe("m");
  });

  it("aggregates xG, CF%, FO%, goals from the log", () => {
    const events: MatchEvent[] = [
      ev({ seq: 0, type: "FaceoffWin", payload: { side: "home" }, actor: "h-C", zone: "NZ" }),
      ev({ seq: 1, type: "Shot", xG: 0.3, payload: { side: "home" }, actor: "h-C" }),
      ev({ seq: 2, type: "Goal", xG: 0.3, payload: { side: "home" }, actor: "h-C" }),
      ev({ seq: 3, type: "Shot", xG: 0.1, payload: { side: "away" }, actor: "a-C", zone: "DZ" }),
    ];
    const agg = computeActual("m", events, "home").aggregates;
    expect(agg.goalsFor).toBe(1);
    expect(agg.goalsAgainst).toBe(0);
    expect(agg.xgFor).toBeCloseTo(0.3, 5);
    expect(agg.xgAgainst).toBeCloseTo(0.1, 5);
    expect(agg.foPct).toBe(100);
    expect(agg.cfPct).toBeGreaterThan(50);
  });

  it("finds winner mint clusters via signature Jaccard ≥ 0.7", () => {
    expect(bagJaccard(["Shot", "Goal"], ["Shot", "Goal"])).toBe(1);
    const events: MatchEvent[] = [];
    let seq = 0;
    for (let i = 0; i < 3; i++) {
      events.push(
        ev({
          seq: seq++,
          type: "DirectiveApplied",
          payload: { side: "home", directive: { playId: "oz-cycle-low", pressure: "neutral" } },
        }),
      );
      events.push(ev({ seq: seq++, type: "ZoneEntry", payload: { side: "home" }, actor: "h-C", zone: "OZ" }));
      events.push(ev({ seq: seq++, type: "Shot", xG: 0.2, payload: { side: "home" }, actor: "h-C", zone: "OZ" }));
      events.push(ev({ seq: seq++, type: "Goal", xG: 0.2, payload: { side: "home" }, actor: "h-C", zone: "OZ" }));
      events.push(ev({ seq: seq++, type: "Icing", payload: { sideDumping: "away" } }));
    }
    const actual = computeActual("m", events, "home");
    expect(extractSequences(actual.annotated).length).toBeGreaterThanOrEqual(3);
    expect(actual.mintEligible).toBe(true);
    expect(findMintClusters(actual.sequences).length).toBeGreaterThan(0);
  });

  it("themFamilyFromEvents maps opponent shots to their play family", () => {
    const events: MatchEvent[] = [
      ev({
        seq: 0,
        type: "DirectiveApplied",
        payload: { side: "away", directive: { playId: "oz-crash-net", pressure: "aggressive" } },
      }),
      ev({ seq: 1, type: "Shot", xG: 0.4, payload: { side: "away" }, actor: "a-C" }),
    ];
    expect(themFamilyFromEvents(events, "home", loadPlaybook("expansion"))).toBe("crash-net");
    expect(themFamilyFromEvents(events, "home", undefined)).toBeUndefined();
  });
});
