import { describe, expect, it } from "vitest";
import { defaultDirective } from "../engine/world.ts";
import { createBudget } from "../llm/budgets.ts";
import { MAX_CALLS_PER_TEAM, recordLlmUsage } from "../llm/budgets.ts";
import type { TeamObservation } from "../types/observation.ts";
import { epochThreadId, invokeTeam, type InvokableTeamGraph } from "./invokeTeam.ts";

const last = defaultDirective();

const obs = {
  matchId: "m",
  epochReason: "faceoff",
  epochKind: "macro",
  period: 1,
  clock: 5,
  score: { us: 0, them: 0 },
  strength: "5v5",
  zone: "NZ",
  phase: "live",
  whistle: null,
  puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
  players: [],
  lastEvents: [],
  zoneTime: { usOZ: 0, themOZ: 0, nz: 0 },
  onIce: { us: [], them: [] },
  penalties: { us: [], them: [] },
  timeoutLeft: { us: true, them: true },
  goalieInNet: { us: true, them: true },
  activePlay: { id: "default-structure", name: "Default structure", version: 1 },
  lastDirective: last,
  bench: { fatigue: {} },
  playbookDigest: [],
  scoutNotes: [],
  ourAssignments: [],
} as TeamObservation;

describe("invokeTeam", () => {
  it("never throws on graph errors and returns last directive", async () => {
    const graph: InvokableTeamGraph = {
      invoke: async () => {
        throw new Error("boom");
      },
    };
    const r = await invokeTeam({
      graph,
      side: "home",
      obs,
      last,
      epochIndex: 3,
      matchId: "m",
      budget: createBudget(),
      timeoutMs: 50,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("error");
    expect(r.directive).toEqual(last);
    expect(r.threadId).toBe(epochThreadId("m", "home", 3));
  });

  it("times out via AbortController and does not throw", async () => {
    const graph: InvokableTeamGraph = {
      invoke: async (_input, config) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    };
    const r = await invokeTeam({
      graph,
      side: "away",
      obs,
      last,
      epochIndex: 0,
      matchId: "m",
      budget: createBudget(),
      timeoutMs: 20,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
    expect(r.directive).toEqual(last);
  });

  it("returns circuit for a tripped team without invoking", async () => {
    const budget = createBudget();
    recordLlmUsage(budget, "home", {
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      usd: 0,
      calls: MAX_CALLS_PER_TEAM,
    });
    let called = 0;
    const graph: InvokableTeamGraph = {
      invoke: async () => {
        called += 1;
        return { directive: last };
      },
    };
    const home = await invokeTeam({
      graph,
      side: "home",
      obs,
      last,
      epochIndex: 1,
      matchId: "m",
      budget,
      timeoutMs: 50,
    });
    const away = await invokeTeam({
      graph,
      side: "away",
      obs,
      last,
      epochIndex: 1,
      matchId: "m",
      budget,
      timeoutMs: 50,
    });
    expect(home.ok).toBe(false);
    if (!home.ok) expect(home.reason).toBe("circuit");
    expect(away.ok).toBe(true);
    expect(called).toBe(1);
  });

  it("records per-epoch thread_id", async () => {
    const seen: string[] = [];
    const graph: InvokableTeamGraph = {
      invoke: async (_input, config) => {
        seen.push(String(config?.configurable?.thread_id));
        return { directive: { playId: "5v5-122-forecheck", pressure: "neutral" } };
      },
    };
    const r = await invokeTeam({
      graph,
      side: "home",
      obs,
      last,
      epochIndex: 7,
      matchId: "abc",
      budget: createBudget(),
      timeoutMs: 50,
    });
    expect(r.ok).toBe(true);
    expect(seen).toEqual(["match:abc:team:home:epoch:7"]);
  });
});
