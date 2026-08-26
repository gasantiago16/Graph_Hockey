import { describe, expect, it } from "vitest";
import { DEFAULT_PLAY_ID, type Play } from "../types/play.ts";
import { createWorld } from "../engine/world.ts";
import { defaultStructurePlay } from "./schema.ts";
import { loadPlaybook } from "./store.ts";
import {
  inferThemFamily,
  isEmptyNetPlay,
  isLeadProtectPlay,
  playStillValid,
  requiredScoreState,
  retrievePlays,
  toDigest,
} from "./retrieve.ts";

function play(partial: Partial<Play> & Pick<Play, "id" | "triggers" | "strength" | "zoneBias" | "status">): Play {
  return {
    name: partial.id,
    version: 1,
    family: "test",
    formation: { slots: {} },
    assignments: { shotPolicy: "hold" },
    counters: [],
    vulnerableTo: [],
    stats: { games: 0, xgFor: 0, xgAgainst: 0 },
    origin: "seed",
    ...partial,
  };
}

describe("playStillValid", () => {
  it("rejects retired plays", () => {
    const world = createWorld();
    const p = play({
      id: "x",
      status: "retired",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [],
    });
    expect(playStillValid(p, world, "home")).toBe(false);
  });

  it("rejects a 5v5 play when the side is on the PK", () => {
    const world = createWorld({ strength: "5v4" });
    const p = play({
      id: "ev",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [],
    });
    expect(playStillValid(p, world, "away")).toBe(false);
    expect(playStillValid(p, world, "home")).toBe(false);
  });

  it("uses zoneBias when triggers are empty", () => {
    const oz = createWorld({ puck: { pos: { x: 50, y: 0 } } });
    const dz = createWorld({ puck: { pos: { x: -50, y: 0 } } });
    const p = play({
      id: "oz-only",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["OZ"],
      triggers: [],
    });
    expect(playStillValid(p, oz, "home")).toBe(true);
    expect(playStillValid(p, dz, "home")).toBe(false);
    expect(playStillValid({ ...p, zoneBias: ["any"] }, dz, "home")).toBe(true);
  });

  it("requires every pred in all and at least one in any", () => {
    const world = createWorld({
      puck: { pos: { x: 50, y: 0 } },
      score: { home: 2, away: 1 },
      clockRemaining: 80,
    });
    const allPass = play({
      id: "all",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["OZ"],
      triggers: [
        {
          all: [
            { kind: "zone", eq: "OZ" },
            { kind: "score", eq: "leading" },
            { kind: "timeRemainingLt", seconds: 120 },
          ],
        },
      ],
    });
    expect(playStillValid(allPass, world, "home")).toBe(true);
    expect(playStillValid(allPass, world, "away")).toBe(false);

    const anyPass = play({
      id: "any",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [
        {
          any: [
            { kind: "zone", eq: "DZ" },
            { kind: "score", eq: "leading" },
          ],
        },
      ],
    });
    expect(playStillValid(anyPass, world, "home")).toBe(true);
    expect(
      playStillValid(
        play({
          id: "any-miss",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["any"],
          triggers: [{ any: [{ kind: "zone", eq: "DZ" }, { kind: "score", eq: "trailing" }] }],
        }),
        world,
        "home",
      ),
    ).toBe(false);
  });

  it("ORs trigger groups and honors afterEvent against lastEvents", () => {
    const world = createWorld({
      puck: { pos: { x: 0, y: 0 } },
      lastEvents: [
        {
          id: "m:0",
          seq: 0,
          liveTick: 1,
          stoppageSeq: 0,
          period: 1,
          type: "ZoneEntry",
          zone: "OZ",
        },
      ],
    });
    const p = play({
      id: "groups",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [
        { all: [{ kind: "zone", eq: "OZ" }] },
        { all: [{ kind: "afterEvent", type: "ZoneEntry" }] },
      ],
    });
    expect(playStillValid(p, world, "home")).toBe(true);
    expect(playStillValid(p, world, "home", [])).toBe(false);
  });

  it("maps 6v5 to EN and 3v3 to OT plays", () => {
    const en = createWorld({ strength: "6v5" });
    const ot = createWorld({ strength: "3v3", period: "OT" });
    const enPlay = play({
      id: "en",
      status: "active",
      strength: ["EN"],
      zoneBias: ["any"],
      triggers: [],
    });
    const otPlay = play({
      id: "ot",
      status: "active",
      strength: ["3v3"],
      zoneBias: ["any"],
      triggers: [],
    });
    expect(playStillValid(enPlay, en, "home")).toBe(true);
    expect(playStillValid(enPlay, en, "away")).toBe(false);
    expect(playStillValid(otPlay, ot, "home")).toBe(true);
  });
});

