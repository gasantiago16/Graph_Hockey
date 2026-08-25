import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CoachIntentSchema as TypeCoachIntent, TeamDirectiveSchema as TypeDirective } from "../types/directive.ts";
import { PlayDigestSchema as TypeDigest, PlayMutationSchema as TypeMutation } from "../types/play.ts";
import { TeamObservationSchema as TypeObs } from "../types/observation.ts";
import { EpochKindSchema as TypeEpoch } from "../types/hockey.ts";
import {
  CoachIntentSchema,
  EpochKindSchema,
  PlayDigestSchema,
  PlayMutationSchema,
  MatchAggregatesSchema,
  PlaybookRevisionSchema,
  TeamDirectiveSchema,
  TeamObservationSchema,
} from "./schemas.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("llm/schemas re-exports", () => {
  it("is the same Zod objects as src/types (no z.custom wrappers)", () => {
    expect(CoachIntentSchema).toBe(TypeCoachIntent);
    expect(TeamDirectiveSchema).toBe(TypeDirective);
    expect(PlayDigestSchema).toBe(TypeDigest);
    expect(PlayMutationSchema).toBe(TypeMutation);
    expect(MatchAggregatesSchema.parse({
      xgFor: 1,
      xgAgainst: 0,
      cfPct: 50,
      zoneTimeOZ: 0,
      zoneTimeDZ: 0,
      turnovers: 0,
      foPct: 50,
      ppPct: null,
      pkPct: null,
      goalsFor: 1,
      goalsAgainst: 0,
    }).goalsFor).toBe(1);
    expect(TeamObservationSchema).toBe(TypeObs);
    expect(EpochKindSchema).toBe(TypeEpoch);
    const src = readFileSync(join(here, "schemas.ts"), "utf8");
    expect(src).not.toMatch(/z\.custom\(/);
    expect(src).toMatch(/from "\.\.\/types\//);
  });

  it("parses coach intent, directive, and capped playbook revision", () => {
    expect(EpochKindSchema.parse("macro")).toBe("macro");
    expect(
      CoachIntentSchema.parse({
        supposedToHappen: "win the draw",
        playId: "5v5-122-forecheck",
        pressure: "neutral",
      }).playId,
    ).toBe("5v5-122-forecheck");
    expect(
      TeamDirectiveSchema.parse({
        playId: "5v5-122-forecheck",
        pressure: "aggressive",
      }).pressure,
    ).toBe("aggressive");
    expect(() =>
      PlayMutationSchema.parse({ op: "boost", playId: "x", reason: "no cites" }),
    ).toThrow();
    const rev = PlaybookRevisionSchema.parse({
      summary: "tighten the 1-2-2",
      ops: [
        { op: "boost", playId: "5v5-122-forecheck", reason: "entries", eventIds: ["m:1"] },
      ],
    });
    expect(rev.ops).toHaveLength(1);
    expect(() =>
      PlaybookRevisionSchema.parse({
        summary: "too many",
        ops: [
          { op: "boost", playId: "a", reason: "r", eventIds: ["m:1"] },
          { op: "boost", playId: "b", reason: "r", eventIds: ["m:2"] },
          { op: "boost", playId: "c", reason: "r", eventIds: ["m:3"] },
          { op: "boost", playId: "d", reason: "r", eventIds: ["m:4"] },
        ],
      }),
    ).toThrow();
  });
});
