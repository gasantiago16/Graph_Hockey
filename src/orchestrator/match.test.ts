import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { compileTeamGraph } from "../agents/teamGraph.ts";
import { scaledOtSeconds } from "../config.ts";
import { listEpochInvocations, listEvents } from "../persist/events.ts";
import { openMemoryDb } from "../persist/db.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { collectReplayEvents, eventStreamHash } from "../sim/replay.ts";
import { runMatch } from "./match.ts";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/golden/pr8-simulate-seed42.json");

const SHORT_PERIOD = 5;

async function sim(seed: number, matchId: string) {
  const db = await openMemoryDb();
  const homePlaybook = loadPlaybook("original-six");
  const awayPlaybook = loadPlaybook("expansion");
  const result = await runMatch({
    matchId,
    seed,
    homeTeamId: "original-six",
    awayTeamId: "expansion",
    homePlaybook,
    awayPlaybook,
    homeGraph: compileTeamGraph({ side: "home", playbook: homePlaybook, checkpointer: new MemorySaver() }),
    awayGraph: compileTeamGraph({ side: "away", playbook: awayPlaybook, checkpointer: new MemorySaver() }),
    db,
    periodSeconds: SHORT_PERIOD,
    otSeconds: scaledOtSeconds(SHORT_PERIOD),
    startedAt: "2026-08-24T00:00:00.000Z",
    timeoutMs: 2000,
  });
  return { db, result };
}

describe("runMatch --no-llm stub graphs", () => {
  it("plays a short 5v5, writes events, and matches replay hash (seed 42)", async () => {
    const { db, result } = await sim(42, "golden-pr8");
    try {
      expect(result.events.length).toBeGreaterThan(0);
      expect(result.epochs).toBeGreaterThan(0);
      expect(listEvents(db, "golden-pr8").length).toBe(result.events.length);
      expect(listEpochInvocations(db, "golden-pr8").length).toBeGreaterThan(0);
      expect(listEpochInvocations(db, "golden-pr8")[0]?.epochKind).toBe("macro");

      const replayed = collectReplayEvents("golden-pr8", db);
      expect(eventStreamHash(replayed)).toBe(result.eventHash);
      expect(replayed.map((e) => e.type)).toEqual(result.events.map((e) => e.type));

      const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
        seed: number;
        periodSeconds: number;
        hash: string;
        count: number;
      };
      expect(result.eventHash).toBe(fixture.hash);
      expect(result.events.length).toBe(fixture.count);
      expect(fixture.seed).toBe(42);
      expect(fixture.periodSeconds).toBe(SHORT_PERIOD);
    } finally {
      db.close();
    }
  });

  it("is stable across two independent runs with the same seed", async () => {
    const a = await sim(42, "stable-a");
    const b = await sim(42, "stable-b");
    try {
      expect(a.result.eventHash).toBe(b.result.eventHash);
      expect(a.result.score).toEqual(b.result.score);
      expect(a.result.epochs).toBe(b.result.epochs);
    } finally {
      a.db.close();
      b.db.close();
    }
  });
});