describe("retrievePlays", () => {
  it("drops retired plays, filters by zone/strength, ranks by net xG, caps at 6", () => {
    const book = {
      teamId: "t",
      version: 1,
      plays: [
        play({ id: "z-low", status: "active", strength: ["5v5"], zoneBias: ["OZ"], triggers: [], stats: { games: 1, xgFor: 0.2, xgAgainst: 0 } }),
        play({ id: "z-high", status: "active", strength: ["5v5"], zoneBias: ["OZ"], triggers: [], stats: { games: 1, xgFor: 1.4, xgAgainst: 0.1 } }),
        play({ id: "retired", status: "retired", strength: ["5v5"], zoneBias: ["OZ"], triggers: [], stats: { games: 3, xgFor: 9, xgAgainst: 0 } }),
        play({ id: "wrong-zone", status: "active", strength: ["5v5"], zoneBias: ["DZ"], triggers: [] }),
        play({ id: "pp-only", status: "active", strength: ["PP"], zoneBias: ["OZ"], triggers: [] }),
        play({ id: "any-ok", status: "active", strength: ["5v5"], zoneBias: ["any"], triggers: [], stats: { games: 1, xgFor: 0.5, xgAgainst: 0 } }),
      ],
    };
    const ids = retrievePlays(book, { strength: "5v5", zone: "OZ" }).map((d) => d.id);
    expect(ids).toEqual(["z-high", "any-ok", "z-low"]);
    expect(ids).not.toContain("retired");
    expect(ids).not.toContain("wrong-zone");
    expect(ids).not.toContain("pp-only");
  });

  it("ranks a play with real xG ahead of a 0-xG play even with more games", () => {
    const ids = retrievePlays(
      {
        teamId: "t",
        version: 1,
        plays: [
          play({
            id: "zero",
            status: "active",
            strength: ["5v5"],
            zoneBias: ["OZ"],
            triggers: [],
            stats: { games: 8, xgFor: 0, xgAgainst: 0 },
          }),
          play({
            id: "real",
            status: "active",
            strength: ["5v5"],
            zoneBias: ["OZ"],
            triggers: [],
            stats: { games: 1, xgFor: 0.4, xgAgainst: 0 },
          }),
        ],
      },
      { strength: "5v5", zone: "OZ" },
    ).map((d) => d.id);
    expect(ids[0]).toBe("real");
  });

  it("does not retrieve pull-early at 5v5 even when the seed still lists 5v5", () => {
    const expansion = loadPlaybook("expansion");
    const pull = expansion.plays.find((p) => p.id === "pull-early-template");
    expect(pull?.strength).toEqual(["EN"]);
    expect(isEmptyNetPlay(pull!)).toBe(true);
    const even = retrievePlays(expansion, { strength: "5v5", zone: "OZ", scoreState: "trailing" }).map((d) => d.id);
    expect(even).not.toContain("pull-early-template");
    expect(even).toContain("5v5-212-forecheck");
    const en = retrievePlays(expansion, { strength: "EN", zone: "OZ", scoreState: "trailing" }).map((d) => d.id);
    expect(en).toContain("pull-early-template");

    const poisoned = {
      ...expansion,
      plays: expansion.plays.map((p) =>
        p.id === "pull-early-template" ? { ...p, strength: ["EN", "5v5"] as typeof p.strength } : p,
      ),
    };
    expect(
      retrievePlays(poisoned, { strength: "5v5", zone: "OZ", scoreState: "trailing" }).map((d) => d.id),
    ).not.toContain("pull-early-template");
  });

  it("returns original-six OZ 5v5 candidates including 1-2-2", () => {
    const book = loadPlaybook("original-six");
    const ids = retrievePlays(book, { strength: "5v5", zone: "OZ" }).map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(6);
    expect(ids).toContain("5v5-122-forecheck");
    expect(ids).not.toContain(DEFAULT_PLAY_ID);
    expect(defaultStructurePlay().id).toBe(DEFAULT_PLAY_ID);
  });

  it("toDigest copies counters", () => {
    const p = play({
      id: "c",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [],
      counters: ["stretch-pass"],
    });
    expect(toDigest(p).counters).toEqual(["stretch-pass"]);
  });

  it("ranks a countering play above higher net xG when themFamily matches", () => {
    const book = {
      teamId: "t",
      version: 1,
      plays: [
        play({
          id: "z-high",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["OZ"],
          triggers: [],
          stats: { games: 1, xgFor: 0.4, xgAgainst: 0.1 },
        }),
        play({
          id: "z-counter",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["OZ"],
          triggers: [],
          counters: ["stretch-pass"],
          stats: { games: 1, xgFor: 0.1, xgAgainst: 0 },
        }),
      ],
    };
    expect(retrievePlays(book, { strength: "5v5", zone: "OZ" }).map((d) => d.id)).toEqual([
      "z-high",
      "z-counter",
    ]);
    expect(
      retrievePlays(book, { strength: "5v5", zone: "OZ", themFamily: "stretch-pass" }).map((d) => d.id),
    ).toEqual(["z-counter", "z-high"]);
  });

  it("inferThemFamily uses public geometry, never a playId field", () => {
    expect(
      inferThemFamily([
        { side: "them", position: "C", pos: { x: -30, y: 0 } },
        { side: "them", position: "LW", pos: { x: -28, y: 8 } },
        { side: "us", position: "C", pos: { x: 10, y: 0 } },
      ]),
    ).toBe("forecheck-212");
    expect(
      inferThemFamily([
        { side: "them", position: "C", pos: { x: -55, y: 0 } },
        { side: "them", position: "LW", pos: { x: -52, y: 6 } },
      ]),
    ).toBe("crash-net");
    expect(
      inferThemFamily([
        { side: "them", position: "C", pos: { x: -30, y: 0 } },
        { side: "them", position: "LW", pos: { x: 0, y: 8 } },
        { side: "them", position: "RW", pos: { x: 2, y: -8 } },
      ]),
    ).toBe("stretch-pass");
    expect(
      inferThemFamily([{ side: "them", position: "C", pos: { x: -30, y: 0 } }]),
    ).toBe("forecheck-122");
    expect(
      inferThemFamily([
        { side: "them", position: "C", pos: { x: 0, y: 0 } },
        { side: "them", position: "LW", pos: { x: 2, y: 8 } },
        { side: "them", position: "RW", pos: { x: 2, y: -8 } },
        { side: "them", position: "LD", pos: { x: -2, y: 10 } },
      ]),
    ).toBe("trap-122");
    expect(inferThemFamily([{ side: "them", position: "G", pos: { x: -80, y: 0 } }])).toBeUndefined();
  });

  it("AAR crash-net counter is the family inferThemFamily emits for a deep DZ look", () => {
    const book = {
      teamId: "t",
      version: 1,
      plays: [
        play({
          id: "plain",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["OZ"],
          triggers: [],
          stats: { games: 1, xgFor: 0.4, xgAgainst: 0.1 },
        }),
        play({
          id: "learned",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["OZ"],
          triggers: [],
          counters: ["crash-net"],
          stats: { games: 1, xgFor: 0.1, xgAgainst: 0 },
        }),
      ],
    };
    const themFamily = inferThemFamily([
      { side: "them", position: "C", pos: { x: -55, y: 0 } },
      { side: "them", position: "LW", pos: { x: -52, y: 4 } },
    ]);
    expect(themFamily).toBe("crash-net");
    expect(retrievePlays(book, { strength: "5v5", zone: "OZ", themFamily }).map((d) => d.id)[0]).toBe("learned");
  });
});

