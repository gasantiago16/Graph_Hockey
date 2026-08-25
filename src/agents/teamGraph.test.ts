import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { defaultDirective } from "../engine/world.ts";
import { resetLlmClientForTests, setCreateChatModel } from "../llm/client.ts";
import { loadPlaybook } from "../playbook/store.ts";
import type { TeamObservation } from "../types/observation.ts";
import { clampDirective } from "./nodes/validateDirective.ts";
import {
  compileTeamGraph,
  epochRouter,
  TEAM_GRAPH_NODES,
  type CompiledTeamGraph,
  type CompileTeamGraphOpts,
} from "./teamGraph.ts";

const last = defaultDirective();

function obs(over: Partial<TeamObservation> = {}): TeamObservation {
  return {
    matchId: "m",
    epochReason: "period_start",
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

function compile(over: Partial<CompileTeamGraphOpts> = {}): CompiledTeamGraph {
  return compileTeamGraph({
    side: "home",
    playbook: loadPlaybook("original-six"),
    checkpointer: new MemorySaver(),
    ...over,
  });
}

function input(over: Partial<TeamObservation> = {}, extra: { epochKind?: "macro" | "micro"; epochReason?: string } = {}) {
  const observation = obs(over);
  return {
    observation,
    epochReason: extra.epochReason ?? observation.epochReason,
    epochKind: extra.epochKind ?? observation.epochKind,
    lastDirective: last,
  };
}

async function visitedNodes(
  graph: CompiledTeamGraph,
  invokeInput: ReturnType<typeof input>,
  threadId: string,
): Promise<string[]> {
  const names: string[] = [];
  const stream = await graph.stream(invokeInput, {
    streamMode: "updates",
    configurable: { thread_id: threadId },
    recursionLimit: 12,
  });
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== "object") continue;
    names.push(...Object.keys(chunk));
  }
  return names;
}

afterEach(() => {
  resetLlmClientForTests();
});

