import { afterEach, describe, expect, it, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import { defaultDirective } from "../engine/world.ts";
import type { TeamObservation } from "../types/observation.ts";
import { invokeTeam, type InvokableTeamGraph } from "../orchestrator/invokeTeam.ts";
import { resetLlmClientForTests, setCreateChatModel } from "./client.ts";
import {
  MAX_CALLS_PER_TEAM,
  MAX_OUTPUT_TOKENS_PER_GAME,
  MAX_PROMPT_TOKENS_PER_GAME,
  MAX_USD_PER_GAME,
  UsageTap,
  createBudget,
  estimateUsd,
  formatCostSummary,
  gameTripped,
  recordLlmUsage,
  teamTripped,
  toCostTick,
  usageFromLlmResult,
} from "./budgets.ts";

afterEach(() => {
  resetLlmClientForTests();
});

function llmResult(over: {
  input?: number;
  output?: number;
  reasoning?: number;
  model?: string;
}): LLMResult {
  const gen = {
    text: "{}",
    message: new AIMessage({
      content: "{}",
      usage_metadata: {
        input_tokens: over.input ?? 0,
        output_tokens: over.output ?? 0,
        total_tokens: (over.input ?? 0) + (over.output ?? 0),
        output_token_details: over.reasoning ? { reasoning: over.reasoning } : undefined,
      },
      response_metadata: over.model ? { model: over.model } : {},
    }),
  } as ChatGeneration;
  return { generations: [[gen]] };
}

const last = defaultDirective();
const obs = {
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
} as TeamObservation;

describe("circuit breaker", () => {
  it("toCostTick is numbers only (no playbook)", () => {
    const b = createBudget();
    recordLlmUsage(b, "home", {
      promptTokens: 10,
      completionTokens: 4,
      reasoningTokens: 2,
      usd: 0.01,
      calls: 1,
    });
    const tick = toCostTick(b);
    expect(tick).toEqual({
      type: "cost",
      homeCalls: 1,
      awayCalls: 0,
      promptTokens: 10,
      outputTokens: 4,
      usd: 0.01,
    });
    const json = JSON.stringify(tick);
    expect(json).not.toContain("playId");
    expect(json).not.toContain("playbooks");
    expect(formatCostSummary(b)).toContain("reasoning=2");
    expect(formatCostSummary(b)).toContain("$0.0100");
  });

  it("151st home call freezes home only", () => {
    const b = createBudget();
    const homeTap = new UsageTap("home", b, "grok-4.5");
    for (let i = 0; i < MAX_CALLS_PER_TEAM; i++) {
      homeTap.handleLLMEnd(llmResult({ input: 1, output: 1 }));
    }
    expect(b.home.calls).toBe(150);
    expect(teamTripped(b, "home")).toBe(true);
    expect(teamTripped(b, "away")).toBe(false);
    expect(gameTripped(b)).toBe(false);
  });

  it("prompt / output (incl. reasoning) / $ caps are game-level", () => {
    const prompt = createBudget();
    recordLlmUsage(prompt, "away", {
      promptTokens: MAX_PROMPT_TOKENS_PER_GAME,
      completionTokens: 0,
      reasoningTokens: 0,
      usd: 0,
      calls: 1,
    });
    expect(gameTripped(prompt)).toBe(true);
    expect(teamTripped(prompt, "home")).toBe(false);

    const output = createBudget();
    recordLlmUsage(output, "home", {
      promptTokens: 0,
      completionTokens: MAX_OUTPUT_TOKENS_PER_GAME,
      reasoningTokens: 200_000,
      usd: 0,
      calls: 1,
    });
    expect(gameTripped(output)).toBe(true);

    const usd = createBudget();
    recordLlmUsage(usd, "home", {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      usd: MAX_USD_PER_GAME,
      calls: 1,
    });
    expect(gameTripped(usd)).toBe(true);
  });
});

describe("usage from callbacks", () => {
  it("parses usage_metadata including reasoning without double-counting USD", () => {
    const u = usageFromLlmResult(llmResult({ input: 100, output: 1500, reasoning: 1200 }), "grok-4.5");
    expect(u.promptTokens).toBe(100);
    expect(u.completionTokens).toBe(1500);
    expect(u.reasoningTokens).toBe(1200);
    expect(u.calls).toBe(1);
    expect(u.usd).toBe(estimateUsd("grok-4.5", 100, 1500));
    expect(u.usd).not.toBe(estimateUsd("grok-4.5", 100, 1500 + 1200));
  });

  it("prices grok-4.5 vs grok-4.3 per 1M tokens", () => {
    expect(estimateUsd("grok-4.5", 1_000_000, 1_000_000)).toBeCloseTo(8, 10);
    expect(estimateUsd("grok-4.3", 1_000_000, 1_000_000)).toBeCloseTo(3.75, 10);
  });

  it("prices default lab slugs and bills unknown as $0", () => {
    expect(estimateUsd("gpt-5.6-sol", 1_000_000, 1_000_000)).toBeCloseTo(35, 10);
    expect(estimateUsd("gpt-5.6-luna", 1_000_000, 1_000_000)).toBeCloseTo(1.4, 10);
    expect(estimateUsd("muse-spark-1.2", 1_000_000, 1_000_000)).toBeCloseTo(5.5, 10);
    expect(estimateUsd("gemini-3.1-pro-preview", 1_000_000, 1_000_000)).toBeCloseTo(14, 10);
    expect(estimateUsd("gemini-3.7-flash", 1_000_000, 1_000_000)).toBeCloseTo(4.5, 10);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(estimateUsd("totally-unknown-slug", 1_000_000, 1_000_000)).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unknown slug/));
    } finally {
      warn.mockRestore();
    }
  });

  it("UsageTap records FakeListChatModel handleLLMEnd into MatchBudget, not graph state", async () => {
    const b = createBudget();
    const tap = new UsageTap("home", b, "grok-4.5");
    const fake = new FakeListChatModel({ responses: [JSON.stringify({ ok: true })] });
    setCreateChatModel(() => fake);
    await fake.invoke("hi", { callbacks: [tap] });
    expect(b.home.calls).toBe(1);
    expect(b.game.calls).toBe(1);
    expect(b.away.calls).toBe(0);
    tap.handleLLMEnd(llmResult({ input: 40, output: 10, reasoning: 6, model: "grok-4.5" }));
    expect(b.home.promptTokens).toBe(40);
    expect(b.home.reasoningTokens).toBe(6);
    expect(b.game.promptTokens).toBe(40);
  });

  it("invokeTeam bills from UsageTap callbacks, ignoring graph output usage fields", async () => {
    const budget = createBudget();
    const graph: InvokableTeamGraph = {
      invoke: async (_input, config) => {
        const cbs = (config as { callbacks?: UsageTap[] } | undefined)?.callbacks;
        const tap = cbs?.[0];
        tap?.handleLLMEnd(llmResult({ input: 12, output: 8, reasoning: 5, model: "grok-4.3" }));
        return {
          directive: { playId: "5v5-122-forecheck", pressure: "neutral" },
          usage: { promptTokens: 999, calls: 99 },
        };
      },
    };
    const r = await invokeTeam({
      graph,
      side: "home",
      obs,
      last,
      epochIndex: 0,
      matchId: "m",
      budget,
      timeoutMs: 50,
    });
    expect(r.ok).toBe(true);
    expect(r.usage.promptTokens).toBe(12);
    expect(r.usage.completionTokens).toBe(8);
    expect(r.usage.reasoningTokens).toBe(5);
    expect(r.usage.calls).toBe(1);
    expect(r.billed).toBe(true);
    expect(budget.home.calls).toBe(1);
    expect(budget.away.calls).toBe(0);
  });
});
