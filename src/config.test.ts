import { describe, expect, it } from "vitest";
import {
  DEFAULT_AAR_MODEL,
  DEFAULT_COACH_MODEL,
  DEFAULT_FAST_MODEL,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_XAI_BASE_URL,
  LANGSMITH_PROJECT,
  loadConfig,
} from "./config.ts";

describe("loadConfig", () => {
  it("boots without XAI_API_KEY or LangSmith keys", () => {
    const cfg = loadConfig({});
    expect(cfg.xaiApiKey).toBeUndefined();
    expect(cfg.openaiApiKey).toBeUndefined();
    expect(cfg.museApiKey).toBeUndefined();
    expect(cfg.geminiApiKey).toBeUndefined();
    expect(cfg.xaiBaseUrl).toBe(DEFAULT_XAI_BASE_URL);
    expect(cfg.coachModel).toBe(DEFAULT_COACH_MODEL);
    expect(cfg.fastModel).toBe(DEFAULT_FAST_MODEL);
    expect(cfg.aarModel).toBe(DEFAULT_AAR_MODEL);
    expect(cfg.httpHost).toBe(DEFAULT_HTTP_HOST);
    expect(cfg.httpPort).toBe(DEFAULT_HTTP_PORT);
    expect(cfg.langsmithTracing).toBe(false);
    expect(cfg.hitl).toBe(false);
    expect(cfg.periodSeconds).toBe(1200);
    expect(cfg.otSeconds).toBe(300);
  });

  it("shortens periods via GRAPH_HOCKEY_PERIOD_SECONDS and scales OT", () => {
    const cfg = loadConfig({ GRAPH_HOCKEY_PERIOD_SECONDS: "5" });
    expect(cfg.periodSeconds).toBe(5);
    expect(cfg.otSeconds).toBeCloseTo(1.25, 10);
  });

  it("treats blank XAI_API_KEY as unset", () => {
    const cfg = loadConfig({ XAI_API_KEY: "  " });
    expect(cfg.xaiApiKey).toBeUndefined();
  });

  it("accepts Muse MODEL_API_KEY then MUSE_API_KEY and Gemini GEMINI then GOOGLE", () => {
    expect(loadConfig({ MODEL_API_KEY: "meta-key" }).museApiKey).toBe("meta-key");
    expect(loadConfig({ MUSE_API_KEY: "alias" }).museApiKey).toBe("alias");
    expect(loadConfig({ MODEL_API_KEY: "first", MUSE_API_KEY: "second" }).museApiKey).toBe("first");
    expect(loadConfig({ GEMINI_API_KEY: "g" }).geminiApiKey).toBe("g");
    expect(loadConfig({ GOOGLE_API_KEY: "old" }).geminiApiKey).toBe("old");
    expect(loadConfig({ GEMINI_API_KEY: "g", GOOGLE_API_KEY: "old" }).geminiApiKey).toBe("g");
    expect(loadConfig({ OPENAI_API_KEY: "sk-test" }).openaiApiKey).toBe("sk-test");
  });

  it("enables LangSmith tracing from LANGCHAIN_API_KEY without LANGSMITH_TRACING", () => {
    const env: Record<string, string | undefined> = { LANGCHAIN_API_KEY: "ls-test" };
    const cfg = loadConfig(env);
    expect(cfg.langsmithTracing).toBe(true);
    expect(env.LANGSMITH_TRACING).toBe("true");
    expect(env.LANGSMITH_API_KEY).toBe("ls-test");
    expect(env.LANGSMITH_PROJECT).toBe(LANGSMITH_PROJECT);
  });

  it("does not require keys to be present on process.env", () => {
    // Copy so LangSmith side effects cannot leak into the real process env.
    const env = {
      ...process.env,
      XAI_API_KEY: undefined,
      XAI_BASE_URL: undefined,
      LANGSMITH_API_KEY: undefined,
      LANGCHAIN_API_KEY: undefined,
    };
    expect(() => loadConfig(env)).not.toThrow();
  });
});
