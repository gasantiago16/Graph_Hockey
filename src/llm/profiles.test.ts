import { describe, expect, it } from "vitest";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { afterEach } from "vitest";
import { createChatModel, resetLlmClientForTests, setCreateChatModel } from "./client.ts";
import {
  DEFAULT_PROFILES,
  canonicalizeModel,
  formatBenchHud,
  missingProviderKeys,
  parseProviderId,
  providerPresence,
  refuseContributorTier,
  resolveTeamProfile,
} from "./profiles.ts";

afterEach(() => {
  resetLlmClientForTests();
});

describe("TeamLlmProfile", () => {
  it("defaults both benches to xAI grok-4.5 / grok-4.3", () => {
    expect(resolveTeamProfile({})).toEqual(DEFAULT_PROFILES.xai);
    expect(parseProviderId("OpenAI")).toBe("openai");
    expect(() => parseProviderId("anthropic")).toThrow(/unknown provider/);
  });

  it("never defaults muse-spark-1.2-contributor", () => {
    expect(JSON.stringify(DEFAULT_PROFILES)).not.toMatch(/contributor/);
    expect(DEFAULT_PROFILES.muse.coach).toBe("muse-glimmer-30b");
    expect(() => refuseContributorTier("muse-spark-1.2-contributor")).toThrow(/contributor/);
    expect(() => resolveTeamProfile({ provider: "muse", coach: "muse-spark-1.2-contributor" })).toThrow(
      /contributor/,
    );
  });

  it("aliases gpt-5.6 to gpt-5.6-sol", () => {
    expect(canonicalizeModel("openai", "gpt-5.6")).toBe("gpt-5.6-sol");
    expect(resolveTeamProfile({ provider: "openai" }).coach).toBe("gpt-5.6-sol");
    expect(resolveTeamProfile({ provider: "openai" }).fast).toBe("gpt-5.6-luna");
    expect(resolveTeamProfile({ provider: "gemini" }).coach).toBe("gemini-3.1-pro-preview");
    expect(resolveTeamProfile({ provider: "gemini" }).fast).toBe("gemini-3.7-flash");
  });

  it("reads Muse MODEL_API_KEY then MUSE_API_KEY; Gemini GEMINI then GOOGLE", () => {
    expect(providerPresence({})).toEqual({ xai: false, muse: false, openai: false, gemini: false });
    expect(providerPresence({ MODEL_API_KEY: "m", GEMINI_API_KEY: "g" }).muse).toBe(true);
    expect(providerPresence({ MUSE_API_KEY: "m2" }).muse).toBe(true);
    expect(providerPresence({ GOOGLE_API_KEY: "g2" }).gemini).toBe(true);
    expect(providerPresence({ GEMINI_API_KEY: "first", GOOGLE_API_KEY: "second" }).gemini).toBe(true);
    expect(missingProviderKeys("xai", "muse", { XAI_API_KEY: "x" })).toEqual(["muse"]);
  });

  it("HUD labels are names only", () => {
    const line = formatBenchHud(DEFAULT_PROFILES.xai, DEFAULT_PROFILES.muse);
    expect(line).toBe("home: xai/grok-4.5 vs away: muse/muse-glimmer-30b");
    expect(line).not.toMatch(/API_KEY/);
  });

  it("FakeListChatModel inject works for every provider profile", () => {
    const fake = new FakeListChatModel({ responses: ['{"ok":true}'] });
    setCreateChatModel(() => fake);
    for (const profile of Object.values(DEFAULT_PROFILES)) {
      expect(createChatModel({ kind: "coach", profile, env: {} })).toBe(fake);
      expect(createChatModel({ kind: "fast", profile, env: {} })).toBe(fake);
      expect(createChatModel({ kind: "aar", profile, env: {} })).toBe(fake);
    }
  });
});
