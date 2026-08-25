import type { Side } from "../types/hockey.ts";

export const MAX_CALLS_PER_TEAM = 150;
export const MAX_PROMPT_TOKENS_PER_GAME = 900_000;
export const MAX_OUTPUT_TOKENS_PER_GAME = 250_000;
export const MAX_USD_PER_GAME = 4.0;
export const EPOCH_TIMEOUT_MS = 8_000;

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

function zeros(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, usd: 0, calls: 0 };
}

export function emptyUsage(): TokenUsage {
  return zeros();
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

/** Called from a ChatXAI callback (handleLLMEnd) in later PRs, never from graph.invoke output. */
export function recordLlmUsage(b: MatchBudget, side: Side, u: TokenUsage): void {
  add(b[side], u);
  add(b.game, u);
}
