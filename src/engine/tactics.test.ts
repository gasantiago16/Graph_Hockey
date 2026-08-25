import { describe, expect, it } from "vitest";
import { computeIceIntent } from "../ice/roles.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { playStillValid } from "../playbook/retrieve.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { BLUE_LINE_X, GOAL_LINE_X } from "./rink.ts";
import { createRng } from "./rng.ts";
import { advanceWorld } from "./step.ts";
import {
  maybeReleasePuck,
  nearestSkaterToPuck,
  passReceiver,
  playForSide,
  softmax,
  steeringTarget,
  UTILITY_TEMPERATURE,
} from "./tactics.ts";
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
  it("keeps PR3 attacking-frame slots for off-puck skaters", () => {
    const world = createWorld({
      playId: { home: DEFAULT_PLAY_ID, away: DEFAULT_PLAY_ID },
      puck: { pos: { x: 8, y: 0 }, possessor: "h-C" },
    });
    for (const pos of ["LW", "RW", "LD", "RD"] as const) {
      const body = findBySlot(world, "home", pos);
      const target = steeringTarget(world, body!);
      expect(target.x).toBeCloseTo(DEFAULT_SLOTS[pos].x, 5);
      expect(target.y).toBeCloseTo(DEFAULT_SLOTS[pos].y, 5);
    }
  });
});

describe("puck awareness", () => {
  it("nearest skater hunts a loose puck; others stay in structure", () => {
    const world = createWorld({
      puck: { pos: { x: 40, y: 0 }, possessor: null },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 } },
        "h-LW": { pos: { x: 30, y: 0 } },
        "h-RW": { pos: { x: 0, y: 20 } },
      },
    });
    const hunter = nearestSkaterToPuck(world, "home");
    expect(hunter?.id).toBe("h-LW");
    const lw = findBySlot(world, "home", "LW")!;
    const c = findBySlot(world, "home", "C")!;
    expect(steeringTarget(world, lw)).toMatchObject({ x: 40, y: 0 });
    const cTarget = steeringTarget(world, c);
    expect(Math.hypot(cTarget.x - 40, cTarget.y)).toBeGreaterThan(10);
  });

  it("does not hunt a loose puck sitting in our crease (goalie)", () => {
    const netX = -GOAL_LINE_X;
    const world = createWorld({
      puck: { pos: { x: netX + 2, y: 0 }, possessor: null },
      bodies: {
        "h-LD": { pos: { x: netX + 12, y: 8 } },
        "h-C": { pos: { x: 0, y: 0 } },
      },
    });
    const ld = findBySlot(world, "home", "LD")!;
    const target = steeringTarget(world, ld);
    expect(Math.hypot(target.x - (netX + 2), target.y)).toBeGreaterThan(6);
  });

  it("carrier in our crease is steered out to the hash, not through the net", () => {
    const netX = -GOAL_LINE_X;
    const world = createWorld({
      puck: { pos: { x: netX + 2, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: netX + 2, y: 0 }, heading: Math.PI } },
    });
    const c = findBySlot(world, "home", "C")!;
    const target = steeringTarget(world, c);
    expect(target.x).toBeGreaterThan(netX + 8);
    expect(Math.abs(target.y)).toBeGreaterThan(10);
  });

  it("nearest defender pressures the opponent puck-carrier", () => {
    const world = createWorld({
      puck: { pos: { x: 20, y: 0 }, possessor: "a-C" },
      bodies: {
        "a-C": { pos: { x: 20, y: 0 } },
        "h-C": { pos: { x: 0, y: 0 } },
        "h-LW": { pos: { x: 12, y: 4 } },
      },
    });
    const hunter = nearestSkaterToPuck(world, "home");
    expect(hunter?.id).toBe("h-LW");
    const lw = findBySlot(world, "home", "LW")!;
    expect(steeringTarget(world, lw)).toMatchObject({ x: 20, y: 0 });
  });
});

