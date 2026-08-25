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
    expect(cfg.xaiBaseUrl).toBe(DEFAULT_XAI_BASE_URL);
    expect(cfg.coachModel).toBe(DEFAULT_COACH_MODEL);
    expect(cfg.fastModel).toBe(DEFAULT_FAST_MODEL);
    expect(cfg.aarModel).toBe(DEFAULT_AAR_MODEL);
    expect(cfg.httpHost).toBe(DEFAULT_HTTP_HOST);
    expect(cfg.httpPort).toBe(DEFAULT_HTTP_PORT);
    expect(cfg.langsmithTracing).toBe(false);
    expect(cfg.hitl).toBe(false);
  });

  it("treats blank XAI_API_KEY as unset", () => {
    const cfg = loadConfig({ XAI_API_KEY: "  " });
    expect(cfg.xaiApiKey).toBeUndefined();
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
    const prev = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
    try {
      expect(() => loadConfig()).not.toThrow();
      expect(loadConfig().xaiBaseUrl).toBe(DEFAULT_XAI_BASE_URL);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});
