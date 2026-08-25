import { describe, expect, it } from "vitest";
import { createBudget, recordLlmUsage, toCostTick } from "../llm/budgets.ts";
import { denylistHits, opponentPlayLeak } from "../server/protocol.ts";
import { formatBenchHud, formatCostHud, formatHudUsd } from "./hud.ts";

const HOME_PLAY = "5v5-122-forecheck";
const AWAY_PLAY = "5v5-212-forecheck";

describe("cost HUD", () => {
  it("formats live $ / tokens / calls per side without playbook keys", () => {
    const tick = {
      type: "cost" as const,
      homeCalls: 3,
      awayCalls: 2,
      promptTokens: 1200,
      outputTokens: 80,
      usd: 0.0042,
    };
    const line = formatCostHud(tick, false);
    expect(line).toBe("$0.0042 · 1200/80 tok · home 3 · away 2 calls");
    expect(line.startsWith("no-llm")).toBe(false);
    expect(line).not.toContain("playId");
    expect(line).not.toContain("playbooks");
    expect(line).not.toContain(HOME_PLAY);
    expect(line).not.toContain(AWAY_PLAY);
    expect(denylistHits(tick)).toEqual([]);
    expect(opponentPlayLeak(tick, "none", { home: HOME_PLAY, away: AWAY_PLAY })).toEqual([]);
  });

  it("prefixes no-llm on the default spectator path", () => {
    expect(formatCostHud({ usd: 0, promptTokens: 0, outputTokens: 0, homeCalls: 0, awayCalls: 0 }, true)).toBe(
      "no-llm · $0.00 · 0/0 tok · home 0 · away 0 calls",
    );
    expect(formatHudUsd(0)).toBe("$0.00");
    expect(formatHudUsd(0.04)).toBe("$0.04");
  });

  it("labels benches by provider/model names only", () => {
    expect(formatBenchHud({ noLlm: true })).toBe("benches: no-llm");
    const line = formatBenchHud({
      noLlm: false,
      homeProvider: "xai",
      homeCoach: "grok-4.5",
      awayProvider: "muse",
      awayCoach: "muse-spark-1.2",
    });
    expect(line).toBe("home: xai/grok-4.5 vs away: muse/muse-spark-1.2");
    expect(line).not.toMatch(/API_KEY/);
  });

  it("toCostTick HUD line still has no opponent playId", () => {
    const b = createBudget();
    recordLlmUsage(b, "home", {
      promptTokens: 10,
      completionTokens: 4,
      reasoningTokens: 2,
      usd: 0.01,
      calls: 1,
    });
    const tick = toCostTick(b);
    const line = formatCostHud(tick, false);
    expect(line).toBe("$0.01 · 10/4 tok · home 1 · away 0 calls");
    expect(JSON.stringify(tick)).not.toContain(HOME_PLAY);
    expect(JSON.stringify(tick)).not.toContain(AWAY_PLAY);
    expect(denylistHits(tick)).toEqual([]);
  });
});
