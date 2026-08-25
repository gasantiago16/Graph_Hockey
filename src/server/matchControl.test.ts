import { afterEach, describe, expect, it } from "vitest";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { loadConfig } from "../config.ts";
import { resetLlmClientForTests, setCreateChatModel } from "../llm/client.ts";
import { openMemoryDb } from "../persist/db.ts";
import { createMatchControl, llmMatchAllowed, MatchStartError } from "./matchControl.ts";

afterEach(() => {
  resetLlmClientForTests();
});

function injectFakeListChatModel(): void {
  const coach = {
    supposedToHappen: "win the draw",
    playId: "5v5-122-forecheck",
    pressure: "neutral",
  };
  const fast = { memo: "hold structure", playIdSuggestion: "5v5-122-forecheck" };
  setCreateChatModel((kind) => {
    const payload = kind === "coach" ? coach : fast;
    return new FakeListChatModel({
      responses: Array.from({ length: 80 }, () => JSON.stringify(payload)),
    });
  });
}

describe("matchControl LLM gate", () => {
  it("allows LLM when XAI_API_KEY is set or FakeListChatModel is injected", () => {
    expect(llmMatchAllowed(loadConfig({}))).toBe(false);
    expect(llmMatchAllowed(loadConfig({ XAI_API_KEY: "test-not-live" }))).toBe(true);
    injectFakeListChatModel();
    expect(llmMatchAllowed(loadConfig({}))).toBe(true);
  });

  it("rejects noLlm:false without a key or inject", async () => {
    const db = await openMemoryDb();
    try {
      const control = createMatchControl({
        db,
        config: loadConfig({ GRAPH_HOCKEY_PERIOD_SECONDS: "5" }),
        paceMs: 0,
      });
      expect(() =>
        control.start({
          home: "original-six",
          away: "expansion",
          seed: 1,
          noLlm: false,
          periodSeconds: 5,
        }),
      ).toThrow(MatchStartError);
    } finally {
      db.close();
    }
  });

  it("starts noLlm:false with injected FakeListChatModel (no live xAI)", async () => {
    injectFakeListChatModel();
    const db = await openMemoryDb();
    try {
      const seen: Array<{ type: string; noLlm?: boolean }> = [];
      const control = createMatchControl({
        db,
        config: loadConfig({ GRAPH_HOCKEY_PERIOD_SECONDS: "5" }),
        paceMs: 0,
      });
      control.subscribe((event) => {
        seen.push({ type: event.type, noLlm: event.type === "start" ? event.noLlm : undefined });
      });
      const started = control.start({
        home: "original-six",
        away: "expansion",
        seed: 42,
        noLlm: false,
        periodSeconds: 5,
      });
      expect(started.noLlm).toBe(false);
      expect(seen.some((e) => e.type === "start" && e.noLlm === false)).toBe(true);
      await control.stop();
      expect(control.status().running).toBe(false);
    } finally {
      db.close();
    }
  });

  it("keeps default start on --no-llm", async () => {
    const db = await openMemoryDb();
    try {
      const control = createMatchControl({
        db,
        config: loadConfig({ GRAPH_HOCKEY_PERIOD_SECONDS: "5" }),
        paceMs: 0,
      });
      const started = control.start({
        home: "original-six",
        away: "expansion",
        seed: 42,
        noLlm: true,
        periodSeconds: 5,
      });
      expect(started.noLlm).toBe(true);
      await control.stop();
    } finally {
      db.close();
    }
  });
});
