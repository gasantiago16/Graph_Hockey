import { describe, expect, it } from "vitest";
import { DEFAULT_PLAY_ID, type Play } from "../types/play.ts";
import { createWorld } from "../engine/world.ts";
import { defaultStructurePlay } from "./schema.ts";
import { loadPlaybook } from "./store.ts";
import { inferThemFamily, playStillValid, retrievePlays, toDigest } from "./retrieve.ts";

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
