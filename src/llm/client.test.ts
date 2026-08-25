import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatXAI } from "@langchain/xai";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { CoachIntentSchema } from "./schemas.ts";
import {
  AAR_MAX_TOKENS,
  AAR_TIMEOUT_MS,
  COACH_MAX_TOKENS,
  COACH_TIMEOUT_MS,
  FAST_MAX_TOKENS,
  FAST_TIMEOUT_MS,
  aarLlm,
  chatModelSpec,
  coachLlm,
  createChatModel,
  fastLlm,
  hasXaiApiKey,
  isXaiHttp400,
  markReasoningNoneUnsupported,
  resetLlmClientForTests,
  setCreateChatModel,
} from "./client.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dummyEnv = { XAI_API_KEY: "test-not-live" };

afterEach(() => {
  resetLlmClientForTests();
});

describe("chatModelSpec", () => {
  it("pins grok-4.5 coach/AAR and grok-4.3 specialists with Completions timeouts", () => {
    const env = { GRAPH_HOCKEY_COACH_MODEL: undefined, GRAPH_HOCKEY_FAST_MODEL: undefined, GRAPH_HOCKEY_AAR_MODEL: undefined };
    expect(chatModelSpec("coach", env)).toMatchObject({
      model: "grok-4.5",
      effort: "low",
      maxTokens: COACH_MAX_TOKENS,
      timeoutMs: COACH_TIMEOUT_MS,
    });
    expect(chatModelSpec("fast", env)).toMatchObject({
      model: "grok-4.3",
      effort: "none",
      maxTokens: FAST_MAX_TOKENS,
      timeoutMs: FAST_TIMEOUT_MS,
    });
    expect(chatModelSpec("aar", env)).toMatchObject({
      model: "grok-4.5",
      effort: "high",
      maxTokens: AAR_MAX_TOKENS,
      timeoutMs: AAR_TIMEOUT_MS,
    });
    expect(COACH_TIMEOUT_MS).toBe(5_000);
    expect(FAST_TIMEOUT_MS).toBe(2_500);
    expect(AAR_TIMEOUT_MS).toBe(60_000);
    expect(COACH_MAX_TOKENS).toBe(1_600);
    expect(FAST_MAX_TOKENS).toBe(500);
    expect(AAR_MAX_TOKENS).toBe(3_000);
  });

  it("falls back grok-4.3 none → low after ReasoningNoneUnsupported", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      markReasoningNoneUnsupported();
      expect(chatModelSpec("fast", {}).effort).toBe("low");
      expect(chatModelSpec("coach", {}).effort).toBe("low");
      expect(warn).toHaveBeenCalledWith("ReasoningNoneUnsupported");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("createChatModel inject", () => {
  it("uses FakeListChatModel and never needs XAI_API_KEY", async () => {
    const intent = { supposedToHappen: "win the draw", playId: "5v5-122-forecheck", pressure: "neutral" };
    const fake = new FakeListChatModel({ responses: [JSON.stringify(intent)] });
    setCreateChatModel(() => fake);
    const model = createChatModel("coach", {});
    expect(model).toBe(fake);
    expect(coachLlm({})).toBe(fake);
    expect(fastLlm({})).toBe(fake);
    expect(aarLlm({})).toBe(fake);
    const msg = await model.invoke("intent");
    expect(CoachIntentSchema.parse(JSON.parse(String(msg.content)))).toEqual(intent);
  });

  it("throws without a key when no inject is set", () => {
    expect(() => coachLlm({ XAI_API_KEY: undefined })).toThrow(/XAI_API_KEY/);
  });
});

describe("ChatXAI two-arg Completions factories", () => {
  it("constructs ChatXAI(model, fields) with modelKwargs.reasoning_effort (no live invoke)", () => {
    const llm = coachLlm(dummyEnv);
    expect(llm).toBeInstanceOf(ChatXAI);
    const x = llm as ChatXAI;
    expect(x.model).toBe("grok-4.5");
    expect(x.temperature).toBe(0.2);
    expect(x.maxTokens).toBe(COACH_MAX_TOKENS);
    expect(x.timeout).toBe(COACH_TIMEOUT_MS);
    expect(x.modelKwargs).toEqual({ reasoning_effort: "low" });

    const fast = fastLlm(dummyEnv) as ChatXAI;
    expect(fast.model).toBe("grok-4.3");
    expect(fast.timeout).toBe(FAST_TIMEOUT_MS);
    expect(fast.maxTokens).toBe(FAST_MAX_TOKENS);
    expect(fast.modelKwargs).toEqual({ reasoning_effort: "none" });

    const aar = aarLlm(dummyEnv) as ChatXAI;
    expect(aar.model).toBe("grok-4.5");
    expect(aar.timeout).toBe(AAR_TIMEOUT_MS);
    expect(aar.maxTokens).toBe(AAR_MAX_TOKENS);
    expect(aar.modelKwargs).toEqual({ reasoning_effort: "high" });
  });

  it("source uses two-arg ChatXAI + modelKwargs, not withConfig({ reasoning_effort })", () => {
    const src = readFileSync(join(root, "src/llm/client.ts"), "utf8");
    expect(src).toMatch(/new ChatXAI\(spec\.model,/);
    expect(src).toMatch(/modelKwargs:\s*\{\s*reasoning_effort:/);
    expect(src).not.toMatch(/\.withConfig\(\s*\{\s*reasoning_effort/);
  });
});

describe("live smoke gating", () => {
  it("treats blank XAI_API_KEY as unset", () => {
    expect(hasXaiApiKey({})).toBe(false);
    expect(hasXaiApiKey({ XAI_API_KEY: "  " })).toBe(false);
    expect(hasXaiApiKey({ XAI_API_KEY: "xai-test" })).toBe(true);
  });

  it("CI does not run smoke-xai-reasoning", () => {
    const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(ci).not.toMatch(/smoke-xai-reasoning/);
    expect(ci).not.toMatch(/smoke:xai/);
    expect(ci).toMatch(/Do not inject XAI_API_KEY/);
  });

  it("detects HTTP 400 for grok-4.3 none fallback", () => {
    expect(isXaiHttp400({ status: 400 })).toBe(true);
    expect(isXaiHttp400(new Error("400 reasoning_effort none"))).toBe(true);
    expect(isXaiHttp400({ status: 500 })).toBe(false);
  });
});