describe("pass / shoot release", () => {
  it("pass policy steers the carrier at a teammate, not the net", () => {
    const book = loadPlaybook("expansion");
    const world = createWorld({
      playId: { home: "stretch-pass-nz", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      directives: {
        home: { playId: "stretch-pass-nz", pressure: "neutral", playParams: { shotPolicy: "pass" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 0, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 }, heading: 0 },
        "h-LW": { pos: { x: 22, y: 10 }, heading: 0 },
      },
    });
    const c = findBySlot(world, "home", "C")!;
    const lw = passReceiver(world, c);
    expect(lw?.id).toBe("h-LW");
    const target = steeringTarget(world, c);
    expect(Math.hypot(target.x - 22, target.y - 10)).toBeLessThan(0.01);
    expect(Math.hypot(target.x - GOAL_LINE_X, target.y)).toBeGreaterThan(50);
  });

  it("dump policy still aims a corner", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      puck: { pos: { x: 10, y: 8 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 10, y: 8 }, heading: 0 } },
    });
    const c = findBySlot(world, "home", "C")!;
    const target = steeringTarget(world, c);
    expect(target.x).toBeGreaterThan(BLUE_LINE_X);
    expect(Math.abs(target.y)).toBeGreaterThan(20);
    expect(maybeReleasePuck(world)).toBe(false);
    expect(world.puck.possessor).toBe("h-C");
  });

  it("shoot release in OZ emits a Shot with xG", () => {
    const book = loadPlaybook("expansion");
    const world = createWorld({
      playId: { home: "5v5-212-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      directives: {
        home: { playId: "5v5-212-forecheck", pressure: "aggressive", playParams: { shotPolicy: "shoot" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 50, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 50, y: 0 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    const rng = createRng(3);
    let sawShot = false;
    for (let i = 0; i < 40; i++) {
      const ev = advanceWorld(world, world.directives, rng);
      if (ev.some((e) => e.type === "Shot")) {
        sawShot = true;
        const shot = ev.find((e) => e.type === "Shot");
        expect(shot?.xG).toBeGreaterThanOrEqual(0.01);
        expect(shot?.xG).toBeLessThanOrEqual(0.95);
        break;
      }
    }
    expect(sawShot).toBe(true);
  });

  it("ice F1 shoot in OZ releases a Shot without a coach overlay (seed dump)", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      puck: { pos: { x: 50, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 50, y: 0 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    const rng = createRng(3);
    let sawShot = false;
    for (let i = 0; i < 40; i++) {
      const ev = advanceWorld(world, world.directives, rng);
      if (ev.some((e) => e.type === "Shot")) {
        sawShot = true;
        const shot = ev.find((e) => e.type === "Shot");
        expect(shot?.xG).toBeGreaterThanOrEqual(0.01);
        break;
      }
    }
    expect(sawShot).toBe(true);
  });

  it("pass release does not emit a Shot", () => {
    const book = loadPlaybook("expansion");
    const world = createWorld({
      playId: { home: "stretch-pass-nz", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      directives: {
        home: { playId: "stretch-pass-nz", pressure: "neutral", playParams: { shotPolicy: "pass" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 0, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 }, heading: Math.atan2(10, 22), vel: { x: 0, y: 0 } },
        "h-LW": { pos: { x: 22, y: 10 }, heading: 0 },
      },
    });
    const rng = createRng(3);
    let released = false;
    for (let i = 0; i < 40; i++) {
      const ev = advanceWorld(world, world.directives, rng);
      expect(ev.some((e) => e.type === "Shot")).toBe(false);
      if (world.puck.possessor === null) {
        released = true;
        break;
      }
    }
    expect(released).toBe(true);
  });

  it("coach dump overlay does not release even when ice would shoot", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      directives: {
        home: { playId: "5v5-122-forecheck", pressure: "neutral", playParams: { shotPolicy: "dump" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 50, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 50, y: 0 }, heading: 0 } },
    });
    world.iceIntents = {
      home: computeIceIntent(world, "home"),
      away: computeIceIntent(world, "away"),
    };
    expect(world.iceIntents.home.f1Action).toBe("shoot");
    expect(maybeReleasePuck(world)).toBe(false);
    expect(world.puck.possessor).toBe("h-C");
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
