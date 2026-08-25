import { describe, expect, it } from "vitest";
import { EXPANSION_PLAY_IDS, ORIGINAL_SIX_PLAY_IDS, defaultStructurePlay } from "./schema.ts";
import { loadPlaybook, loadTeam, SEED_TEAM_IDS } from "./store.ts";

function rosterCounts(teamId: string) {
  const team = loadTeam(teamId);
  const forwards = team.players.filter((p) => p.position === "C" || p.position === "LW" || p.position === "RW");
  const defense = team.players.filter((p) => p.position === "LD" || p.position === "RD");
  const goalies = team.players.filter((p) => p.position === "G");
  return { team, forwards, defense, goalies };
}

describe("seed playbooks", () => {
  it("parses original-six with the DESIGN §12 play ids", () => {
    const book = loadPlaybook("original-six");
    expect(book.teamId).toBe("original-six");
    expect(book.version).toBe(1);
    expect(book.plays.map((p) => p.id)).toEqual([...ORIGINAL_SIX_PLAY_IDS]);
    expect(book.plays.every((p) => p.origin === "seed" && p.status === "active")).toBe(true);
    expect(book.plays.some((p) => p.id === "ot-3v3-2-1-spread" && p.strength.includes("3v3"))).toBe(true);
  });

  it("parses expansion with the DESIGN §12 play ids", () => {
    const book = loadPlaybook("expansion");
    expect(book.teamId).toBe("expansion");
    expect(book.plays.map((p) => p.id)).toEqual([...EXPANSION_PLAY_IDS]);
    expect(book.plays.some((p) => p.id === "ot-3v3-aggressive-forecheck" && p.strength.includes("3v3"))).toBe(true);
  });

  it("keeps default-structure as a code fallback, not a seed row", () => {
    const def = defaultStructurePlay();
    expect(def.id).toBe("default-structure");
    for (const id of SEED_TEAM_IDS) {
      expect(loadPlaybook(id).plays.some((p) => p.id === def.id)).toBe(false);
    }
  });
});

describe("seed rosters", () => {
  it("original-six is 12 F + 6 D + 2 G with unique numbers", () => {
    const { team, forwards, defense, goalies } = rosterCounts("original-six");
    expect(team.teamId).toBe("original-six");
    expect(team.players).toHaveLength(20);
    expect(forwards).toHaveLength(12);
    expect(defense).toHaveLength(6);
    expect(goalies).toHaveLength(2);
    expect(new Set(team.players.map((p) => p.number)).size).toBe(20);
    expect(goalies.every((g) => g.attributes.reboundControl !== undefined && g.attributes.tracking !== undefined)).toBe(
      true,
    );
  });

  it("expansion is 12 F + 6 D + 2 G with unique numbers", () => {
    const { team, forwards, defense, goalies } = rosterCounts("expansion");
    expect(team.teamId).toBe("expansion");
    expect(team.players).toHaveLength(20);
    expect(forwards).toHaveLength(12);
    expect(defense).toHaveLength(6);
    expect(goalies).toHaveLength(2);
    expect(new Set(team.players.map((p) => p.number)).size).toBe(20);
    const lines = new Set(team.players.map((p) => p.line));
    expect(lines).toEqual(new Set(["F1", "F2", "F3", "F4", "D1", "D2", "D3", "G1", "G2"]));
  });
});
