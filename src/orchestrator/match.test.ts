import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemorySaver } from "@langchain/langgraph";
import { afterEach, describe, expect, it } from "vitest";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { compileTeamGraph, epochRouter } from "../agents/teamGraph.ts";
import { scaledOtSeconds } from "../config.ts";
import { createWorld, defaultDirective } from "../engine/world.ts";
import { createBudget } from "../llm/budgets.ts";
import { resetLlmClientForTests, setCreateChatModel } from "../llm/client.ts";
import { getFootage } from "../persist/clips.ts";
import { listEpochInvocations, listEvents } from "../persist/events.ts";
import { getAarReport } from "../persist/matches.ts";
import { openMemoryDb } from "../persist/db.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { collectReplayEvents, eventStreamHash } from "../sim/replay.ts";
import type { MatchEvent } from "../types/events.ts";
import { createEpochTracker, shouldDecide } from "./epochs.ts";
import { invokeTeam, type InvokableTeamGraph } from "./invokeTeam.ts";
import { observe } from "./observe.ts";
import { runMatch } from "./match.ts";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/golden/pr8-simulate-seed42.json");

const SHORT_PERIOD = 5;

afterEach(() => {
  resetLlmClientForTests();
});

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
    homeGraph: compileTeamGraph({
      side: "home",
      playbook: homePlaybook,
      checkpointer: new MemorySaver(),
      noLlm: true,
    }),
    awayGraph: compileTeamGraph({
      side: "away",
      playbook: awayPlaybook,
      checkpointer: new MemorySaver(),
      noLlm: true,
    }),
    db,
    periodSeconds: SHORT_PERIOD,
    otSeconds: scaledOtSeconds(SHORT_PERIOD),
    startedAt: "2026-08-24T00:00:00.000Z",
    timeoutMs: 2000,
    noLlm: true,
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
      const epochs = listEpochInvocations(db, "golden-pr8");
      expect(epochs[0]?.epochKind).toBe("macro");
      for (const row of epochs) {
        expect(row.epochKind === "macro" || row.epochKind === "micro").toBe(true);
        if (row.epochKind === "micro") {
          expect(["icing", "offside", "faceoff", "zone_entry", "possession_review"]).toContain(row.reason);
        }
      }
      expect(result.budget.game.calls).toBe(0);

      const replayed = collectReplayEvents("golden-pr8", db);
      expect(eventStreamHash(replayed)).toBe(result.eventHash);
      expect(replayed.map((e) => e.type)).toEqual(result.events.map((e) => e.type));

      const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
        seed: number;
        periodSeconds: number;
        hash: string;
        count: number;
        epochs: number;
      };
      expect(result.eventHash).toBe(fixture.hash);
      expect(result.events.length).toBe(fixture.count);
      expect(result.epochs).toBe(fixture.epochs);
      expect(fixture.seed).toBe(42);
      expect(fixture.periodSeconds).toBe(SHORT_PERIOD);
      expect(result.aar?.home.noLlm).toBe(true);
      expect(result.aar?.away.noLlm).toBe(true);
      expect(result.aar?.home.actualSummary).toBeTruthy();
      expect(getAarReport(db, "golden-pr8", "home")?.applied).toBe(false);
      expect(getAarReport(db, "golden-pr8", "away")?.body).toBeTruthy();
      const footage = getFootage(db, "golden-pr8");
      expect(footage?.recording.durationLiveTicks).toBe(result.liveTick);
      expect(footage?.clips).toBeDefined();
    } finally {
      db.close();
    }
  });

  it("skips clip index when record: false", async () => {
    const db = await openMemoryDb();
    try {
      const homePlaybook = loadPlaybook("original-six");
      const awayPlaybook = loadPlaybook("expansion");
      await runMatch({
        matchId: "no-record",
        seed: 42,
        homeTeamId: "original-six",
        awayTeamId: "expansion",
        homePlaybook,
        awayPlaybook,
        homeGraph: compileTeamGraph({
          side: "home",
          playbook: homePlaybook,
          checkpointer: new MemorySaver(),
          noLlm: true,
        }),
        awayGraph: compileTeamGraph({
          side: "away",
          playbook: awayPlaybook,
          checkpointer: new MemorySaver(),
          noLlm: true,
        }),
        db,
        periodSeconds: SHORT_PERIOD,
        otSeconds: scaledOtSeconds(SHORT_PERIOD),
        startedAt: "2026-08-24T00:00:00.000Z",
        timeoutMs: 2000,
        noLlm: true,
        record: false,
      });
      expect(getFootage(db, "no-record")).toBeUndefined();
      expect(listEvents(db, "no-record").length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("playStillValid skip does not invoke that side", async () => {
    const six = loadPlaybook("original-six");
    const world = createWorld({
      phase: "live",
      liveTick: 40,
      playId: { home: "5v5-122-forecheck", away: "5v5-122-forecheck" },
      playbooks: { home: six, away: six },
      puck: { pos: { x: 50, y: 0 } },
    });
    const ev: MatchEvent[] = [
      {
        id: "m:0",
        seq: 0,
        liveTick: 40,
        stoppageSeq: 0,
        period: 1,
        type: "ZoneEntry",
      },
    ];
    const decision = shouldDecide(
      world,
      ev,
      defaultDirective("5v5-122-forecheck"),
      defaultDirective("5v5-122-forecheck"),
      createEpochTracker(),
    );
    expect(decision.home).toBeUndefined();
    expect(decision.away?.kind).toBe("micro");

    let homeCalls = 0;
    let awayCalls = 0;
    const homeGraph: InvokableTeamGraph = {
      invoke: async () => {
        homeCalls += 1;
        return { directive: defaultDirective("5v5-122-forecheck") };
      },
    };
    const awayGraph: InvokableTeamGraph = {
      invoke: async (input) => {
        awayCalls += 1;
        expect(input.epochKind).toBe("micro");
        return { directive: defaultDirective("5v5-122-forecheck") };
      },
    };
    const budget = createBudget();
    if (decision.home) {
      await invokeTeam({
        graph: homeGraph,
        side: "home",
        obs: observe(world, "home", decision.home),
        last: defaultDirective("5v5-122-forecheck"),
        epochIndex: 0,
        matchId: "skip",
        budget,
        timeoutMs: 50,
      });
    }
    if (decision.away) {
      await invokeTeam({
        graph: awayGraph,
        side: "away",
        obs: observe(world, "away", decision.away),
        last: defaultDirective("5v5-122-forecheck"),
        epochIndex: 0,
        matchId: "skip",
        budget,
        timeoutMs: 50,
      });
    }
    expect(homeCalls).toBe(0);
    expect(awayCalls).toBe(1);
  });

  it("compiled graph micro path never visits head_coach", async () => {
    expect(epochRouter({ epochKind: "micro" })).toBe("assemble_directive");
    const kinds: string[] = [];
    setCreateChatModel((kind) => {
      kinds.push(kind);
      return new FakeListChatModel({
        responses: [
          JSON.stringify({
            memo: "hold",
            playIdSuggestion: "5v5-122-forecheck",
          }),
        ],
      });
    });
    const book = loadPlaybook("original-six");
    const graph = compileTeamGraph({ side: "home", playbook: book, checkpointer: new MemorySaver() });
    const last = defaultDirective("5v5-122-forecheck");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: "5v5-122-forecheck" },
      playbooks: { home: book, away: book },
    });
    const obs = observe(world, "home", { kind: "micro", reason: "zone_entry" });
    const names: string[] = [];
    const stream = await graph.stream(
      { observation: obs, epochReason: "zone_entry", epochKind: "micro", lastDirective: last },
      { streamMode: "updates", configurable: { thread_id: "match:skip:team:home:epoch:0" }, recursionLimit: 12 },
    );
    for await (const chunk of stream) {
      if (chunk && typeof chunk === "object") names.push(...Object.keys(chunk));
    }
    expect(names).not.toContain("head_coach");
    expect(names).not.toContain("captain");
    expect(names).toContain("assemble_directive");
    expect(kinds).not.toContain("coach");
    expect(kinds).not.toContain("fast");
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