describe("compileTeamGraph", () => {
  it("compiles ingest → situation → retrieve_plays → head_coach → assemble → validate, no specialists", () => {
    const home = compile({ noLlm: true });
    const names = Object.keys(home.nodes);
    for (const n of TEAM_GRAPH_NODES) {
      expect(names).toContain(n);
    }
    expect(names).not.toContain("oc");
    expect(names).not.toContain("dc");
    expect(names).not.toContain("captain");
    expect(names).not.toContain("route_specialists");
  });

  it("uses private seed defaults: original-six 1-2-2 vs expansion 2-1-2", async () => {
    const homeBook = loadPlaybook("original-six");
    const awayBook = loadPlaybook("expansion");
    const home = compile({ side: "home", playbook: homeBook, noLlm: true });
    const away = compile({ side: "away", playbook: awayBook, noLlm: true });
    const inv = input();
    const h = (await home.invoke(inv, { configurable: { thread_id: "match:m:team:home:epoch:0" } })) as {
      directive?: { playId: string };
    };
    const a = (await away.invoke(inv, { configurable: { thread_id: "match:m:team:away:epoch:0" } })) as {
      directive?: { playId: string };
    };
    expect(h.directive?.playId).toBe("5v5-122-forecheck");
    expect(a.directive?.playId).toBe("5v5-212-forecheck");
  });

  it("keeps last pressure and selects the seed default play when noLlm", async () => {
    const graph = compile({ noLlm: true });
    const out = (await graph.invoke(
      {
        observation: obs(),
        epochReason: "faceoff",
        epochKind: "macro",
        lastDirective: { playId: "not-a-real-play", pressure: "aggressive" },
      },
      { configurable: { thread_id: "match:m:team:home:epoch:1" } },
    )) as { directive?: { playId: string; pressure: string }; coachIntent?: unknown };
    expect(out.directive?.playId).toBe("5v5-122-forecheck");
    expect(out.directive?.pressure).toBe("aggressive");
    expect(out.coachIntent).toBeUndefined();
  });

  it("noLlm skips the grok-4.5 factory", async () => {
    const factory = vi.fn(() => {
      throw new Error("LLM should not run on --no-llm");
    });
    setCreateChatModel(factory);
    const graph = compile({ noLlm: true });
    const out = (await graph.invoke(input(), { configurable: { thread_id: "match:m:team:home:epoch:no-llm" } })) as {
      directive?: { playId: string };
    };
    expect(factory).not.toHaveBeenCalled();
    expect(out.directive?.playId).toBe("5v5-122-forecheck");
  });

  it("clamps unknown playId to default-structure", () => {
    const book = loadPlaybook("original-six");
    const { directive, errors } = clampDirective(
      { playId: "not-a-real-play", pressure: "neutral" },
      book,
      last,
    );
    expect(directive.playId).toBe("default-structure");
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("epochRouter", () => {
  it("routes macro to head_coach and micro to assemble_directive", () => {
    expect(epochRouter({ epochKind: "macro" })).toBe("head_coach");
    expect(epochRouter({ epochKind: "micro" })).toBe("assemble_directive");
  });

  it("epochKind macro visits head_coach; micro never does", async () => {
    const intent = {
      supposedToHappen: "win the draw",
      playId: "5v5-122-forecheck",
      pressure: "aggressive" as const,
    };
    setCreateChatModel((kind) => {
      expect(kind).toBe("coach");
      return new FakeListChatModel({ responses: [JSON.stringify(intent)] });
    });
    const graph = compile();
    const macro = await visitedNodes(graph, input({ epochKind: "macro" }, { epochKind: "macro" }), "match:m:team:home:epoch:macro");
    expect(macro).toContain("head_coach");
    expect(macro).toContain("retrieve_plays");
    expect(macro).toContain("situation");
    expect(macro).not.toContain("captain");

    const micro = await visitedNodes(
      graph,
      input({ epochKind: "micro", epochReason: "faceoff" }, { epochKind: "micro", epochReason: "faceoff" }),
      "match:m:team:home:epoch:micro",
    );
    expect(micro).not.toContain("head_coach");
    expect(micro).toContain("assemble_directive");
  });
});

describe("head_coach structured intent", () => {
  it("uses FakeListChatModel CoachIntent and playId from retrievedPlays", async () => {
    const intent = {
      supposedToHappen: "win the draw",
      playId: "5v5-122-forecheck",
      pressure: "aggressive" as const,
    };
    setCreateChatModel(() => new FakeListChatModel({ responses: [JSON.stringify(intent)] }));
    const graph = compile();
    const out = (await graph.invoke(input({ epochKind: "macro" }, { epochKind: "macro" }), {
      configurable: { thread_id: "match:m:team:home:epoch:llm" },
      recursionLimit: 12,
    })) as {
      directive?: { playId: string; pressure: string };
      coachIntent?: { playId: string; pressure: string };
    };
    expect(out.coachIntent?.playId).toBe("5v5-122-forecheck");
    expect(out.directive?.playId).toBe("5v5-122-forecheck");
    expect(out.directive?.pressure).toBe("aggressive");
  });

  it("clamps a playId that is not in retrievedPlays", async () => {
    const intent = {
      supposedToHappen: "invent a play",
      playId: "not-in-retrieved",
      pressure: "passive" as const,
    };
    setCreateChatModel(() => new FakeListChatModel({ responses: [JSON.stringify(intent)] }));
    const graph = compile();
    const out = (await graph.invoke(input({ zone: "NZ", epochKind: "macro" }, { epochKind: "macro" }), {
      configurable: { thread_id: "match:m:team:home:epoch:clamp" },
    })) as { directive?: { playId: string }; coachIntent?: { playId: string } };
    expect(out.coachIntent?.playId).not.toBe("not-in-retrieved");
    expect(out.directive?.playId).toBe(out.coachIntent?.playId);
    expect(["5v5-122-forecheck", "nz-122-trap", "protect-lead-1-1-3"]).toContain(out.directive?.playId);
  });
});
