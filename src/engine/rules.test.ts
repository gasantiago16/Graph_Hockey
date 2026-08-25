import { describe, expect, it } from "vitest";
import type { PlayerAttributes } from "../types/hockey.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import {
  applyLiveRules,
  captureSnapshot,
  FACEOFF_PUCK_OFFSET,
  faceoffSpotFor,
  faceoffWinProbability,
  ICING_RACE_TICKS,
  isShorthanded,
  pickFaceoffWinner,
  puckInNet,
} from "./rules.ts";
import { createRng } from "./rng.ts";
import { END_ZONE_FACEOFF_X, GOAL_LINE_X, HASH_OFFSET_Y, NZ_FACEOFF_X } from "./rink.ts";
import { advanceWorld } from "./step.ts";
import { createWorld, defaultDirective } from "./world.ts";

const dirs = {
  home: defaultDirective(DEFAULT_PLAY_ID),
  away: defaultDirective(DEFAULT_PLAY_ID),
};

function attrs(over: Partial<PlayerAttributes> = {}): PlayerAttributes {
  return {
    speed: 50,
    accel: 50,
    agility: 50,
    shooting: 50,
    passing: 50,
    faceoff: 50,
    defense: 50,
    physical: 50,
    vision: 50,
    discipline: 50,
    stamina: 50,
    ...over,
  };
}

