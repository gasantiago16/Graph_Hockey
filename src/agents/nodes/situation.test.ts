import { describe, expect, it } from "vitest";
import { defaultDirective } from "../../engine/world.ts";
import type { TeamObservation } from "../../types/observation.ts";
import {
  classifySituation,
  specialistsForMacro,
  urgencyFromObservation,
} from "./situation.ts";

const last = defaultDirective();

function obs(over: Partial<TeamObservation> = {}): TeamObservation {
  return {
    matchId: "m",
    epochReason: "faceoff",
    epochKind: "macro",
    period: 1,
    clock: 600,
    score: { us: 0, them: 0 },
    strength: "5v5",
    zone: "NZ",
    phase: "live",
    whistle: null,
    puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
    players: [],
    lastEvents: [],
    zoneTime: { usOZ: 0, themOZ: 0, nz: 0 },
    onIce: { us: [], them: [] },
    penalties: { us: [], them: [] },
    timeoutLeft: { us: true, them: true },
    goalieInNet: { us: true, them: true },
    activePlay: { id: "default-structure", name: "Default structure", version: 1 },
    lastDirective: last,
    bench: { fatigue: {} },
    playbookDigest: [],
    scoutNotes: [],
    ourAssignments: [],
    ...over,
  };
}

describe("situation classifier", () => {
  it("labels period_start 5v5 as oc/dc/captain/scout", () => {
    expect(specialistsForMacro(obs({ epochReason: "period_start" }))).toEqual(["oc", "dc", "captain", "scout"]);
    expect(specialistsForMacro(obs({ epochReason: "after_goal" }))).toEqual(["oc", "dc", "captain", "scout"]);
  });

  it("adds goalie on last_two_minutes and ST on PP/PK", () => {
    expect(specialistsForMacro(obs({ epochReason: "last_two_minutes" }))).toEqual(["oc", "dc", "captain", "goalie"]);
    expect(specialistsForMacro(obs({ epochReason: "penalty_start", strength: "5v4" }))).toEqual([
      "st",
      "captain",
      "goalie",
    ]);
    expect(specialistsForMacro(obs({ epochReason: "faceoff", strength: "4v5" }))).toEqual(["st", "captain", "goalie"]);
  });

  it("routes other macro by zone; timeout is oc/dc/captain", () => {
    expect(specialistsForMacro(obs({ epochReason: "timeout" }))).toEqual(["oc", "dc", "captain"]);
    expect(specialistsForMacro(obs({ epochReason: "faceoff", zone: "OZ" }))).toEqual(["oc", "captain"]);
    expect(specialistsForMacro(obs({ epochReason: "icing", zone: "DZ", whistle: "icing" }))).toEqual([
      "dc",
      "captain",
      "goalie",
    ]);
    expect(specialistsForMacro(obs({ epochReason: "faceoff", zone: "NZ" }))).toEqual(["oc", "dc", "captain"]);
  });

  it("leaves specialists empty on micro and sets late-game urgency", () => {
    const micro = classifySituation(obs({ epochKind: "micro" }), "micro");
    expect(micro.specialists).toEqual([]);
    expect(micro.scoreState).toBe("tied");
    expect(urgencyFromObservation(obs({ period: 3, clock: 90, score: { us: 1, them: 2 } }), "trailing")).toBe(
      "desperation",
    );
    expect(urgencyFromObservation(obs({ period: 3, clock: 90, score: { us: 2, them: 1 } }), "leading")).toBe(
      "protect",
    );
    expect(urgencyFromObservation(obs({ score: { us: 1, them: 2 } }), "trailing")).toBe("push");
  });
});
