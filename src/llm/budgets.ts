import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { ChatGeneration, Generation, LLMResult } from "@langchain/core/outputs";
import { DEFAULT_COACH_MODEL } from "../config.ts";
import type { Side } from "../types/hockey.ts";
import type { CostTick } from "../types/ws.ts";

export const MAX_CALLS_PER_TEAM = 150;
export const MAX_PROMPT_TOKENS_PER_GAME = 900_000;
export const MAX_OUTPUT_TOKENS_PER_GAME = 250_000;
export const MAX_USD_PER_GAME = 4.0;
export const EPOCH_TIMEOUT_MS = 8_000;
/** Live LLM graphs: one Head Coach call. --no-llm stays on EPOCH_TIMEOUT_MS. */
export const LIVE_EPOCH_TIMEOUT_MS = 12_000;

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  usd: number;
  calls: number;
};

export type SideBudget = TokenUsage;
export type MatchBudget = {
  home: SideBudget;
  away: SideBudget;
  game: SideBudget;
};

export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

const ZERO_PRICE: ModelPrice = { inputPerMTok: 0, outputPerMTok: 0 };
const unknownPriceWarned = new Set<string>();

/** DESIGN §11 / vendor list prices per 1M tokens (fetched 2026-08-25). */
export const MODEL_PRICES = {
  "grok-4.6": { inputPerMTok: 2.0, outputPerMTok: 6.0 },
  "grok-4.5": { inputPerMTok: 2.0, outputPerMTok: 6.0 },
  "grok-4.3": { inputPerMTok: 1.25, outputPerMTok: 2.5 },
  "muse-spark-1.2": { inputPerMTok: 1.25, outputPerMTok: 4.25 },
  "muse-spark-1.1": { inputPerMTok: 1.25, outputPerMTok: 4.25 },
  "gpt-5.6-sol": { inputPerMTok: 5.0, outputPerMTok: 30.0 },
  "gpt-5.6-terra": { inputPerMTok: 2.0, outputPerMTok: 12.0 },
  "gpt-5.6-luna": { inputPerMTok: 0.2, outputPerMTok: 1.2 },
  "gemini-3.1-pro-preview": { inputPerMTok: 2.0, outputPerMTok: 12.0 },
  "gemini-3.7-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75 },
} as const satisfies Record<string, ModelPrice>;

function zeros(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, usd: 0, calls: 0 };
}

export function emptyUsage(): TokenUsage {
  return zeros();
}

export function copyUsage(u: TokenUsage): TokenUsage {
  return {
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
    reasoningTokens: u.reasoningTokens,
    usd: u.usd,
    calls: u.calls,
  };
}

export function copyBudget(b: MatchBudget): MatchBudget {
  return { home: copyUsage(b.home), away: copyUsage(b.away), game: copyUsage(b.game) };
}

/** Spectator / CLI cost line. Numbers only — never playbook or directives. */
export function toCostTick(b: MatchBudget): CostTick {
  return {
    type: "cost",
    homeCalls: b.home.calls,
    awayCalls: b.away.calls,
    promptTokens: b.game.promptTokens,
    outputTokens: b.game.completionTokens,
    usd: b.game.usd,
  };
}

export function formatCostSummary(b: MatchBudget): string {
  const usd = b.game.usd.toFixed(4);
  return `tokens prompt=${b.game.promptTokens} output=${b.game.completionTokens} reasoning=${b.game.reasoningTokens}  $${usd}  calls home=${b.home.calls} away=${b.away.calls}`;
}

export function createBudget(): MatchBudget {
  return { home: zeros(), away: zeros(), game: zeros() };
}

export function teamTripped(b: MatchBudget, side: Side): boolean {
  return b[side].calls >= MAX_CALLS_PER_TEAM;
}

export function gameTripped(b: MatchBudget): boolean {
  return (
    b.game.promptTokens >= MAX_PROMPT_TOKENS_PER_GAME ||
    b.game.completionTokens >= MAX_OUTPUT_TOKENS_PER_GAME ||
    b.game.usd >= MAX_USD_PER_GAME
  );
}

function add(into: TokenUsage, u: TokenUsage): void {
  into.promptTokens += u.promptTokens;
  into.completionTokens += u.completionTokens;
  into.reasoningTokens += u.reasoningTokens;
  into.usd += u.usd;
  into.calls += u.calls;
}

/** Called from a ChatXAI callback (handleLLMEnd), never from graph.invoke output. */
export function recordLlmUsage(b: MatchBudget, side: Side, u: TokenUsage): void {
  add(b[side], u);
  add(b.game, u);
}

export function priceForModel(model: string): ModelPrice {
  if (model.startsWith("grok-4.6")) return MODEL_PRICES["grok-4.6"];
  if (model.startsWith("grok-4.3")) return MODEL_PRICES["grok-4.3"];
  if (model.startsWith("grok-4.5") || model.startsWith("grok-")) return MODEL_PRICES["grok-4.5"];
  if (model === "gpt-5.6" || model.startsWith("gpt-5.6-sol")) return MODEL_PRICES["gpt-5.6-sol"];
  if (model.startsWith("gpt-5.6-terra")) return MODEL_PRICES["gpt-5.6-terra"];
  if (model.startsWith("gpt-5.6-luna")) return MODEL_PRICES["gpt-5.6-luna"];
  const exact = (MODEL_PRICES as Record<string, ModelPrice>)[model];
  if (exact) return exact;
  for (const [slug, price] of Object.entries(MODEL_PRICES)) {
    if (model.startsWith(slug)) return price;
  }
  if (!unknownPriceWarned.has(model)) {
    unknownPriceWarned.add(model);
    console.warn(`priceForModel: unknown slug "${model}"; USD billed as 0 (call circuit still applies)`);
  }
  return ZERO_PRICE;
}

