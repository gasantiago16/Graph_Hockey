import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { resetLlmClientForTests, setCreateChatModel } from "../llm/client.ts";
import { USAGE, main } from "./main.ts";

afterEach(() => {
  resetLlmClientForTests();
});

describe("gh CLI", () => {
  it("prints usage for --help and exits 0 without XAI_API_KEY", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await main(["--help"], {})).toBe(0);
      expect(log).toHaveBeenCalled();
      const printed = String(log.mock.calls[0]?.[0]);
      expect(printed).toContain("simulate");
      expect(printed).toContain("replay");
      expect(printed).toContain("aar");
      expect(printed).toContain("playbook");
      expect(printed).toContain("series");
      expect(printed).toContain("--games 7");
      expect(printed).toContain("footage");
      expect(printed).toContain("--series");
      expect(printed).toContain("--compare");
      expect(printed).toContain("--no-record");
      expect(printed).toContain("--aar-mode");
      expect(printed).toContain("--reset-playbook");
      expect(printed).toContain("GRAPH_HOCKEY_PERIOD_SECONDS");
      expect(printed).toContain("playbook-snapshots");
      expect(USAGE).toContain("Default LLM provider is xAI");
      expect(USAGE).toContain("--home-provider");
      expect(USAGE).toContain("muse");
      expect(USAGE).toContain("openai");
      expect(USAGE).toContain("gemini");
    } finally {
      log.mockRestore();
    }
  });

  it("refuses simulate without --no-llm", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["simulate", "--seed", "1"], {})).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toContain("--no-llm");
      err.mockClear();
      expect(await main(["simulate", "--seed", "1", "--home-provider", "muse", "--away-provider", "openai"], {})).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toMatch(/muse,openai/);
    } finally {
      err.mockRestore();
    }
  });

  it("simulate --no-llm ignores provider flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-pr-provider-"));
    const dbPath = join(dir, "graph-hockey.sqlite");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(
        await main(
          [
            "simulate",
            "--no-llm",
            "--home-provider",
            "muse",
            "--away-provider",
            "gemini",
            "--seed",
            "7",
            "--db",
            dbPath,
            "--match",
            "cli-no-llm-providers",
            "--json",
          ],
          { GRAPH_HOCKEY_PERIOD_SECONDS: "5" },
        ),
      ).toBe(0);
      const out = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { noLlm: boolean };
      expect(out.noLlm).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("refuses series without --no-llm and rejects games 0", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["series", "--seed", "1"], {})).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toContain("--no-llm");
      err.mockClear();
      expect(await main(["series", "--no-llm", "--games", "0"], {})).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toMatch(/games/);
    } finally {
      err.mockRestore();
    }
  });

  it("simulate --home-provider openai --away-provider gemini with inject compiles both benches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-pr-ab-"));
    const dbPath = join(dir, "graph-hockey.sqlite");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const seen = new Set<string>();
    const coach = {
      supposedToHappen: "win the draw",
      playId: "5v5-122-forecheck",
      pressure: "neutral",
    };
    const fast = { memo: "hold structure", playIdSuggestion: "5v5-122-forecheck" };
    const aar = { summary: "hold", notes: "ok", causes: [], ops: [] as unknown[] };
    setCreateChatModel((kind, profile) => {
      if (profile?.provider) seen.add(profile.provider);
      const payload = kind === "coach" ? coach : kind === "aar" ? aar : fast;
      return new FakeListChatModel({
        responses: Array.from({ length: 80 }, () => JSON.stringify(payload)),
      });
    });
    try {
      const code = await main(
        [
          "simulate",
          "--seed",
          "3",
          "--home-provider",
          "openai",
          "--away-provider",
          "gemini",
          "--home-model",
          "gpt-5.6-sol",
          "--away-model",
          "gemini-3.1-pro-preview",
          "--db",
          dbPath,
          "--match",
          "cli-openai-gemini",
          "--json",
        ],
        { GRAPH_HOCKEY_PERIOD_SECONDS: "5" },
      );
      expect(code).toBe(0);
      expect(seen.has("openai")).toBe(true);
      expect(seen.has("gemini")).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("simulate with injected FakeListChatModel prints tokens / reasoning / $ (no live xAI)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-pr12-"));
    const dbPath = join(dir, "graph-hockey.sqlite");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const coach = {
      supposedToHappen: "win the draw",
      playId: "5v5-122-forecheck",
      pressure: "neutral",
    };
    const fast = { memo: "hold structure", playIdSuggestion: "5v5-122-forecheck" };
    const aar = {
      summary: "hold the 1-2-2",
      notes: "lock what worked",
      causes: [],
      ops: [] as { op: string; playId: string; reason: string; eventIds: string[] }[],
    };
    setCreateChatModel((kind) => {
      const payload = kind === "coach" ? coach : kind === "aar" ? aar : fast;
      return new FakeListChatModel({
        responses: Array.from({ length: 80 }, () => JSON.stringify(payload)),
      });
    });
    try {
      const code = await main(
        [
          "simulate",
          "--seed",
          "42",
          "--home",
          "original-six",
          "--away",
          "expansion",
          "--db",
          dbPath,
          "--match",
          "cli-pr12-llm",
          "--json",
        ],
        { GRAPH_HOCKEY_PERIOD_SECONDS: "5" },
      );
      expect(code).toBe(0);
      const out = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
        noLlm: boolean;
        cost: { promptTokens: number; outputTokens: number; reasoningTokens: number; usd: number };
      };
      expect(out.noLlm).toBe(false);
      expect(out.cost).toEqual(
        expect.objectContaining({
          promptTokens: expect.any(Number),
          outputTokens: expect.any(Number),
          reasoningTokens: expect.any(Number),
          usd: expect.any(Number),
        }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it("simulate --no-llm then replay with a short period (no XAI_API_KEY)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-pr8-"));
    const dbPath = join(dir, "graph-hockey.sqlite");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const env = { GRAPH_HOCKEY_PERIOD_SECONDS: "5" };
    try {
      const simCode = await main(
        [
          "simulate",
          "--no-llm",
          "--seed",
          "42",
          "--home",
          "original-six",
          "--away",
          "expansion",
          "--db",
          dbPath,
          "--match",
          "cli-pr8",
          "--json",
        ],
        env,
      );
      expect(simCode).toBe(0);
      const simOut = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
        matchId: string;
        eventHash: string;
        events: number;
      };
      expect(simOut.matchId).toBe("cli-pr8");
      expect(simOut.events).toBeGreaterThan(0);

      log.mockClear();
      const replayCode = await main(["replay", "--match", "cli-pr8", "--db", dbPath, "--json"], env);
      expect(replayCode).toBe(0);
      const replayOut = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { eventHash: string };
      expect(replayOut.eventHash).toBe(simOut.eventHash);

      log.mockClear();
      const aarCode = await main(["aar", "--match", "cli-pr8", "--db", dbPath, "--dump", "--json"], env);
      expect(aarCode).toBe(0);
      const aarOut = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
        reports: { side: string; report: { body: { noLlm?: boolean; actualSummary?: string } } | undefined }[];
      };
      expect(aarOut.reports).toHaveLength(2);
      expect(aarOut.reports[0]?.report?.body.noLlm).toBe(true);
      expect(aarOut.reports[0]?.report?.body.actualSummary).toBeTruthy();

      log.mockClear();
      const bookCode = await main(
        ["playbook", "--team", "original-six", "--db", dbPath, "--json"],
        env,
      );
      expect(bookCode).toBe(0);
      const bookOut = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { version: number; teamId: string };
      expect(bookOut.teamId).toBe("original-six");
      expect(bookOut.version).toBe(1);

      log.mockClear();
      const diffCode = await main(
        ["playbook", "--team", "original-six", "--diff", "--db", dbPath, "--json"],
        env,
      );
      expect(diffCode).toBe(0);
      const diffOut = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
        fromVersion: number;
        toVersion: number;
        changed: unknown[];
      };
      expect(diffOut.fromVersion).toBe(1);
      expect(diffOut.toVersion).toBe(1);
      expect(diffOut.changed).toEqual([]);

      log.mockClear();
      const footageCode = await main(["footage", "--match", "cli-pr8", "--db", dbPath, "--json"], env);
      expect(footageCode).toBe(0);
      const footageOut = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
        matchId: string;
        recording: { durationLiveTicks: number };
        clips: unknown[];
      };
      expect(footageOut.matchId).toBe("cli-pr8");
      expect(footageOut.recording.durationLiveTicks).toBeGreaterThan(0);
      expect(Array.isArray(footageOut.clips)).toBe(true);

      log.mockClear();
      const noRecCode = await main(
        [
          "simulate",
          "--no-llm",
          "--no-record",
          "--seed",
          "42",
          "--db",
          dbPath,
          "--match",
          "cli-norecord",
          "--json",
        ],
        env,
      );
      expect(noRecCode).toBe(0);
      const noRecOut = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { recorded: boolean };
      expect(noRecOut.recorded).toBe(false);
      log.mockClear();
      const miss = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await main(["footage", "--match", "cli-norecord", "--db", dbPath], env)).toBe(1);
      expect(String(miss.mock.calls[0]?.[0])).toContain("no recording");
      miss.mockRestore();
    } finally {
      log.mockRestore();
    }
  });

  it("playbook --reset-playbook restores seed version 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-pr14-"));
    const dbPath = join(dir, "graph-hockey.sqlite");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await main(["playbook", "--team", "original-six", "--db", dbPath, "--json"], {})).toBe(0);
      expect(await main(["playbook", "--team", "original-six", "--reset-playbook", "--db", dbPath, "--json"], {})).toBe(0);
      const out = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { version: number; reset: boolean };
      expect(out.version).toBe(1);
      expect(out.reset).toBe(true);
    } finally {
      log.mockRestore();
    }
  });

  it("footage --series prints ledger after a --no-llm series", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gh-pr15b-"));
    const dbPath = join(dir, "graph-hockey.sqlite");
    const snap = join(dir, "snaps");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = { GRAPH_HOCKEY_PERIOD_SECONDS: "5" };
    try {
      expect(
        await main(
          [
            "series",
            "--no-llm",
            "--games",
            "2",
            "--seed",
            "100",
            "--id",
            "ser-cli-15b",
            "--db",
            dbPath,
            "--snapshot-dir",
            snap,
            "--json",
          ],
          env,
        ),
      ).toBe(0);

      log.mockClear();
      expect(await main(["footage", "--series", "ser-cli-15b", "--db", dbPath, "--json"], env)).toBe(0);
      const out = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as {
        seriesId: string;
        games: unknown[];
        ledger: unknown[];
        deltas: { home: { xgFor?: number } };
      };
      expect(out.seriesId).toBe("ser-cli-15b");
      expect(out.games).toHaveLength(2);
      expect(out.ledger).toHaveLength(4);
      expect(out.deltas.home).toBeDefined();

      log.mockClear();
      expect(
        await main(["footage", "--series", "ser-cli-15b", "--compare", "0,1", "--db", dbPath, "--json"], env),
      ).toBe(0);
      const cmp = JSON.parse(String(log.mock.calls.at(-1)?.[0])) as { compare: { early: number; late: number } };
      expect(cmp.compare).toEqual({ early: 0, late: 1 });

      expect(await main(["footage", "--series", "missing", "--db", dbPath], env)).toBe(1);
      expect(String(err.mock.calls.at(-1)?.[0])).toContain("no series");
      err.mockClear();
      expect(await main(["footage", "--series", "ser-cli-15b", "--compare", "nope", "--db", dbPath], env)).toBe(1);
      expect(String(err.mock.calls.at(-1)?.[0])).toContain("--compare");
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  }, 60_000);
});