describe("isLeadProtectPlay", () => {
  it("matches family protect-113 or id prefix protect-lead, not trailing cousins", () => {
    expect(isLeadProtectPlay({ id: "protect-lead-1-1-3", family: "protect-113" })).toBe(true);
    expect(isLeadProtectPlay({ id: "protect-lead-late", family: "trap-122" })).toBe(true);
    expect(isLeadProtectPlay({ id: "sit-on-a-lead", family: "protect-113" })).toBe(true);
    expect(isLeadProtectPlay({ id: "trail-push-1-1-3", family: "chase-113" })).toBe(false);
    expect(isLeadProtectPlay({ id: "5v5-122-forecheck", family: "forecheck-122" })).toBe(false);
  });
});

describe("requiredScoreState", () => {
  it("locks when all or pure-any score.eq agree; mixed any / score-free / disagree are not locked", () => {
    expect(
      requiredScoreState(
        play({
          id: "all-lead",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["any"],
          triggers: [{ all: [{ kind: "score", eq: "leading" }] }],
        }),
      ),
    ).toBe("leading");
    expect(
      requiredScoreState(
        play({
          id: "pure-any-lead",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["any"],
          triggers: [{ any: [{ kind: "score", eq: "leading" }] }],
        }),
      ),
    ).toBe("leading");
    expect(
      requiredScoreState(
        play({
          id: "any-lead",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["any"],
          triggers: [{ any: [{ kind: "score", eq: "leading" }, { kind: "zone", eq: "NZ" }] }],
        }),
      ),
    ).toBeUndefined();
    expect(
      requiredScoreState(
        play({
          id: "disagree",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["any"],
          triggers: [
            { all: [{ kind: "score", eq: "leading" }] },
            { all: [{ kind: "score", eq: "trailing" }] },
          ],
        }),
      ),
    ).toBeUndefined();
    expect(
      requiredScoreState(
        play({
          id: "mixed-any",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["any"],
          triggers: [{ any: [{ kind: "score", eq: "leading" }, { kind: "score", eq: "trailing" }] }],
        }),
      ),
    ).toBeUndefined();
    expect(
      requiredScoreState(
        play({
          id: "score-free",
          status: "active",
          strength: ["5v5"],
          zoneBias: ["any"],
          triggers: [{ all: [{ kind: "zone", eq: "NZ" }] }],
        }),
      ),
    ).toBeUndefined();
  });
});

