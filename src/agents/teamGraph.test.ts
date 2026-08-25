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
  SPECIALIST_NODES,
  TEAM_GRAPH_NODES,
  type CompiledTeamGraph,
  type CompileTeamGraphOpts,
} from "./teamGraph.ts";

const last = defaultDirective();

const COACH_INTENT = {
  supposedToHappen: "win the draw",
  playId: "5v5-122-forecheck",
  pressure: "aggressive" as const,
};

const FAST_ADVICE = {
  memo: "keep the structure",
  playIdSuggestion: "5v5-122-forecheck",
  params: { forecheck: "1-2-2" as const, shotPolicy: "dump" as const },
};

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

function installFakes(intent: object = COACH_INTENT, advice: object = FAST_ADVICE): string[] {
  const kinds: string[] = [];
  setCreateChatModel((kind) => {
    kinds.push(kind);
    const payload = kind === "coach" ? intent : advice;
    return new FakeListChatModel({ responses: [JSON.stringify(payload)] });
  });
  return kinds;
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
  it("compiles specialists + validate_directive, no HITL / route_specialists", () => {
    const home = compile({ noLlm: true });
    const names = Object.keys(home.nodes);
    for (const n of TEAM_GRAPH_NODES) {
      expect(names).toContain(n);
    }
    for (const n of SPECIALIST_NODES) {
      expect(names).toContain(n);
    }
    expect(names).not.toContain("route_specialists");
    expect(names).not.toContain("hitl_override");
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

  it("noLlm skips grok-4.5 and grok-4.3 factories", async () => {
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

  it("strips illegal pullGoalie and timeout", () => {
    const book = loadPlaybook("original-six");
    const { directive, errors } = clampDirective(
      { playId: "5v5-122-forecheck", pressure: "neutral", pullGoalie: true, timeout: true },
      book,
      last,
      obs({ period: 1, clock: 600, score: { us: 0, them: 0 }, timeoutLeft: { us: false, them: true } }),
    );
    expect(directive.pullGoalie).toBe(false);
    expect(directive.timeout).toBe(false);
    expect(errors).toContain("illegal pullGoalie");
    expect(errors).toContain("illegal timeout");
  });
});

describe("epochRouter", () => {
  it("routes macro to head_coach and micro to captain", () => {
    expect(epochRouter({ epochKind: "macro" })).toBe("head_coach");
    expect(epochRouter({ epochKind: "micro" })).toBe("captain");
  });

  it("epochKind macro visits head_coach; micro never does (captain only)", async () => {
    const kinds = installFakes();
    const graph = compile();
    const macro = await visitedNodes(graph, input({ epochKind: "macro" }, { epochKind: "macro" }), "match:m:team:home:epoch:macro");
    expect(macro).toContain("head_coach");
    expect(macro).toContain("retrieve_plays");
    expect(macro).toContain("situation");
    expect(macro).toContain("oc");
    expect(macro).toContain("dc");
    expect(macro).toContain("captain");
    expect(macro).toContain("scout");
    expect(macro).not.toContain("st");
    expect(kinds).toContain("coach");
    expect(kinds).toContain("fast");

    kinds.length = 0;
    const micro = await visitedNodes(
      graph,
      input({ epochKind: "micro", epochReason: "faceoff" }, { epochKind: "micro", epochReason: "faceoff" }),
      "match:m:team:home:epoch:micro",
    );
    expect(micro).not.toContain("head_coach");
    expect(micro).toContain("captain");
    expect(micro).toContain("assemble_directive");
    expect(micro).not.toContain("oc");
    expect(micro).not.toContain("dc");
    expect(kinds).not.toContain("coach");
    expect(kinds).toContain("fast");
  });

  it("ST is idle at 5v5 and runs on PP", async () => {
    installFakes();
    const graph = compile();
    const even = await visitedNodes(graph, input({ strength: "5v5" }), "match:m:team:home:epoch:5v5");
    expect(even).not.toContain("st");
    expect(even).toContain("oc");

    const pp = await visitedNodes(
      graph,
      input({ strength: "5v4", epochReason: "penalty_start" }, { epochKind: "macro", epochReason: "penalty_start" }),
      "match:m:team:home:epoch:pp",
    );
    expect(pp).toContain("st");
    expect(pp).toContain("captain");
    expect(pp).toContain("goalie");
    expect(pp).not.toContain("oc");
  });
});

describe("head_coach structured intent", () => {
  it("uses FakeListChatModel CoachIntent and playId from retrievedPlays", async () => {
    installFakes();
    const graph = compile();
    const out = (await graph.invoke(input({ epochKind: "macro" }, { epochKind: "macro" }), {
      configurable: { thread_id: "match:m:team:home:epoch:llm" },
      recursionLimit: 12,
    })) as {
      directive?: { playId: string; pressure: string; playParams?: { forecheck?: string } };
      coachIntent?: { playId: string; pressure: string };
      specialistMemos?: { specialist: string }[];
    };
    expect(out.coachIntent?.playId).toBe("5v5-122-forecheck");
    expect(out.directive?.playId).toBe("5v5-122-forecheck");
    expect(out.directive?.pressure).toBe("aggressive");
    expect(out.directive?.playParams?.forecheck).toBe("1-2-2");
    const specs = (out.specialistMemos ?? []).map((m) => m.specialist).sort();
    expect(specs).toEqual(["captain", "dc", "oc", "scout"]);
  });

  it("clamps a playId that is not in retrievedPlays", async () => {
    installFakes({
      supposedToHappen: "invent a play",
      playId: "not-in-retrieved",
      pressure: "passive" as const,
    });
    const graph = compile();
    const out = (await graph.invoke(input({ zone: "NZ", epochKind: "macro" }, { epochKind: "macro" }), {
      configurable: { thread_id: "match:m:team:home:epoch:clamp" },
    })) as { directive?: { playId: string }; coachIntent?: { playId: string } };
    expect(out.coachIntent?.playId).not.toBe("not-in-retrieved");
    expect(out.directive?.playId).toBe(out.coachIntent?.playId);
    expect(["5v5-122-forecheck", "nz-122-trap", "protect-lead-1-1-3"]).toContain(out.directive?.playId);
  });

  it("HC playId wins when OC disagrees", async () => {
    installFakes(COACH_INTENT, {
      memo: "run a cycle",
      playIdSuggestion: "oz-cycle-low",
      params: { forecheck: "2-1-2", shotPolicy: "cycle" },
    });
    const graph = compile();
    const out = (await graph.invoke(input({ zone: "NZ" }), {
      configurable: { thread_id: "match:m:team:home:epoch:hc-wins" },
    })) as { directive?: { playId: string; playParams?: { forecheck?: string } } };
    expect(out.directive?.playId).toBe("5v5-122-forecheck");
    expect(out.directive?.playParams?.forecheck).toBe("2-1-2");
  });
});
