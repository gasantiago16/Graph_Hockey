import { describe, expect, it } from "vitest";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { playStillValid } from "../playbook/retrieve.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { BLUE_LINE_X } from "./rink.ts";
import { createRng } from "./rng.ts";
import { advanceWorld } from "./step.ts";
import { playForSide, softmax, steeringTarget, UTILITY_TEMPERATURE } from "./tactics.ts";
import { createWorld, defaultDirective, DEFAULT_SLOTS, findBySlot } from "./world.ts";

describe("1-2-2 tactics", () => {
  it("places home F in OZ when home attacks +X and the puck is in OZ", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      attackingDir: { home: 1, away: -1 },
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      puck: { pos: { x: 55, y: 8 }, vel: { x: 0, y: 0 }, possessor: null },
    });
    expect(world.attackingDir.home).toBe(1);
    expect(world.puck.pos.x).toBeGreaterThan(BLUE_LINE_X);

    const play = playForSide(world, "home");
    expect(play.id).toBe("5v5-122-forecheck");
    expect(play.assignments.forecheck).toBe("1-2-2");
    expect(playStillValid(play, world, "home")).toBe(true);

    for (const pos of ["C", "LW", "RW"] as const) {
      const body = findBySlot(world, "home", pos);
      expect(body, pos).toBeTruthy();
      const target = steeringTarget(world, body!);
      expect(target.x, `${pos} target x=${target.x}`).toBeGreaterThan(BLUE_LINE_X);
    }
  });

  it("skates home F into OZ from NZ starts under 1-2-2", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      attackingDir: { home: 1, away: -1 },
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      onIce: { home: ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-G"], away: ["a-G"] },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } },
        "h-LW": { pos: { x: 0, y: 20 }, vel: { x: 0, y: 0 } },
        "h-RW": { pos: { x: 0, y: -20 }, vel: { x: 0, y: 0 } },
      },
      puck: { pos: { x: 60, y: 4 }, vel: { x: 0, y: 0 }, possessor: null },
    });
    const dirs = {
      home: defaultDirective("5v5-122-forecheck"),
      away: defaultDirective(DEFAULT_PLAY_ID),
    };
    const rng = createRng(7);
    for (let i = 0; i < 80; i++) {
      advanceWorld(world, dirs, rng);
    }
    for (const pos of ["C", "LW", "RW"] as const) {
      const body = findBySlot(world, "home", pos);
      expect(body!.pos.x, `${pos} x=${body!.pos.x}`).toBeGreaterThan(BLUE_LINE_X);
    }
  });

  it("mirrors 1-2-2 F into away OZ when away attacks -X", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      attackingDir: { home: 1, away: -1 },
      playId: { home: DEFAULT_PLAY_ID, away: "5v5-122-forecheck" },
      playbooks: { home: book, away: book },
      puck: { pos: { x: -55, y: 6 }, vel: { x: 0, y: 0 }, possessor: null },
    });
    for (const pos of ["C", "LW", "RW"] as const) {
      const body = findBySlot(world, "away", pos);
      const target = steeringTarget(world, body!);
      expect(target.x, `${pos} target x=${target.x}`).toBeLessThan(-BLUE_LINE_X);
    }
  });
});

describe("default-structure slots", () => {
  it("keeps PR3 attacking-frame slots for non-goalie skaters", () => {
    const world = createWorld({
      playId: { home: DEFAULT_PLAY_ID, away: DEFAULT_PLAY_ID },
      puck: { pos: { x: 0, y: 0 }, possessor: null },
    });
    for (const pos of ["C", "LW", "RW", "LD", "RD"] as const) {
      const body = findBySlot(world, "home", pos);
      const target = steeringTarget(world, body!);
      expect(target.x).toBeCloseTo(DEFAULT_SLOTS[pos].x, 5);
      expect(target.y).toBeCloseTo(DEFAULT_SLOTS[pos].y, 5);
    }
  });
});

describe("softmax utilities", () => {
  it("uses temperature 0.15 and sums to 1", () => {
    expect(UTILITY_TEMPERATURE).toBe(0.15);
    const w = softmax([1, 2, 3]);
    const sum = w.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(w[2]).toBeGreaterThan(w[1]!);
    expect(w[1]).toBeGreaterThan(w[0]!);
  });
});
