import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { USAGE, main } from "./main.ts";

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
    } finally {
      log.mockRestore();
    }
  });
});
