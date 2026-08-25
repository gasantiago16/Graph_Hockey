import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ChatXAI } from "@langchain/xai";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  AAR_MAX_TOKENS,
  COACH_MAX_TOKENS,
  FAST_MAX_TOKENS,
  createChatModel,
  resetLlmClientForTests,
} from "./client.ts";
import { DEFAULT_PROFILES } from "./profiles.ts";
import { museReasoningEffort } from "./providers/openaiCompat.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(() => {
  resetLlmClientForTests();
});

describe("provider adapters (constructor only, no network)", () => {
  it("xai still builds ChatXAI with modelKwargs.reasoning_effort", () => {
    const llm = createChatModel({
      kind: "coach",
      profile: DEFAULT_PROFILES.xai,
      env: { XAI_API_KEY: "test-not-live" },
    });
    expect(llm).toBeInstanceOf(ChatXAI);
    const x = llm as ChatXAI;
    expect(x.model).toBe("grok-4.5");
    expect(x.maxTokens).toBe(COACH_MAX_TOKENS);
    expect(x.modelKwargs).toEqual({ reasoning_effort: "low" });
  });

  it("muse is ChatOpenAI pointed at api.meta.ai Completions", () => {
    const llm = createChatModel({
      kind: "coach",
      profile: DEFAULT_PROFILES.muse,
      env: { MODEL_API_KEY: "test-not-live" },
    }) as ChatOpenAI;
    expect(llm).toBeInstanceOf(ChatOpenAI);
    expect(llm.model).toBe("muse-spark-1.2");
    expect(llm.maxTokens).toBe(COACH_MAX_TOKENS);
    expect(llm.clientConfig.baseURL).toBe("https://api.meta.ai/v1");
    const src = readFileSync(join(root, "src/llm/providers/openaiCompat.ts"), "utf8");
    expect(src).toMatch(/https:\/\/api\.meta\.ai\/v1/);
    expect(src).toMatch(/useResponsesApi:\s*false/);
    expect(src).not.toMatch(/contributor/);
    expect(src).toMatch(/museReasoningEffort/);
  });

  it("muse never sends reasoning_effort none (Spark 400s)", () => {
    expect(museReasoningEffort("none")).toBe("low");
    expect(museReasoningEffort("low")).toBe("low");
    expect(museReasoningEffort("high")).toBe("high");
    const env = { MODEL_API_KEY: "test-not-live" };
    const fast = createChatModel({ kind: "fast", profile: DEFAULT_PROFILES.muse, env }) as ChatOpenAI;
    expect(fast.modelKwargs).toEqual({ reasoning_effort: "low" });
    const coach = createChatModel({ kind: "coach", profile: DEFAULT_PROFILES.muse, env }) as ChatOpenAI;
    expect(coach.modelKwargs).toEqual({ reasoning_effort: "low" });
    const aar = createChatModel({ kind: "aar", profile: DEFAULT_PROFILES.muse, env }) as ChatOpenAI;
    expect(aar.modelKwargs).toEqual({ reasoning_effort: "high" });
    expect(fast.model).toBe("muse-spark-1.2");
    expect(aar.model).toBe("muse-spark-1.2");
  });

  it("openai is ChatOpenAI at the official base with gpt-5.6-sol / luna", () => {
    const coach = createChatModel({
      kind: "coach",
      profile: DEFAULT_PROFILES.openai,
      env: { OPENAI_API_KEY: "sk-test-not-live" },
    }) as ChatOpenAI;
    expect(coach).toBeInstanceOf(ChatOpenAI);
    expect(coach.model).toBe("gpt-5.6-sol");
    const fast = createChatModel({
      kind: "fast",
      profile: DEFAULT_PROFILES.openai,
      env: { OPENAI_API_KEY: "sk-test-not-live" },
    }) as ChatOpenAI;
    expect(fast.model).toBe("gpt-5.6-luna");
    expect(fast.maxTokens).toBe(FAST_MAX_TOKENS);
  });

  it("gemini is ChatGoogleGenerativeAI with thinkingLevel when effort is not none", () => {
    const coach = createChatModel({
      kind: "coach",
      profile: DEFAULT_PROFILES.gemini,
      env: { GEMINI_API_KEY: "test-not-live" },
    }) as ChatGoogleGenerativeAI;
    expect(coach).toBeInstanceOf(ChatGoogleGenerativeAI);
    expect(coach.model).toBe("gemini-3.1-pro-preview");
    expect(coach.maxOutputTokens).toBe(COACH_MAX_TOKENS);
    expect(coach.thinkingConfig).toEqual({ thinkingLevel: "LOW" });

    const fast = createChatModel({
      kind: "fast",
      profile: DEFAULT_PROFILES.gemini,
      env: { GOOGLE_API_KEY: "test-not-live" },
    }) as ChatGoogleGenerativeAI;
    expect(fast.model).toBe("gemini-3.7-flash");
    expect(fast.thinkingConfig).toEqual({ thinkingLevel: "LOW" });

    const aar = createChatModel({
      kind: "aar",
      profile: DEFAULT_PROFILES.gemini,
      env: { GEMINI_API_KEY: "test-not-live" },
    }) as ChatGoogleGenerativeAI;
    expect(aar.maxOutputTokens).toBe(AAR_MAX_TOKENS);
    expect(aar.thinkingConfig).toEqual({ thinkingLevel: "HIGH" });
  });

  it("throws the matching key name when the profile has no secret", () => {
    expect(() => createChatModel({ kind: "coach", profile: DEFAULT_PROFILES.muse, env: {} })).toThrow(/MODEL_API_KEY|MUSE_API_KEY/);
    expect(() => createChatModel({ kind: "coach", profile: DEFAULT_PROFILES.openai, env: {} })).toThrow(/OPENAI_API_KEY/);
    expect(() => createChatModel({ kind: "coach", profile: DEFAULT_PROFILES.gemini, env: {} })).toThrow(/GEMINI_API_KEY|GOOGLE_API_KEY/);
  });
});
