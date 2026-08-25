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
      expect(printed).toContain("footage");
      expect(printed).toContain("GRAPH_HOCKEY_PERIOD_SECONDS");
      expect(USAGE).toContain("xAI only");
    } finally {
      log.mockRestore();
    }
  });

  it("refuses simulate without --no-llm", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["simulate", "--seed", "1"], {})).toBe(1);
      expect(String(err.mock.calls[0]?.[0])).toContain("--no-llm");
    } finally {
      err.mockRestore();
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
    } finally {
      log.mockRestore();
    }
  });
});
