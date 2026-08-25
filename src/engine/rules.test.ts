import { describe, expect, it } from "vitest";
import type { PlayerAttributes } from "../types/hockey.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import {
  applyLiveRules,
  assessMinor,
  captureSnapshot,
  countOnIceSkaters,
  crossedIntoNet,
  FACEOFF_PUCK_OFFSET,
  faceoffSpotFor,
  faceoffWinProbability,
  ICING_RACE_TICKS,
  isShorthanded,
  MINOR_SECONDS,
  penaltyHazard,
  penaltySeverity,
  pickFaceoffWinner,
  puckInNet,
  pullGoalieLegal,
  tryAddSkater,
  type RuleEmit,
} from "./rules.ts";
import { createRng } from "./rng.ts";
import { END_ZONE_FACEOFF_X, GOAL_LINE_X, HASH_OFFSET_Y, NZ_FACEOFF_X } from "./rink.ts";
import { advanceWorld } from "./step.ts";
import { addBenchLine, createWorld, defaultDirective } from "./world.ts";
import type { MatchEvent } from "../types/events.ts";

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
    const pk = { home: [{ playerId: "h-LW" as const, remaining: 80, kind: "minor" as const }], away: [] };
    expect(isShorthanded(createWorld({ strength: "4v5", penalties: pk }), "home")).toBe(true);
    expect(isShorthanded(createWorld({ strength: "4v5", penalties: pk }), "away")).toBe(false);
    const world = createWorld({
      phase: "live",
      strength: "4v5",
      penalties: { home: [{ playerId: "h-LW", remaining: 80, kind: "minor" }], away: [] },
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

  it("still waives a PK dump when the PK goalie is pulled", () => {
    const pulled = {
      home: { ...defaultDirective(), pullGoalie: true },
      away: defaultDirective(),
    };
    const world = createWorld({
      phase: "live",
      period: 3,
      clockRemaining: 60,
      score: { home: 1, away: 2 },
      penalties: { home: [{ playerId: "h-LW", remaining: 80, kind: "minor" }], away: [] },
      goalieInNet: { home: false, away: true },
      onIce: { home: ["h-C", "h-F4"], away: ["a-C"] },
      bench: { home: ["h-G"], away: [] },
      bodies: {
        ...farBodies(),
        "h-F4": { side: "home", position: "C", line: "F4", pos: { x: 0, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 88, y: 20 }, vel: { x: 40, y: 0 }, possessor: null },
      icingTrack: { sideDumping: "home", shooterId: "h-C" },
      directives: pulled,
    });
    expect(isShorthanded(world, "home")).toBe(true);
    advanceWorld(world, pulled, createRng(3));
    expect(world.whistle).not.toBe("icing");
    expect(world.icingRace).toBeNull();
    expect(world.lastEvents.some((e) => e.type === "Icing")).toBe(false);
    expect(world.goalieInNet.home).toBe(false);
  });

  it("ices an even-strength empty-net dump (6v5 is not SH)", () => {
    const pulled = {
      home: { ...defaultDirective(), pullGoalie: true },
      away: defaultDirective(),
    };
    const world = createWorld({
      phase: "live",
      period: 3,
      clockRemaining: 60,
      score: { home: 1, away: 2 },
      goalieInNet: { home: false, away: true },
      onIce: { home: ["h-C", "h-F4"], away: ["a-C", "a-LW"] },
      bench: { home: ["h-G"], away: [] },
      bodies: {
        ...farBodies(),
        "h-F4": { side: "home", position: "C", line: "F4", pos: { x: 0, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: -88, y: 20 }, vel: { x: -40, y: 0 }, possessor: null },
      icingTrack: { sideDumping: "away", shooterId: "a-C" },
      directives: pulled,
    });
    expect(isShorthanded(world, "away")).toBe(false);
    advanceWorld(world, pulled, createRng(3));
    expect(world.icingTrack).toBeNull();
    expect(world.icingRace !== null || world.whistle === "icing").toBe(true);
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

  it("waives icing when the goalie plays the puck during the race", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-LD"], away: ["a-LW", "a-G"] },
      bodies: {
        "h-LD": { pos: { x: -70, y: -30 }, vel: { x: 0, y: 0 }, heading: 0 },
        "a-LW": { pos: { x: -70, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
        "a-G": { pos: { x: 90, y: 22 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 94, y: 22 }, vel: { x: 0, y: 0 }, possessor: null },
      icingRace: {
        sideDumping: "home",
        dot: { x: END_ZONE_FACEOFF_X, y: HASH_OFFSET_Y },
        defenderId: "h-LD",
        attackerId: "a-LW",
        startedLiveTick: 0,
      },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.icingRace).toBeNull();
    expect(world.whistle).not.toBe("icing");
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

  it("does not whistle after tag-up when an attacker then plays the puck", () => {
    const world = createWorld({
      phase: "delayed_offside",
      delayedOffside: { attacking: "home" },
      puck: { pos: { x: 24, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
      bodies: {
        ...farBodies(),
        "h-C": { pos: { x: 20, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.delayedOffside).toBeNull();
    expect(world.whistle).toBeNull();
    expect(world.phase).toBe("live");
  });

  it("whistles offside when an offside attacker shoots (possession release)", () => {
    const world = createWorld({
      phase: "delayed_offside",
      delayedOffside: { attacking: "home" },
      puck: { pos: { x: 40, y: 0 }, vel: { x: 80, y: 0 }, possessor: null },
      bodies: {
        ...farBodies(),
        "h-LW": { pos: { x: 40, y: 10 }, vel: { x: 0, y: 0 }, heading: Math.PI },
        "h-C": { pos: { x: 30, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
    });
    const prev = captureSnapshot(world);
    prev.possessor = "h-C";
    const events: { type?: string }[] = [];
    applyLiveRules(world, createRng(1), prev, (partial) => {
      events.push(partial);
      return { id: "m:0", seq: 0, liveTick: world.liveTick, stoppageSeq: 0, period: 1, type: String(partial.type) };
    }, 0.1, []);
    expect(events.some((e) => e.type === "Offside")).toBe(true);
    expect(world.whistle).toBe("offside");
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
    expect(crossedIntoNet({ x: 88.4, y: 0 }, { x: 89.5, y: 0 }, GOAL_LINE_X)).toBe(true);
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 88.4, y: 0 }, vel: { x: 20, y: 0 }, possessor: null },
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
      puck: { pos: { x: 88.4, y: 0 }, vel: { x: 20, y: 0 }, possessor: null },
      lastPuckContact: { kind: "skate-puck", playerId: "h-C", stickHeight: 3 },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.score.home).toBe(0);
    expect(world.whistle).not.toBe("goal");
    expect(world.lastEvents.some((e) => e.type === "Goal")).toBe(false);
    expect(world.phase).toBe("live");
  });

  it("does not award a later stick-puck while the puck remains in the net after a kick", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 89.6, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "h-C", stickHeight: 3 },
    });
    const prev = captureSnapshot(world);
    applyLiveRules(world, createRng(1), prev, () => {
      return { id: "m:0", seq: 0, liveTick: 0, stoppageSeq: 0, period: 1, type: "Goal" };
    }, 0.1, []);
    expect(world.score.home).toBe(0);
    expect(world.whistle).toBeNull();
  });

  it("waves off a high-stick goal (stickHeight > 4)", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 88.4, y: 0 }, vel: { x: 20, y: 0 }, possessor: null },
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

function testEmit(events: MatchEvent[]): RuleEmit {
  return (partial) => {
    const ev = {
      id: "t:0",
      seq: events.length,
      liveTick: 0,
      stoppageSeq: 0,
      period: 1 as const,
      ...partial,
    } as MatchEvent;
    events.push(ev);
    return ev;
  };
}

describe("penalties / special teams", () => {
  it("uses DESIGN §4.2 hazard on contact, not a per-tick roll", () => {
    expect(penaltySeverity(0)).toBe(0.2);
    expect(penaltySeverity(28)).toBe(1);
    expect(penaltyHazard(100, 28)).toBeCloseTo(0.003, 10);
    expect(penaltyHazard(0, 28)).toBeCloseTo(0.013, 10);

    const quiet = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: "h-C" },
    });
    const zero = { next: () => 0 };
    for (let i = 0; i < 20; i++) advanceWorld(quiet, dirs, zero);
    expect(quiet.lastEvents.some((e) => e.type === "Penalty")).toBe(false);
    expect(quiet.delayedPenalty).toBeNull();
    expect(quiet.strength).toBe("5v5");
  });

  it("rolls the contact hazard and delays when the non-offender has the puck", () => {
    const world = createWorld({
      phase: "live",
      puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: "h-C" },
      bodies: {
        ...farBodies(),
        "h-LW": { pos: { x: -10, y: 35 }, vel: { x: 0, y: 0 }, heading: 0 },
        "a-LW": { pos: { x: -10, y: -35 }, vel: { x: 0, y: 20 }, heading: Math.PI / 2 },
      },
    });
    const events: MatchEvent[] = [];
    const prev = captureSnapshot(world);
    applyLiveRules(world, { next: () => 0 }, prev, testEmit(events), 0.1, [], [
      { kind: "body-body", a: "h-LW", b: "a-LW" },
    ]);
    expect(world.delayedPenalty?.against).toBe("away");
    expect(world.phase).toBe("delayed_penalty");
    expect(world.onIce.away).toContain("a-LW");
    expect(world.penalties.away).toHaveLength(0);
  });

  it("puts 5v4 on the ice when a minor is assessed", () => {
    const world = createWorld({ phase: "live" });
    const events: MatchEvent[] = [];
    assessMinor(world, "away", "a-RW", testEmit(events));
    expect(events.some((e) => e.type === "Penalty")).toBe(true);
    expect(world.penalties.away).toEqual([{ playerId: "a-RW", remaining: MINOR_SECONDS, kind: "minor" }]);
    expect(world.onIce.away).not.toContain("a-RW");
    expect(countOnIceSkaters(world, "home")).toBe(5);
    expect(countOnIceSkaters(world, "away")).toBe(4);
    expect(world.strength).toBe("5v4");
  });

  it("ends the minor on a PP goal even if the PK goalie is pulled", () => {
    const pulled = {
      home: defaultDirective(),
      away: { ...defaultDirective(), pullGoalie: true },
    };
    const world = createWorld({
      phase: "live",
      period: 3,
      clockRemaining: 60,
      score: { home: 2, away: 1 },
      penalties: { home: [], away: [{ playerId: "a-C", remaining: 90, kind: "minor" }] },
      goalieInNet: { home: true, away: false },
      onIce: {
        home: ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-G"],
        away: ["a-LW", "a-RW", "a-LD", "a-RD", "a-F4"],
      },
      bench: { home: [], away: ["a-C", "a-G"] },
      bodies: {
        ...farBodies(),
        "a-F4": { side: "away", position: "C", line: "F4", pos: { x: 0, y: -30 }, vel: { x: 0, y: 0 }, heading: Math.PI },
      },
      puck: { pos: { x: 88.4, y: 0 }, vel: { x: 20, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "h-C", stickHeight: 3 },
      directives: pulled,
    });
    expect(isShorthanded(world, "away")).toBe(true);
    advanceWorld(world, pulled, createRng(1));
    expect(world.score.home).toBe(3);
    expect(world.penalties.away).toHaveLength(0);

    const sh = createWorld({
      phase: "live",
      period: 3,
      clockRemaining: 60,
      score: { home: 2, away: 1 },
      penalties: { home: [], away: [{ playerId: "a-C", remaining: 90, kind: "minor" }] },
      goalieInNet: { home: true, away: false },
      onIce: {
        home: ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-G"],
        away: ["a-LW", "a-RW", "a-LD", "a-RD", "a-F4"],
      },
      bench: { home: [], away: ["a-C", "a-G"] },
      bodies: {
        ...farBodies(),
        "a-F4": { side: "away", position: "C", line: "F4", pos: { x: 0, y: -30 }, vel: { x: 0, y: 0 }, heading: Math.PI },
      },
      puck: { pos: { x: -88.4, y: 0 }, vel: { x: -20, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "a-LW", stickHeight: 3 },
      directives: pulled,
    });
    advanceWorld(sh, pulled, createRng(1));
    expect(sh.score.away).toBe(2);
    expect(sh.penalties.away).toHaveLength(1);
  });

  it("ends the minor when the PP team scores, not on a shorthanded goal", () => {
    const pp = createWorld({
      phase: "live",
      strength: "5v4",
      penalties: { home: [], away: [{ playerId: "a-C", remaining: 90, kind: "minor" }] },
      onIce: {
        home: ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-G"],
        away: ["a-LW", "a-RW", "a-LD", "a-RD", "a-G"],
      },
      bench: { home: [], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: 88.4, y: 0 }, vel: { x: 20, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "h-C", stickHeight: 3 },
    });
    advanceWorld(pp, dirs, createRng(1));
    expect(pp.score.home).toBe(1);
    expect(pp.penalties.away).toHaveLength(0);
    expect(countOnIceSkaters(pp, "away")).toBe(5);
    expect(pp.strength).toBe("5v5");

    const sh = createWorld({
      phase: "live",
      strength: "5v4",
      penalties: { home: [], away: [{ playerId: "a-C", remaining: 90, kind: "minor" }] },
      onIce: {
        home: ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-G"],
        away: ["a-LW", "a-RW", "a-LD", "a-RD", "a-G"],
      },
      bench: { home: [], away: ["a-C"] },
      bodies: farBodies(),
      puck: { pos: { x: -88.4, y: 0 }, vel: { x: -20, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "a-LW", stickHeight: 3 },
    });
    advanceWorld(sh, dirs, createRng(1));
    expect(sh.score.away).toBe(1);
    expect(sh.penalties.away).toHaveLength(1);
    expect(countOnIceSkaters(sh, "away")).toBe(4);
    expect(sh.strength).toBe("5v4");
  });

  it("still assesses a delayed minor after an EN goal against the extra-attacker team", () => {
    const world = createWorld({
      phase: "delayed_penalty",
      delayedPenalty: { against: "away", playerId: "a-C" },
      goalieInNet: { home: false, away: true },
      onIce: {
        home: ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-F4"],
        away: ["a-C", "a-LW", "a-RW", "a-LD", "a-RD", "a-G"],
      },
      bench: { home: ["h-G"], away: [] },
      bodies: {
        ...farBodies(),
        "h-F4": { side: "home", position: "C", line: "F4", pos: { x: 0, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: -88.4, y: 0 }, vel: { x: -20, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "a-C", stickHeight: 3 },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.score.away).toBe(1);
    expect(world.delayedPenalty).toBeNull();
    expect(world.penalties.away.some((p) => p.playerId === "a-C")).toBe(true);
    expect(world.lastEvents.some((e) => e.type === "Penalty")).toBe(true);
    expect(world.onIce.away).not.toContain("a-C");
  });
});

describe("too many skaters / empty net", () => {
  it("rejects an illegal 6th skater and does not assess a penalty", () => {
    const world = createWorld({ phase: "live" });
    const extras = addBenchLine(world, "home", "F2");
    const extra = extras[0];
    expect(extra).toBeTruthy();
    const events: MatchEvent[] = [];
    const ok = tryAddSkater(world, "home", extra!, testEmit(events));
    expect(ok).toBe(false);
    expect(events.some((e) => e.type === "IllegalChangeRejected")).toBe(true);
    expect(events.some((e) => e.type === "Penalty")).toBe(false);
    expect(world.penalties.home).toHaveLength(0);
    expect(countOnIceSkaters(world, "home")).toBe(5);
    expect(world.onIce.home).not.toContain(extra);
  });

  it("allows a 6th skater after a legal delayed-penalty pull", () => {
    const world = createWorld({
      phase: "delayed_penalty",
      delayedPenalty: { against: "away", playerId: "a-C" },
      period: 1,
      clockRemaining: 500,
      score: { home: 0, away: 0 },
      bodies: farBodies(),
    });
    expect(pullGoalieLegal(world, "home")).toBe(true);
    const pulled = {
      home: { ...defaultDirective(), pullGoalie: true },
      away: defaultDirective(),
    };
    advanceWorld(world, pulled, createRng(1));
    expect(world.goalieInNet.home).toBe(false);
    expect(countOnIceSkaters(world, "home")).toBe(6);
    expect(world.onIce.home).toContain("h-F4");
    expect(world.onIce.home).not.toContain("h-G");
    expect(world.lastEvents.some((e) => e.type === "GoaliePull")).toBe(true);
    expect(world.strength).toBe("6v5");
  });

  it("only allows pullGoalie in the last 2:00 of the 3rd when trailing, or delayed penalty", () => {
    const trailing = createWorld({
      period: 3,
      clockRemaining: 120,
      score: { home: 1, away: 2 },
      phase: "live",
    });
    expect(pullGoalieLegal(trailing, "home")).toBe(true);
    expect(pullGoalieLegal(trailing, "away")).toBe(false);

    const tooEarly = createWorld({
      period: 3,
      clockRemaining: 120.1,
      score: { home: 1, away: 2 },
      phase: "live",
    });
    expect(pullGoalieLegal(tooEarly, "home")).toBe(false);

    const tied = createWorld({
      period: 3,
      clockRemaining: 60,
      score: { home: 2, away: 2 },
      phase: "live",
    });
    expect(pullGoalieLegal(tied, "home")).toBe(false);

    const p2 = createWorld({
      period: 2,
      clockRemaining: 10,
      score: { home: 0, away: 4 },
      phase: "live",
    });
    expect(pullGoalieLegal(p2, "home")).toBe(false);

    const delay = createWorld({
      period: 1,
      clockRemaining: 800,
      score: { home: 5, away: 0 },
      phase: "delayed_penalty",
      delayedPenalty: { against: "away", playerId: "a-C" },
    });
    expect(pullGoalieLegal(delay, "home")).toBe(true);
    expect(pullGoalieLegal(delay, "away")).toBe(false);

    const ot = createWorld({
      period: "OT",
      clockRemaining: 200,
      score: { home: 2, away: 3 },
      phase: "live",
    });
    expect(pullGoalieLegal(ot, "home")).toBe(true);

    const ignored = createWorld({
      period: 3,
      clockRemaining: 200,
      score: { home: 1, away: 2 },
      phase: "live",
      bodies: farBodies(),
    });
    advanceWorld(
      ignored,
      { home: { ...defaultDirective(), pullGoalie: true }, away: defaultDirective() },
      createRng(1),
    );
    expect(ignored.goalieInNet.home).toBe(true);
    expect(ignored.lastEvents.some((e) => e.type === "GoaliePull")).toBe(false);

    const window = createWorld({
      period: 3,
      clockRemaining: 120,
      score: { home: 1, away: 2 },
      phase: "live",
      bodies: farBodies(),
    });
    advanceWorld(
      window,
      { home: { ...defaultDirective(), pullGoalie: true }, away: defaultDirective() },
      createRng(1),
    );
    expect(window.goalieInNet.home).toBe(false);
    expect(countOnIceSkaters(window, "home")).toBe(6);
    expect(window.lastEvents.some((e) => e.type === "GoaliePull")).toBe(true);
  });

  it("puts the goalie back when a delayed extra attacker is no longer legal", () => {
    const pulled = {
      home: { ...defaultDirective(), pullGoalie: true },
      away: defaultDirective(),
    };
    const world = createWorld({
      phase: "delayed_penalty",
      delayedPenalty: { against: "away", playerId: "a-C" },
      period: 1,
      clockRemaining: 500,
      score: { home: 0, away: 0 },
      bodies: farBodies(),
      puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: "h-C" },
    });
    advanceWorld(world, pulled, createRng(1));
    expect(world.goalieInNet.home).toBe(false);
    expect(world.onIce.home).toContain("h-F4");
    world.puck.possessor = "a-C";
    const ac = world.bodies["a-C"];
    if (ac) {
      ac.pos = { x: 0, y: 0 };
      ac.heading = 0;
    }
    world.puck.pos = { x: 3, y: 0 };
    advanceWorld(world, pulled, createRng(1));
    expect(world.delayedPenalty).toBeNull();
    expect(world.penalties.away.some((p) => p.playerId === "a-C")).toBe(true);
    expect(world.goalieInNet.home).toBe(true);
    expect(world.onIce.home).not.toContain("h-F4");
    expect(world.onIce.home).toContain("h-G");
    expect(world.strength).toBe("5v4");
  });

  it("puts the goalie back after a last-2:00 pull when the score ties", () => {
    const pulled = {
      home: { ...defaultDirective(), pullGoalie: true },
      away: defaultDirective(),
    };
    const world = createWorld({
      phase: "live",
      period: 3,
      clockRemaining: 60,
      score: { home: 1, away: 2 },
      goalieInNet: { home: false, away: true },
      onIce: {
        home: ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-F4"],
        away: ["a-C", "a-LW", "a-RW", "a-LD", "a-RD", "a-G"],
      },
      bench: { home: ["h-G"], away: [] },
      bodies: {
        ...farBodies(),
        "h-F4": { side: "home", position: "C", line: "F4", pos: { x: 0, y: 30 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 88.4, y: 0 }, vel: { x: 20, y: 0 }, possessor: null },
      lastPuckContact: { kind: "stick-puck", playerId: "h-C", stickHeight: 3 },
      directives: pulled,
    });
    advanceWorld(world, pulled, createRng(1));
    expect(world.score.home).toBe(2);
    expect(world.score.away).toBe(2);
    expect(world.goalieInNet.home).toBe(true);
    expect(world.onIce.home).not.toContain("h-F4");
    expect(world.onIce.home).toContain("h-G");
  });
});

describe("period-end line changes", () => {
  it("auto-changes tired skaters on the period-end whistle unless lockLines", () => {
    const world = createWorld({
      phase: "whistle",
      whistle: "period_end",
      period: 1,
      clockRemaining: 0,
      fatigue: { "h-C": 0.7 },
    });
    addBenchLine(world, "home", "F2");
    advanceWorld(world, dirs, createRng(1));
    expect(world.phase).toBe("intermission");
    expect(world.onIce.home).not.toContain("h-C");
    expect(world.onIce.home).toContain("h-F2-C");

    const locked = createWorld({
      phase: "whistle",
      whistle: "period_end",
      period: 1,
      clockRemaining: 0,
      fatigue: { "h-C": 0.7 },
      directives: {
        home: { ...defaultDirective(), lockLines: true },
        away: defaultDirective(),
      },
    });
    addBenchLine(locked, "home", "F2");
    advanceWorld(
      locked,
      { home: { ...defaultDirective(), lockLines: true }, away: defaultDirective() },
      createRng(1),
    );
    expect(locked.onIce.home).toContain("h-C");
  });
});
