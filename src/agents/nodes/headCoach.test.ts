import { afterEach, describe, expect, it } from "vitest";
import { Command } from "@langchain/langgraph";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { defaultDirective } from "../../engine/world.ts";
import { resetLlmClientForTests, setCreateChatModel } from "../../llm/client.ts";
import { loadPlaybook } from "../../playbook/store.ts";
import { retrievePlays } from "../../playbook/retrieve.ts";
import type { TeamObservation } from "../../types/observation.ts";
import type { TeamGraphStateType } from "../state.ts";
import { classifySituation } from "./situation.ts";
import { clampCoachPlayId, makeHeadCoach } from "./headCoach.ts";

const last = defaultDirective();

function obs(over: Partial<TeamObservation> = {}): TeamObservation {
  return {
    matchId: "m",
    epochReason: "faceoff",
    epochKind: "macro",
    period: 1,
    clock: 5,
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

function state(): TeamGraphStateType {
  const observation = obs();
  const book = loadPlaybook("original-six");
  const retrievedPlays = retrievePlays(book, { strength: "5v5", zone: "NZ", limit: 6 });
  return {
    observation,
    epochReason: observation.epochReason,
    epochKind: "macro",
    lastDirective: last,
    classifiedSituation: classifySituation(observation, "macro"),
    retrievedPlays,
    specialistMemos: [],
  };
}

afterEach(() => {
  resetLlmClientForTests();
});

describe("head_coach Command", () => {
  it("clamps playId to retrievedPlays", () => {
    const plays = [{ id: "nz-122-trap" }, { id: "5v5-122-forecheck" }];
    expect(clampCoachPlayId("5v5-122-forecheck", plays)).toBe("5v5-122-forecheck");
    expect(clampCoachPlayId("ghost", plays)).toBe("nz-122-trap");
    expect(clampCoachPlayId("ghost", [])).toBe("ghost");
  });

  it("returns Command.goto assemble_directive without Send", async () => {
    const intent = {
      supposedToHappen: "win the draw",
      playId: "5v5-122-forecheck",
      pressure: "neutral",
    };
    setCreateChatModel(() => new FakeListChatModel({ responses: [JSON.stringify(intent)] }));
    const cmd = await makeHeadCoach()(state());
    expect(cmd).toBeInstanceOf(Command);
    const goto = Array.isArray(cmd.goto) ? cmd.goto : [cmd.goto];
    expect(goto).toEqual(["assemble_directive"]);
    const update = cmd.update as { coachIntent?: { playId: string } } | undefined;
    expect(update?.coachIntent?.playId).toBe("5v5-122-forecheck");
  });

  it("noLlm Command skips LLM and does not set coachIntent", async () => {
    setCreateChatModel(() => {
      throw new Error("LLM should not run");
    });
    const cmd = await makeHeadCoach({ noLlm: true })(state());
    const goto = Array.isArray(cmd.goto) ? cmd.goto : [cmd.goto];
    expect(goto).toEqual(["assemble_directive"]);
    expect(cmd.update).toBeUndefined();
  });
});