describe("retrievePlays lead-protect gate", () => {
  const seed = () => loadPlaybook("original-six");

  function ids(scoreState?: "leading" | "tied" | "trailing", zone: "NZ" | "OZ" | "DZ" = "NZ") {
    return retrievePlays(seed(), { strength: "5v5", zone, scoreState }).map((d) => d.id);
  }

  it("excludes protect-lead-1-1-3 unless scoreState is leading", () => {
    expect(ids("trailing")).not.toContain("protect-lead-1-1-3");
    expect(ids("tied")).not.toContain("protect-lead-1-1-3");
    expect(ids(undefined)).not.toContain("protect-lead-1-1-3");
    expect(ids("leading")).toContain("protect-lead-1-1-3");
  });

  it("OZ leading retrieve does not contain protect-lead-1-1-3; DZ leading still can", () => {
    expect(ids("leading", "OZ")).not.toContain("protect-lead-1-1-3");
    expect(ids("leading", "DZ")).toContain("protect-lead-1-1-3");
  });

  it("family/id still excludes when score lives in any or a group is score-free", () => {
    const base = play({
      id: "protect-lead-any",
      family: "protect-113",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [
        { any: [{ kind: "score", eq: "leading" }, { kind: "zone", eq: "NZ" }] },
        { all: [{ kind: "strength", eq: "5v5" }] },
      ],
      stats: { games: 1, xgFor: 2, xgAgainst: 0 },
    });
    const book = { teamId: "t", version: 1, plays: [base] };
    expect(requiredScoreState(base)).toBeUndefined();
    for (const scoreState of [undefined, "tied", "trailing"] as const) {
      expect(retrievePlays(book, { strength: "5v5", zone: "NZ", scoreState }).map((d) => d.id)).not.toContain(
        "protect-lead-any",
      );
    }
    expect(retrievePlays(book, { strength: "5v5", zone: "NZ", scoreState: "leading" }).map((d) => d.id)).toContain(
      "protect-lead-any",
    );

    const cousin = play({
      id: "trail-push-1-1-3",
      family: "chase-113",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [{ all: [{ kind: "score", eq: "trailing" }] }],
    });
    expect(isLeadProtectPlay(cousin)).toBe(false);
    expect(
      retrievePlays({ teamId: "t", version: 1, plays: [cousin] }, { strength: "5v5", zone: "NZ", scoreState: "trailing" }).map(
        (d) => d.id,
      ),
    ).toContain("trail-push-1-1-3");
  });

  it("protect-113 with score.eq trailing retrieves for neither leading nor trailing", () => {
    const row = play({
      id: "protect-lead-trail-tweak",
      family: "protect-113",
      status: "active",
      strength: ["5v5"],
      zoneBias: ["any"],
      triggers: [{ all: [{ kind: "score", eq: "trailing" }] }],
    });
    expect(isLeadProtectPlay(row)).toBe(true);
    expect(requiredScoreState(row)).toBe("trailing");
    const book = { teamId: "t", version: 1, plays: [row] };
    expect(retrievePlays(book, { strength: "5v5", zone: "NZ", scoreState: "leading" }).map((d) => d.id)).not.toContain(
      row.id,
    );
    expect(retrievePlays(book, { strength: "5v5", zone: "NZ", scoreState: "trailing" }).map((d) => d.id)).not.toContain(
      row.id,
    );
  });

  it("trailing retrieve drops protect-lead even with ser-emp-7 after-g4 net xG", () => {
    // original-six v6 after-game-4: 1-2-2 net +0.018 vs protect-lead net +0.096
    const book = {
      ...seed(),
      plays: seed().plays.map((p) => {
        if (p.id === "5v5-122-forecheck") {
          return { ...p, stats: { games: 5, xgFor: 1.1036971959752557, xgAgainst: 1.0855651089157887 } };
        }
        if (p.id === "protect-lead-1-1-3") {
          return { ...p, stats: { games: 3, xgFor: 0.24176167635919105, xgAgainst: 0.14546602452306692 } };
        }
        return p;
      }),
    };
    const forecheck = book.plays.find((p) => p.id === "5v5-122-forecheck")!;
    const protect = book.plays.find((p) => p.id === "protect-lead-1-1-3")!;
    expect(forecheck.stats.xgFor - forecheck.stats.xgAgainst).toBeCloseTo(0.018, 3);
    expect(protect.stats.xgFor - protect.stats.xgAgainst).toBeCloseTo(0.096, 3);
    const trailing = retrievePlays(book, { strength: "5v5", zone: "OZ", scoreState: "trailing" }).map((d) => d.id);
    expect(trailing[0]).toBe("5v5-122-forecheck");
    expect(trailing).not.toContain("protect-lead-1-1-3");
    const omitted = retrievePlays(book, { strength: "5v5", zone: "OZ" }).map((d) => d.id);
    expect(omitted[0]).toBe("5v5-122-forecheck");
    expect(omitted).not.toContain("protect-lead-1-1-3");
    const leadingOz = retrievePlays(book, { strength: "5v5", zone: "OZ", scoreState: "leading" }).map((d) => d.id);
    expect(leadingOz).not.toContain("protect-lead-1-1-3");
    const leadingDz = retrievePlays(book, { strength: "5v5", zone: "DZ", scoreState: "leading" }).map((d) => d.id);
    expect(leadingDz[0]).toBe("protect-lead-1-1-3");
  });
});
