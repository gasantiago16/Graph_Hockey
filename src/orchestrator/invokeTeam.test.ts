import { describe, expect, it } from "vitest";
import { defaultDirective } from "../engine/world.ts";
import { createBudget } from "../llm/budgets.ts";
import { MAX_CALLS_PER_TEAM, recordLlmUsage } from "../llm/budgets.ts";
import { defaultPlayIdForBook, loadPlaybook } from "../playbook/store.ts";
import type { TeamDirective } from "../types/directive.ts";
import type { TeamObservation } from "../types/observation.ts";
import { epochThreadId, invokeTeam, timeoutDirective, type InvokableTeamGraph } from "./invokeTeam.ts";

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

  it("timeout on default-structure uses seedPlayId", async () => {
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
      side: "home",
      obs,
      last,
      epochIndex: 0,
      matchId: "m",
      budget: createBudget(),
      timeoutMs: 20,
      seedPlayId: "5v5-122-forecheck",
    });
    expect(r.ok).toBe(false);
    expect(r.directive.playId).toBe("5v5-122-forecheck");
    expect(timeoutDirective(last, "5v5-212-forecheck").playId).toBe("5v5-212-forecheck");
  });

  it("timeout strips overlay playParams so ice F1 can shoot", () => {
    const sticky = {
      playId: "5v5-122-forecheck",
      pressure: "neutral" as const,
      playParams: { shotPolicy: "pass" as const },
    };
    const stripped = timeoutDirective(sticky);
    expect(stripped.playId).toBe("5v5-122-forecheck");
    expect(stripped.playParams).toBeUndefined();
    expect(timeoutDirective(last).playParams).toBeUndefined();
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

  it("home 8s abort does not reject the away invoke", async () => {
    const home: InvokableTeamGraph = {
      invoke: async (_input, config) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    };
    let awayCalled = 0;
    const away: InvokableTeamGraph = {
      invoke: async () => {
        awayCalled += 1;
        return { directive: { playId: "5v5-212-forecheck", pressure: "neutral" } };
      },
    };
    const budget = createBudget();
    const [h, a] = await Promise.all([
      invokeTeam({ graph: home, side: "home", obs, last, epochIndex: 0, matchId: "m", budget, timeoutMs: 20 }),
      invokeTeam({ graph: away, side: "away", obs, last, epochIndex: 0, matchId: "m", budget, timeoutMs: 8000 }),
    ]);
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.reason).toBe("timeout");
    expect(a.ok).toBe(true);
    expect(awayCalled).toBe(1);
  });

  it("passes epochKind micro as a top-level invoke field", async () => {
    const seen: string[] = [];
    const graph: InvokableTeamGraph = {
      invoke: async (input) => {
        seen.push(input.epochKind);
        return { directive: last };
      },
    };
    const microObs: TeamObservation = { ...obs, epochKind: "micro", epochReason: "zone_entry" };
    await invokeTeam({
      graph,
      side: "home",
      obs: microObs,
      last,
      epochIndex: 0,
      matchId: "m",
      budget: createBudget(),
      timeoutMs: 50,
    });
    expect(seen).toEqual(["micro"]);
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

describe("invokeTeam drops lead-protect last when not leading", () => {
  const book = loadPlaybook("original-six");
  const protectLast: TeamDirective = { playId: "protect-lead-1-1-3", pressure: "passive" };
  const trailingObs: TeamObservation = { ...obs, score: { us: 0, them: 1 } };
  const leadingObs: TeamObservation = { ...obs, score: { us: 2, them: 1 } };
  const timeoutOpts = { obs: trailingObs, playbook: book };

  function abortingGraph(): InvokableTeamGraph {
    return {
      invoke: async (_input, config) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    };
  }

  it("trailing obs + last protect-lead-1-1-3 + seed 5v5-122-forecheck → 122", () => {
    expect(
      timeoutDirective(protectLast, "5v5-122-forecheck", timeoutOpts).playId,
    ).toBe("5v5-122-forecheck");
  });

  it("minted id with family protect-113 also drops", () => {
    const seedProtect = book.plays.find((p) => p.id === "protect-lead-1-1-3");
    expect(seedProtect).toBeDefined();
    const mintedBook = {
      ...book,
      plays: [...book.plays, { ...seedProtect!, id: "sit-on-a-lead", origin: "minted" as const }],
    };
    const mintedLast: TeamDirective = { playId: "sit-on-a-lead", pressure: "passive" };
    expect(
      timeoutDirective(mintedLast, "5v5-122-forecheck", { obs: trailingObs, playbook: mintedBook }).playId,
    ).toBe("5v5-122-forecheck");
  });

  it("leading obs keeps last", () => {
    expect(timeoutDirective(protectLast, "5v5-122-forecheck", { obs: leadingObs, playbook: book })).toEqual(
      protectLast,
    );
  });

  it("missing seed → defaultPlayIdForBook (no throw)", () => {
    expect(() => timeoutDirective(protectLast, undefined, timeoutOpts)).not.toThrow();
    expect(timeoutDirective(protectLast, undefined, timeoutOpts).playId).toBe(defaultPlayIdForBook(book));
    expect(defaultPlayIdForBook(book)).toBe("5v5-122-forecheck");
  });

  it("timeout path drops protect-lead when trailing", async () => {
    const r = await invokeTeam({
      graph: abortingGraph(),
      side: "home",
      obs: trailingObs,
      last: protectLast,
      epochIndex: 0,
      matchId: "m",
      budget: createBudget(),
      timeoutMs: 20,
      seedPlayId: "5v5-122-forecheck",
      playbook: book,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
    expect(r.directive.playId).toBe("5v5-122-forecheck");
  });

  it("circuit path drops protect-lead when trailing", async () => {
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
        return { directive: protectLast };
      },
    };
    const r = await invokeTeam({
      graph,
      side: "home",
      obs: trailingObs,
      last: protectLast,
      epochIndex: 1,
      matchId: "m",
      budget,
      timeoutMs: 50,
      seedPlayId: "5v5-122-forecheck",
      playbook: book,
    });
    expect(called).toBe(0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("circuit");
    expect(r.directive.playId).toBe("5v5-122-forecheck");
  });
});