function farBodies() {
  return {
    "h-C": { pos: { x: 0, y: 30 }, vel: { x: 0, y: 0 }, heading: Math.PI },
    "a-C": { pos: { x: 0, y: -30 }, vel: { x: 0, y: 0 }, heading: 0 },
    "h-LW": { pos: { x: -10, y: 35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "a-LW": { pos: { x: -10, y: -35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "h-RW": { pos: { x: 10, y: 35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "a-RW": { pos: { x: 10, y: -35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "h-LD": { pos: { x: -20, y: 35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "a-LD": { pos: { x: -20, y: -35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "h-RD": { pos: { x: 20, y: 35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "a-RD": { pos: { x: 20, y: -35 }, vel: { x: 0, y: 0 }, heading: 0 },
    "h-G": { pos: { x: -80, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
    "a-G": { pos: { x: 80, y: 30 }, vel: { x: 0, y: 0 }, heading: Math.PI },
  };
}

describe("faceoff spots", () => {
  it("places FO by event: goal center, icing dumping DZ, offside NZ, freeze DZ", () => {
    const world = createWorld({ puck: { pos: { x: 40, y: 12 } } });
    expect(faceoffSpotFor("goal", world)).toEqual({ x: 0, y: 0 });
    expect(faceoffSpotFor("icing", world, { dumping: "home" })).toEqual({
      x: -END_ZONE_FACEOFF_X,
      y: HASH_OFFSET_Y,
    });
    expect(faceoffSpotFor("offside", world, { attacking: "home" })).toEqual({
      x: NZ_FACEOFF_X,
      y: HASH_OFFSET_Y,
    });
    world.puck.possessor = "h-G";
    expect(faceoffSpotFor("freeze", world)).toEqual({
      x: -END_ZONE_FACEOFF_X,
      y: HASH_OFFSET_Y,
    });
  });
});

describe("faceoff win", () => {
  it("lets only centers win; stub FO% is 0.5 without attributes", () => {
    const world = createWorld();
    const home = world.bodies["h-C"];
    const away = world.bodies["a-C"];
    expect(home && away).toBeTruthy();
    expect(faceoffWinProbability(world, home!, away!)).toBe(0.5);
    expect(pickFaceoffWinner(world, { next: () => 0 })?.id).toBe("h-C");
    expect(pickFaceoffWinner(world, { next: () => 0.99 })?.id).toBe("a-C");
  });

  it("uses faceoff attributes and fatigue when present", () => {
    const world = createWorld({
      bodies: {
        "h-C": { attributes: attrs({ faceoff: 90 }) },
        "a-C": { attributes: attrs({ faceoff: 10 }) },
      },
      fatigue: { "h-C": 0, "a-C": 0.5 },
    });
    const p = faceoffWinProbability(world, world.bodies["h-C"]!, world.bodies["a-C"]!);
    expect(p).toBeGreaterThan(0.5);
    expect(pickFaceoffWinner(world, { next: () => 0.5 })?.id).toBe("h-C");
  });

  it("awards possession to the winning center at the dot + 1.5 ft", () => {
    const world = createWorld({ phase: "faceoff_drop", faceoffSpot: { x: 0, y: 0 } });
    advanceWorld(world, dirs, { next: () => 0 });
    expect(world.phase).toBe("live");
    expect(world.puck.possessor).toBe("h-C");
    expect(world.puck.pos.x).toBeCloseTo(FACEOFF_PUCK_OFFSET, 8);
    expect(world.puck.pos.y).toBe(0);
  });
});

describe("icing", () => {
  it("calls icing when neither racer is inside 8 ft after 4.0 s", () => {
    const world = createWorld({
      phase: "live",
      liveTick: 0,
      onIce: { home: ["h-LD"], away: ["a-LW"] },
      bodies: {
        "h-LD": { pos: { x: -60, y: -30 }, vel: { x: 0, y: 0 }, heading: 0 },
        "a-LW": { pos: { x: -60, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 90, y: 22 }, vel: { x: 0, y: 0 }, possessor: null },
      icingRace: {
        sideDumping: "home",
        dot: { x: END_ZONE_FACEOFF_X, y: HASH_OFFSET_Y },
        defenderId: "h-LD",
        attackerId: "a-LW",
        startedLiveTick: 0,
      },
    });
    for (let i = 0; i < ICING_RACE_TICKS; i++) {
      advanceWorld(world, dirs, createRng(7));
    }
    expect(world.whistle).toBe("icing");
    expect(world.phase).toBe("whistle");
    expect(world.faceoffSpot?.x).toBe(-END_ZONE_FACEOFF_X);
    expect(world.lastEvents.some((e) => e.type === "Icing")).toBe(true);
  });

  it("does not ice a shorthanded dump (4v5 home SH)", () => {
    expect(isShorthanded(createWorld({ strength: "4v5" }), "home")).toBe(true);
    expect(isShorthanded(createWorld({ strength: "4v5" }), "away")).toBe(false);
    const world = createWorld({
      phase: "live",
      strength: "4v5",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 88, y: 20 }, vel: { x: 40, y: 0 }, possessor: null },
      icingTrack: { sideDumping: "home", shooterId: "h-C" },
    });
    advanceWorld(world, dirs, createRng(3));
    expect(world.whistle).not.toBe("icing");
    expect(world.icingRace).toBeNull();
    expect(world.icingTrack).toBeNull();
    expect(world.phase).toBe("live");
    expect(world.lastEvents.some((e) => e.type === "Icing")).toBe(false);
  });

  it("calls icing when the defender reaches the dot first", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-LD"], away: ["a-LW"] },
      bodies: {
        "h-LD": { pos: { x: 69, y: 22 }, vel: { x: 0, y: 0 }, heading: 0 },
        "a-LW": { pos: { x: -70, y: -30 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 90, y: 22 }, vel: { x: 0, y: 0 }, possessor: null },
      icingRace: {
        sideDumping: "home",
        dot: { x: 69, y: 22 },
        defenderId: "h-LD",
        attackerId: "a-LW",
        startedLiveTick: 0,
      },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.whistle).toBe("icing");
    expect(world.faceoffSpot).toEqual({ x: -END_ZONE_FACEOFF_X, y: HASH_OFFSET_Y });
  });

  it("waives icing when the attacker reaches the dot first", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-LD"], away: ["a-LW"] },
      bodies: {
        "h-LD": { pos: { x: -70, y: -30 }, vel: { x: 0, y: 0 }, heading: 0 },
        "a-LW": { pos: { x: 69, y: 22 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 90, y: 22 }, vel: { x: 0, y: 0 }, possessor: null },
      icingRace: {
        sideDumping: "home",
        dot: { x: 69, y: 22 },
        defenderId: "h-LD",
        attackerId: "a-LW",
        startedLiveTick: 0,
      },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.whistle).toBeNull();
    expect(world.icingRace).toBeNull();
    expect(world.phase).toBe("live");
  });

  it("waives icing when the goalie plays the puck before the goal line", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-G"] },
      bodies: {
        "h-C": { pos: { x: -40, y: 30 }, vel: { x: 0, y: 0 }, heading: Math.PI },
        "a-G": { pos: { x: 50, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 54, y: 0 }, vel: { x: 8, y: 0 }, possessor: null },
      icingTrack: { sideDumping: "home", shooterId: "h-C" },
    });
    advanceWorld(world, dirs, createRng(4));
    expect(world.icingTrack).toBeNull();
    expect(world.icingRace).toBeNull();
    expect(world.whistle).not.toBe("icing");
    expect(world.phase).toBe("live");
  });
});

describe("offside", () => {
  it("starts delayed offside when an attacker is already across the blue", () => {
    const world = createWorld({
      phase: "live",
      puck: { pos: { x: 24, y: 0 }, vel: { x: 50, y: 0 }, possessor: null },
      bodies: {
        ...farBodies(),
        "h-LW": { pos: { x: 40, y: 10 }, vel: { x: 0, y: 0 }, heading: Math.PI },
      },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.delayedOffside).toEqual({ attacking: "home" });
    expect(world.phase).toBe("delayed_offside");
    expect(world.whistle).toBeNull();
  });

  it("nullifies delayed offside when attackers tag up", () => {
    const world = createWorld({
      phase: "delayed_offside",
      delayedOffside: { attacking: "home" },
      puck: { pos: { x: 40, y: 0 }, vel: { x: 0, y: 0 }, possessor: "a-C" },
      bodies: {
        ...farBodies(),
        "a-C": { pos: { x: 36, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.delayedOffside).toBeNull();
    expect(world.phase).toBe("live");
    expect(world.whistle).toBeNull();
  });

  it("whistles offside if the attacking team plays the puck while delayed", () => {
    const world = createWorld({
      phase: "delayed_offside",
      delayedOffside: { attacking: "home" },
      puck: { pos: { x: 40, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
      bodies: {
        ...farBodies(),
        "h-C": { pos: { x: 36, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.whistle).toBe("offside");
    expect(world.phase).toBe("whistle");
    expect(world.faceoffSpot).toEqual({ x: NZ_FACEOFF_X, y: HASH_OFFSET_Y });
    expect(world.lastEvents.some((e) => e.type === "Offside")).toBe(true);
  });
});

describe("goals", () => {
  it("awards a stick-puck goal fully across the goal line in the net", () => {
    expect(puckInNet({ x: 89.5, y: 0 }, GOAL_LINE_X)).toBe(true);
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 89.5, y: 0 }, vel: { x: 2, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "h-C", stickHeight: 3 },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.score.home).toBe(1);
    expect(world.whistle).toBe("goal");
    expect(world.faceoffSpot).toEqual({ x: 0, y: 0 });
    expect(world.lastEvents.some((e) => e.type === "Goal")).toBe(true);
  });

  it("does not award a kicked puck directed at the net", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 89.5, y: 0 }, vel: { x: 10, y: 0 }, possessor: null },
      lastPuckContact: { kind: "skate-puck", playerId: "h-C", stickHeight: 3 },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.score.home).toBe(0);
    expect(world.whistle).not.toBe("goal");
    expect(world.lastEvents.some((e) => e.type === "Goal")).toBe(false);
    expect(world.phase).toBe("live");
  });

  it("waves off a high-stick goal (stickHeight > 4)", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 89.5, y: 0 }, vel: { x: 2, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "h-C", stickHeight: 4.2 },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.score.home).toBe(0);
    expect(world.whistle).toBe("high_stick_goal_waved_off");
    expect(world.faceoffSpot).toEqual({ x: END_ZONE_FACEOFF_X, y: HASH_OFFSET_Y });
  });
});

describe("shots / xG on events", () => {
  it("stores logistic xG on Shot events", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: {
        "h-C": { pos: { x: 40, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
        "a-C": { pos: { x: 0, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 45, y: 0 }, vel: { x: 90, y: 0 }, possessor: null },
    });
    const events: { type?: string; xG?: number }[] = [];
    const prev = captureSnapshot(world);
    prev.possessor = "h-C";
    applyLiveRules(world, createRng(1), prev, (partial) => {
      events.push(partial);
      return { id: "m:0", seq: 0, liveTick: 0, stoppageSeq: 0, period: 1, type: String(partial.type) };
    }, 0.1, []);
    const shot = events.find((e) => e.type === "Shot");
    expect(shot).toBeTruthy();
    expect(shot!.xG).toBeGreaterThanOrEqual(0.01);
    expect(shot!.xG).toBeLessThanOrEqual(0.95);
  });
});
