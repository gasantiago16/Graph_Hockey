import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { defaultDirective } from "../engine/world.ts";
import { resetLlmClientForTests, setCreateChatModel } from "../llm/client.ts";
import type { TeamObservation } from "../types/observation.ts";
import { asSpecialistAdvice, wrapSpecialist } from "./wrapSpecialist.ts";
import { clampPlayIdSuggestion, fallbackAdvice } from "./specialists/compile.ts";
import { compileOcSubgraph } from "./specialists/ocSubgraph.ts";
import { compileCaptainSubgraph } from "./specialists/captainSubgraph.ts";

const last = defaultDirective();

function obs(over: Partial<TeamObservation> = {}): TeamObservation {
  return {
    matchId: "m",
    epochReason: "period_start",
    epochKind: "macro",
    period: 1,
    clock: 600,
    score: { us: 0, them: 0 },
    strength: "5v5",
    zone: "OZ",
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

const payload = {
  observation: obs(),
  lastDirective: last,
  retrievedPlays: [{ id: "oz-cycle-low", name: "OZ low cycle", family: "cycle-low", strength: ["5v5" as const], zoneBias: ["OZ" as const], stats: { games: 0, xgFor: 0, xgAgainst: 0 } }],
  coachIntent: { supposedToHappen: "cycle", playId: "oz-cycle-low", pressure: "neutral" as const },
};

afterEach(() => {
  resetLlmClientForTests();
});

describe("wrapSpecialist", () => {
  it("maps subgraph output onto specialistMemos and drops private keys", async () => {
    setCreateChatModel((kind) => {
      expect(kind).toBe("fast");
      return new FakeListChatModel({
        responses: [JSON.stringify({ memo: "cycle the strong side", playIdSuggestion: "oz-cycle-low", params: { shotPolicy: "cycle" } })],
      });
    });
    const node = wrapSpecialist("oc", compileOcSubgraph());
    const out = await node(payload);
    expect(out.specialistMemos).toEqual([
      {
        specialist: "oc",
        memo: "cycle the strong side",
        playIdSuggestion: "oz-cycle-low",
        params: { shotPolicy: "cycle" },
      },
    ]);
    expect(out).not.toHaveProperty("ozPlan");
  });

  it("noLlm subgraph skips grok-4.3", async () => {
    const factory = vi.fn(() => {
      throw new Error("LLM should not run");
    });
    setCreateChatModel(factory);
    const node = wrapSpecialist("captain", compileCaptainSubgraph({ noLlm: true }));
    const out = await node({ ...payload, coachIntent: undefined });
    expect(factory).not.toHaveBeenCalled();
    expect(out.specialistMemos?.[0]?.specialist).toBe("captain");
    expect(out.specialistMemos?.[0]?.memo).toContain("captain");
  });

  it("asSpecialistAdvice and clampPlayIdSuggestion", () => {
    expect(asSpecialistAdvice({ memo: "x", params: { shotPolicy: "hold" } }).params?.shotPolicy).toBe("hold");
    expect(asSpecialistAdvice(null).memo).toBe("");
    expect(clampPlayIdSuggestion({ memo: "m", playIdSuggestion: "ghost" }, [{ id: "oz-cycle-low" }]).playIdSuggestion).toBeUndefined();
    expect(clampPlayIdSuggestion({ memo: "m", playIdSuggestion: "oz-cycle-low" }, [{ id: "oz-cycle-low" }]).playIdSuggestion).toBe(
      "oz-cycle-low",
    );
    expect(fallbackAdvice("st").memo).toContain("st");
    expect(fallbackAdvice("oc").params?.shotPolicy).toBe("pass");
  });
});