/** Billed output already includes reasoning — do not add reasoningTokens again. */
export function estimateUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = priceForModel(model);
  return (promptTokens / 1_000_000) * p.inputPerMTok + (completionTokens / 1_000_000) * p.outputPerMTok;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function reasoningFromDetails(details: unknown): number {
  if (!details || typeof details !== "object") return 0;
  const d = details as Record<string, unknown>;
  return num(d.reasoning ?? d.reasoning_tokens);
}

function fromTokenBag(bag: Record<string, unknown> | undefined): {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
} | undefined {
  if (!bag) return undefined;
  const promptTokens = num(bag.promptTokens ?? bag.prompt_tokens ?? bag.input_tokens);
  const completionTokens = num(bag.completionTokens ?? bag.completion_tokens ?? bag.output_tokens);
  const details = bag.completion_tokens_details ?? bag.output_token_details ?? bag.completionTokensDetails;
  const reasoningTokens = reasoningFromDetails(details) || num(bag.reasoning_tokens ?? bag.reasoningTokens);
  if (promptTokens === 0 && completionTokens === 0 && reasoningTokens === 0) {
    if (!("promptTokens" in bag || "prompt_tokens" in bag || "input_tokens" in bag || "completionTokens" in bag || "completion_tokens" in bag || "output_tokens" in bag)) {
      return undefined;
    }
  }
  return { promptTokens, completionTokens, reasoningTokens };
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function generationMessage(g: Generation): { usage_metadata?: unknown; response_metadata?: unknown } | undefined {
  if (!g || typeof g !== "object" || !("message" in g)) return undefined;
  const msg = (g as ChatGeneration).message;
  if (!msg || typeof msg !== "object") return undefined;
  return msg as { usage_metadata?: unknown; response_metadata?: unknown };
}

export function modelFromLlmResult(output: LLMResult, extraParams?: Record<string, unknown>): string | undefined {
  const inv = asRecord(extraParams?.invocation_params);
  if (typeof inv?.model === "string") return inv.model;
  const llmOut = asRecord(output.llmOutput);
  if (typeof llmOut?.model === "string") return llmOut.model;
  if (typeof llmOut?.model_name === "string") return llmOut.model_name;
  const gen = output.generations?.[0]?.[0];
  const msg = gen ? generationMessage(gen) : undefined;
  const rm = asRecord(msg?.response_metadata);
  if (typeof rm?.model === "string") return rm.model;
  if (typeof rm?.model_name === "string") return rm.model_name;
  return undefined;
}

/**
 * Prefer AIMessage.usage_metadata (LangChain maps xAI completion_tokens_details.reasoning_tokens).
 * completionTokens is billed output and already includes reasoning.
 */
export function usageFromLlmResult(output: LLMResult, model: string): TokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let found = false;

  for (const row of output.generations ?? []) {
    for (const g of row) {
      const msg = generationMessage(g);
      const um = asRecord(msg?.usage_metadata);
      if (um) {
        found = true;
        promptTokens += num(um.input_tokens ?? um.prompt_tokens);
        completionTokens += num(um.output_tokens ?? um.completion_tokens);
        reasoningTokens += reasoningFromDetails(um.output_token_details) || num(um.reasoning_tokens);
        continue;
      }
      const rm = asRecord(msg?.response_metadata);
      const bag = fromTokenBag(asRecord(rm?.tokenUsage ?? rm?.token_usage ?? rm?.usage));
      if (bag) {
        found = true;
        promptTokens += bag.promptTokens;
        completionTokens += bag.completionTokens;
        reasoningTokens += bag.reasoningTokens;
      }
    }
  }

  if (!found) {
    const llmOut = asRecord(output.llmOutput);
    const bag = fromTokenBag(asRecord(llmOut?.tokenUsage ?? llmOut?.token_usage ?? llmOut?.usage));
    if (bag) {
      promptTokens = bag.promptTokens;
      completionTokens = bag.completionTokens;
      reasoningTokens = bag.reasoningTokens;
    }
  }

  return {
    promptTokens,
    completionTokens,
    reasoningTokens,
    usd: estimateUsd(model, promptTokens, completionTokens),
    calls: 1,
  };
}

/**
 * ChatXAI / FakeListChatModel callback. Writes MatchBudget; usage is not a graph-state field.
 */
export class UsageTap extends BaseCallbackHandler {
  name = "UsageTap";
  usage: TokenUsage;

  constructor(
    readonly side: Side,
    readonly budget: MatchBudget,
    readonly defaultModel: string = DEFAULT_COACH_MODEL,
  ) {
    super();
    this.usage = emptyUsage();
  }

  get calls(): number {
    return this.usage.calls;
  }

  handleLLMEnd(output: LLMResult, _runId?: string, _parentRunId?: string, _tags?: string[], extraParams?: Record<string, unknown>): void {
    const model = modelFromLlmResult(output, extraParams) ?? this.defaultModel;
    const u = usageFromLlmResult(output, model);
    add(this.usage, u);
    recordLlmUsage(this.budget, this.side, u);
  }
}
