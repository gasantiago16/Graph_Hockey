import { afterEach, describe, expect, it, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { resetLlmClientForTests, setCreateChatModel } from "../llm/client.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { makeEventId } from "../types/ids.ts";
import type { MatchEvent } from "../types/events.ts";
import type { PlaybookRevision } from "../types/play.ts";
import {
  AAR_GRAPH_NODES,
  AAR_RECURSION_LIMIT,
  aarThreadId,
  compileAarGraph,
  lensRouter,
  type CompiledAarGraph,
} from "./aarGraph.ts";

const book = loadPlaybook("original-six");

function ev(seq: number, type: string, over: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: makeEventId("m", seq),
    seq,
    liveTick: seq * 8,
    stoppageSeq: 0,
    period: 1,
    type,
    zone: over.zone ?? "OZ",
    xG: over.xG,
    actor: over.actor ?? "h-C",
    payload: over.payload ?? { side: "home" },
  };
}

const EVENTS: MatchEvent[] = [
  ev(0, "FaceoffWin", { zone: "NZ" }),
  ev(1, "ZoneEntry"),
  ev(2, "Shot", { xG: 0.22 }),
  ev(3, "Goal", { xG: 0.22 }),
];

const INTENT = { summary: "Win the draw and run the 1-2-2." };
const WHY = {
  causes: [{ claim: "The cycle produced the goal.", eventIds: ["m:3"], playIds: ["5v5-122-forecheck"] }],
};
const LENS = { notes: "Lock the 1-2-2. Watch dump-to-strong-side tells." };
const DRAFT: PlaybookRevision = {
  summary: "Boost the 1-2-2; drop a hallucinated nerf.",
  ops: [
    { op: "boost", playId: "5v5-122-forecheck", reason: "goal sequence", eventIds: ["m:3"] },
    { op: "nerf", playId: "nz-122-trap", reason: "invented", eventIds: ["m:999"] },
  ],
};

function installAarFakes(draft: PlaybookRevision = DRAFT): string[] {
  const kinds: string[] = [];
  const payloads = [INTENT, WHY, LENS, draft];
  let i = 0;
  setCreateChatModel((kind) => {
    kinds.push(kind);
    const payload = payloads[Math.min(i, payloads.length - 1)];
    i += 1;
    const text = JSON.stringify(payload);
    return new FakeListChatModel({ responses: [text, text] });
  });
  return kinds;
}

function compile(over: { noLlm?: boolean } = {}): CompiledAarGraph {
  return compileAarGraph({ checkpointer: new MemorySaver(), noLlm: over.noLlm });
}

const input = {
  matchId: "m",
  side: "home" as const,
  result: "win" as const,
  playbook: book,
  events: EVENTS,
};

async function visited(graph: CompiledAarGraph, result: "win" | "loss" | "tie", thread: string): Promise<string[]> {
  const names: string[] = [];
  const stream = await graph.stream(
    { ...input, result },
    { streamMode: "updates", configurable: { thread_id: thread }, recursionLimit: AAR_RECURSION_LIMIT },
  );
  for await (const chunk of stream) {
    if (!chunk || typeof chunk !== "object") continue;
    names.push(...Object.keys(chunk));
  }
  return names;
}

afterEach(() => {
  resetLlmClientForTests();
});

describe("compileAarGraph", () => {
  it("compiles load/intent/actual/why/lenses/draft/cite_check", () => {
    const graph = compile({ noLlm: true });
    const names = Object.keys(graph.nodes);
    for (const n of AAR_GRAPH_NODES) {
      expect(names).toContain(n);
    }
    expect(aarThreadId("m", "home")).toBe("aar:m:home");
    expect(AAR_RECURSION_LIMIT).toBe(8);
  });

  it("routes win → winner_lens and loss/tie → loser_lens", () => {
    expect(lensRouter({ result: "win" })).toBe("winner_lens");
    expect(lensRouter({ result: "loss" })).toBe("loser_lens");
    expect(lensRouter({ result: "tie" })).toBe("loser_lens");
  });

  it("visits winner_lens on a win and loser_lens on a tie", async () => {
    installAarFakes();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const graph = compile();
      const win = await visited(graph, "win", "aar:m:home");
      expect(win).toContain("load_match");
      expect(win).toContain("intent");
      expect(win).toContain("actual");
      expect(win).toContain("why");
      expect(win).toContain("winner_lens");
      expect(win).not.toContain("loser_lens");
      expect(win).toContain("draft_revision");
      expect(win).toContain("cite_check");

      const tie = await visited(graph, "tie", "aar:m:home-tie");
      expect(tie).toContain("loser_lens");
      expect(tie).not.toContain("winner_lens");
    } finally {
      warn.mockRestore();
    }
  });

  it("uses FakeListChatModel and drops bad citations", async () => {
    const kinds = installAarFakes();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const graph = compile();
      const out = (await graph.invoke(input, {
        configurable: { thread_id: "aar:m:home:cite" },
        recursionLimit: AAR_RECURSION_LIMIT,
      })) as { revision?: PlaybookRevision; rejectedOps?: string[]; actualSummary?: string };
      expect(kinds.every((k) => k === "aar")).toBe(true);
      expect(kinds.length).toBeGreaterThanOrEqual(4);
      expect(out.actualSummary).toMatch(/xG/);
      expect(out.revision?.ops).toHaveLength(1);
      expect(out.revision?.ops[0]).toMatchObject({ op: "boost", eventIds: ["m:3"] });
      expect(out.rejectedOps?.some((r) => r.includes("nerf") && r.includes("m:999"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("noLlm skips grok-4.5 and still writes a code actual digest", async () => {
    const factory = vi.fn(() => {
      throw new Error("AAR LLM should not run on --no-llm");
    });
    setCreateChatModel(factory);
    const graph = compile({ noLlm: true });
    const out = (await graph.invoke(
      { ...input, result: "loss" },
      { configurable: { thread_id: "aar:m:away:no-llm" }, recursionLimit: AAR_RECURSION_LIMIT },
    )) as { actualSummary?: string; revision?: PlaybookRevision };
    expect(factory).not.toHaveBeenCalled();
    expect(out.actualSummary).toBeTruthy();
    expect((out.revision?.ops ?? []).some((o) => o.op === "add_counter")).toBe(true);
  });
});
