import { describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { defaultDirective } from "../engine/world.ts";
import { loadPlaybook } from "../playbook/store.ts";
import type { TeamObservation } from "../types/observation.ts";
import { clampDirective } from "./nodes/validateDirective.ts";
import { compileTeamGraph, STUB_TEAM_NODES } from "./teamGraph.ts";

const last = defaultDirective();

function obs(over: Partial<TeamObservation> = {}): TeamObservation {
  return {
    matchId: "m",
    epochReason: "period_start",
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
    ...over,
  };
}

describe("compileTeamGraph stub", () => {
  it("compiles START→ingest→assemble_directive→validate_directive without head_coach", () => {
    const home = compileTeamGraph({
      side: "home",
      playbook: loadPlaybook("original-six"),
      checkpointer: new MemorySaver(),
    });
    const names = Object.keys(home.nodes);
    for (const n of STUB_TEAM_NODES) {
      expect(names).toContain(n);
    }
    expect(names).not.toContain("head_coach");
    expect(names).not.toContain("oc");
  });

  it("uses private seed defaults: original-six 1-2-2 vs expansion 2-1-2", async () => {
    const homeBook = loadPlaybook("original-six");
    const awayBook = loadPlaybook("expansion");
    const home = compileTeamGraph({ side: "home", playbook: homeBook, checkpointer: new MemorySaver() });
    const away = compileTeamGraph({ side: "away", playbook: awayBook, checkpointer: new MemorySaver() });
    const input = {
      observation: obs(),
      epochReason: "period_start" as const,
      epochKind: "macro" as const,
      lastDirective: last,
    };
    const h = (await home.invoke(input, { configurable: { thread_id: "match:m:team:home:epoch:0" } })) as {
      directive?: { playId: string };
    };
    const a = (await away.invoke(input, { configurable: { thread_id: "match:m:team:away:epoch:0" } })) as {
      directive?: { playId: string };
    };
    expect(h.directive?.playId).toBe("5v5-122-forecheck");
    expect(a.directive?.playId).toBe("5v5-212-forecheck");
  });

  it("keeps last pressure and selects the seed default play", async () => {
    const graph = compileTeamGraph({
      side: "home",
      playbook: loadPlaybook("original-six"),
      checkpointer: new MemorySaver(),
    });
    const out = (await graph.invoke(
      {
        observation: obs(),
        epochReason: "faceoff",
        epochKind: "macro",
        lastDirective: { playId: "not-a-real-play", pressure: "aggressive" },
      },
      { configurable: { thread_id: "match:m:team:home:epoch:1" } },
    )) as { directive?: { playId: string; pressure: string } };
    expect(out.directive?.playId).toBe("5v5-122-forecheck");
    expect(out.directive?.pressure).toBe("aggressive");
  });

  it("clamps unknown playId to default-structure", () => {
    const book = loadPlaybook("original-six");
    const { directive, errors } = clampDirective(
      { playId: "not-a-real-play", pressure: "neutral" },
      book,
      last,
    );
    expect(directive.playId).toBe("default-structure");
    expect(errors.length).toBeGreaterThan(0);
  });
});
