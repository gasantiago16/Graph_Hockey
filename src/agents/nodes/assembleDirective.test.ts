import { describe, expect, it } from "vitest";
import { defaultDirective } from "../../engine/world.ts";
import { loadPlaybook } from "../../playbook/store.ts";
import { retrievePlays } from "../../playbook/retrieve.ts";
import type { TeamObservation } from "../../types/observation.ts";
import type { TeamGraphStateType } from "../state.ts";
import { classifySituation } from "./situation.ts";
import { mergeAssembleDirective } from "./assembleDirective.ts";

const last = defaultDirective();
const book = loadPlaybook("original-six");

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

function st(over: Partial<TeamGraphStateType> & { observation?: TeamObservation }): TeamGraphStateType {
  const observation = over.observation ?? obs();
  return {
    observation,
    epochReason: observation.epochReason,
    epochKind: observation.epochKind,
    lastDirective: last,
    classifiedSituation: classifySituation(observation, observation.epochKind),
    retrievedPlays: retrievePlays(book, { strength: observation.strength, zone: observation.zone, limit: 6 }),
    specialistMemos: [],
    ...over,
  };
}

describe("assemble_directive merge table §10.4", () => {
  it("HC playId and pressure win on macro; OC params apply in NZ", () => {
    const directive = mergeAssembleDirective(
      st({
        coachIntent: { supposedToHappen: "forecheck", playId: "5v5-122-forecheck", pressure: "aggressive" },
        specialistMemos: [
          {
            specialist: "oc",
            memo: "1-2-2",
            playIdSuggestion: "oz-cycle-low",
            params: { forecheck: "1-2-2", shotPolicy: "dump" },
          },
          { specialist: "dc", memo: "trap", params: { nz: "1-2-2" } },
        ],
      }),
      book,
    );
    expect(directive.playId).toBe("5v5-122-forecheck");
    expect(directive.pressure).toBe("aggressive");
    expect(directive.playParams?.forecheck).toBe("1-2-2");
    expect(directive.playParams?.shotPolicy).toBe("dump");
    expect(directive.playParams?.nz).toBe("1-2-2");
  });

  it("macro HC shotPolicy wins over OC overlay", () => {
    const directive = mergeAssembleDirective(
      st({
        coachIntent: {
          supposedToHappen: "pass to the slot",
          playId: "5v5-122-forecheck",
          pressure: "aggressive",
          shotPolicy: "pass",
        },
        specialistMemos: [
          { specialist: "oc", memo: "dump", params: { shotPolicy: "dump" } },
        ],
      }),
      book,
    );
    expect(directive.playParams?.shotPolicy).toBe("pass");
  });

  it("ignores OC on PK and lets ST overwrite params", () => {
    const observation = obs({ strength: "4v5", zone: "DZ" });
    const directive = mergeAssembleDirective(
      st({
        observation,
        epochKind: "macro",
        coachIntent: { supposedToHappen: "kill", playId: "pk1-box", pressure: "passive" },
        specialistMemos: [
          { specialist: "oc", memo: "still attacking", params: { forecheck: "2-1-2", shotPolicy: "shoot" } },
          { specialist: "st", memo: "box", params: { dz: "zone-box", umbrella: false, shotPolicy: "dump" } },
          { specialist: "goalie", memo: "deep", params: { creaseDepth: "deep", playPuck: "stay" } },
        ],
      }),
      book,
    );
    expect(directive.playId).toBe("pk1-box");
    expect(directive.playParams?.forecheck).toBeUndefined();
    expect(directive.playParams?.dz).toBe("zone-box");
    expect(directive.specialTeams).toEqual({ unit: "PK1", umbrella: false });
    expect(directive.goalie).toEqual({ creaseDepth: "deep", playPuck: "stay" });
  });

  it("micro uses captain playIdSuggestion if retrieved, else lastDirective", () => {
    const observation = obs({ epochKind: "micro", epochReason: "faceoff" });
    const hit = mergeAssembleDirective(
      st({
        observation,
        epochKind: "micro",
        lastDirective: { playId: "nz-122-trap", pressure: "neutral" },
        specialistMemos: [{ specialist: "captain", memo: "keep F1", playIdSuggestion: "5v5-122-forecheck" }],
      }),
      book,
    );
    expect(hit.playId).toBe("5v5-122-forecheck");
    expect(hit.pressure).toBe("neutral");

    const miss = mergeAssembleDirective(
      st({
        observation,
        epochKind: "micro",
        lastDirective: { playId: "nz-122-trap", pressure: "passive" },
        specialistMemos: [{ specialist: "captain", memo: "ghost", playIdSuggestion: "not-a-play" }],
      }),
      book,
    );
    expect(miss.playId).toBe("nz-122-trap");
    expect(miss.pressure).toBe("passive");
  });

  it("micro assemble DZ trailing + last protect-lead uses retrieved breakout, not 122", () => {
    const observation = obs({
      epochKind: "micro",
      epochReason: "zone_entry",
      zone: "DZ",
      score: { us: 0, them: 1 },
    });
    const directive = mergeAssembleDirective(
      st({
        observation,
        epochKind: "micro",
        lastDirective: { playId: "protect-lead-1-1-3", pressure: "passive" },
      }),
      book,
    );
    expect(directive.playId).toBe("5v5-breakout-d-to-winger");
    expect(directive.playId).not.toBe("5v5-122-forecheck");
    expect(directive.playId).not.toBe("protect-lead-1-1-3");
  });

  it("micro assemble DZ + last 122 dump uses retrieved breakout", () => {
    const observation = obs({
      epochKind: "micro",
      epochReason: "possession_review",
      zone: "DZ",
      score: { us: 1, them: 1 },
    });
    const directive = mergeAssembleDirective(
      st({
        observation,
        epochKind: "micro",
        lastDirective: { playId: "5v5-122-forecheck", pressure: "aggressive" },
      }),
      book,
    );
    expect(directive.playId).toBe("5v5-breakout-d-to-winger");
    expect(directive.playId).not.toBe("5v5-122-forecheck");
  });

  it("goalie only from goalie memo; notesForCaptain from HC", () => {
    const directive = mergeAssembleDirective(
      st({
        coachIntent: {
          supposedToHappen: "protect",
          playId: "protect-lead-1-1-3",
          pressure: "passive",
          matchingNotes: "hold the blue line and collapse",
        },
        lastDirective: {
          playId: "5v5-122-forecheck",
          pressure: "neutral",
          goalie: { playPuck: "play", creaseDepth: "mid" },
        },
        specialistMemos: [{ specialist: "oc", memo: "n" }],
      }),
      book,
    );
    expect(directive.goalie).toEqual({ playPuck: "play", creaseDepth: "mid" });
    expect(directive.notesForCaptain).toBe("hold the blue line and collapse");
  });
});
