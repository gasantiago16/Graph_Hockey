import type { CostTick } from "../types/ws.ts";

export type CostHudTick = Pick<
  CostTick,
  "usd" | "promptTokens" | "outputTokens" | "homeCalls" | "awayCalls"
>;

/** Compact USD for the rink HUD. Tiny live totals keep four decimals. */
export function formatHudUsd(usd: number): string {
  const n = Number.isFinite(usd) ? usd : 0;
  if (n === 0) return "$0.00";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Live `$` / prompt+output tokens / calls per side.
 * Numbers only — never playId, playbooks, or directives.
 */
export function formatCostHud(tick: CostHudTick, noLlm = true): string {
  const line = `${formatHudUsd(tick.usd)} · ${tick.promptTokens}/${tick.outputTokens} tok · home ${tick.homeCalls} · away ${tick.awayCalls} calls`;
  return noLlm ? `no-llm · ${line}` : line;
}
