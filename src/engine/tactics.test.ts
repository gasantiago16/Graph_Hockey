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
  OZ_ICE_SHOOT_ALONG,
  passReceiver,
  playForSide,
  routeClearOfOwnNet,
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

  it("does not pass to a teammate already past the blue when the carrier is in the NZ", () => {
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
        "h-LW": { pos: { x: 40, y: 8 }, heading: 0 },
        "h-RW": { pos: { x: 18, y: -8 }, heading: 0 },
      },
    });
    const c = findBySlot(world, "home", "C")!;
    const recv = passReceiver(world, c);
    expect(recv?.id).toBe("h-RW");
    expect(recv?.pos.x).toBeLessThanOrEqual(BLUE_LINE_X);
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

  it("NZ assignment dump with computed iceIntents releases as clear", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      puck: { pos: { x: 10, y: 8 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 10, y: 8 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    world.iceIntents = {
      home: computeIceIntent(world, "home"),
      away: computeIceIntent(world, "away"),
    };
    expect(world.iceIntents.home.f1Action).toBe("clear");
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.puck.possessor).toBeNull();
    expect(world.stickRelease).toBe("clear");
  });

  it("overlay dump + NZ ice clear releases as clear, not Shot", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      iceIntents: {
        home: { roles: {}, targets: {}, f1: "h-C", f1Action: "clear" },
        away: { roles: {}, targets: {} },
      },
      directives: {
        home: { playId: "5v5-122-forecheck", pressure: "neutral", playParams: { shotPolicy: "dump" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 10, y: 8 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 10, y: 8 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.puck.possessor).toBeNull();
    expect(world.stickRelease).toBe("clear");
  });

  it("overlay dump + NZ ice clear does not emit a Shot", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      directives: {
        home: { playId: "5v5-122-forecheck", pressure: "neutral", playParams: { shotPolicy: "dump" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 10, y: 8 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 10, y: 8 }, heading: 0, vel: { x: 0, y: 0 } },
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

  it("DZ ice pass beats overlay dump when an outlet is ahead", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      iceIntents: {
        home: { roles: {}, targets: {}, f1: "h-C", f1Action: "pass" },
        away: { roles: {}, targets: {} },
      },
      directives: {
        home: { playId: "5v5-122-forecheck", pressure: "neutral", playParams: { shotPolicy: "dump" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: -50, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: -50, y: 0 }, heading: 0, vel: { x: 0, y: 0 } },
        "h-LW": { pos: { x: -20, y: 8 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("pass");
    expect(world.puck.possessor).toBeNull();
  });

  it("OZ ice shoot still beats overlay dump", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      iceIntents: {
        home: { roles: {}, targets: {}, f1: "h-C", f1Action: "shoot" },
        away: { roles: {}, targets: {} },
      },
      directives: {
        home: { playId: "5v5-122-forecheck", pressure: "neutral", playParams: { shotPolicy: "dump" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 50, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 50, y: 0 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("shot");
  });

  it("ice shoot just inside the blue carries instead of one-timing", () => {
    const book = loadPlaybook("original-six");
    const x = BLUE_LINE_X + 4;
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      iceIntents: {
        home: { roles: {}, targets: {}, f1: "h-C", f1Action: "shoot" },
        away: { roles: {}, targets: {} },
      },
      directives: {
        home: { playId: "5v5-122-forecheck", pressure: "neutral", playParams: { shotPolicy: "dump" } },
        away: defaultDirective(),
      },
      puck: { pos: { x, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x, y: 0 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    expect(x).toBeLessThan(OZ_ICE_SHOOT_ALONG);
    expect(maybeReleasePuck(world)).toBe(false);
    expect(world.puck.possessor).toBe("h-C");
    const c = findBySlot(world, "home", "C")!;
    const t = steeringTarget(world, c);
    expect(t.x).toBeGreaterThan(x);
    expect(t.x).toBeCloseTo(GOAL_LINE_X, 0);
    expect(Math.abs(t.y)).toBeLessThan(8);
  });

  it("overlay shoot still releases from just inside the blue", () => {
    const book = loadPlaybook("expansion");
    const x = BLUE_LINE_X + 4;
    const world = createWorld({
      playId: { home: "5v5-212-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      iceIntents: {
        home: { roles: {}, targets: {}, f1: "h-C", f1Action: "pass" },
        away: { roles: {}, targets: {} },
      },
      directives: {
        home: { playId: "5v5-212-forecheck", pressure: "aggressive", playParams: { shotPolicy: "shoot" } },
        away: defaultDirective(),
      },
      puck: { pos: { x, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x, y: 0 }, heading: 0, vel: { x: 0, y: 0 } },
      },
    });
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("shot");
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

  it("shotLock blocks a second shot until Save or opponent possession", () => {
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
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("shot");
    expect(world.shotLock.home).toBe(true);

    world.puck.possessor = "h-C";
    world.puck.pos = { x: 50, y: 0 };
    world.puck.vel = { x: 0, y: 0 };
    world.bodies["h-C"]!.pos = { x: 50, y: 0 };
    world.bodies["h-C"]!.heading = 0;
    world.stickRelease = null;
    expect(maybeReleasePuck(world)).toBe(false);
    expect(world.puck.possessor).toBe("h-C");
    expect(world.shotLock.home).toBe(true);

    world.shotLock.home = false;
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("shot");
  });

  it("does not release while delayed offside for the attacking side", () => {
    const book = loadPlaybook("expansion");
    const world = createWorld({
      delayedOffside: { attacking: "home" },
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
    expect(maybeReleasePuck(world)).toBe(false);
    expect(world.puck.possessor).toBe("h-C");
  });

  it("locked overlay shoot with a receiver passes instead of holding", () => {
    const book = loadPlaybook("expansion");
    const world = createWorld({
      playId: { home: "5v5-212-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      shotLock: { home: true, away: false },
      directives: {
        home: { playId: "5v5-212-forecheck", pressure: "aggressive", playParams: { shotPolicy: "shoot" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 50, y: 0 }, possessor: "h-C" },
      bodies: {
        "h-C": { pos: { x: 50, y: 0 }, heading: 0, vel: { x: 0, y: 0 } },
        "h-LW": { pos: { x: 68, y: 10 }, heading: 0 },
      },
    });
    const c = findBySlot(world, "home", "C")!;
    const target = steeringTarget(world, c);
    expect(Math.hypot(target.x - 68, target.y - 10)).toBeLessThan(0.5);
    world.bodies["h-C"]!.heading = Math.atan2(10, 18);
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("pass");
    expect(world.shotLock.home).toBe(true);
  });

  it("after a Shot, recapture without Save does not emit another Shot", () => {
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
    let shots = 0;
    for (let i = 0; i < 40; i++) {
      const ev = advanceWorld(world, world.directives, rng);
      shots += ev.filter((e) => e.type === "Shot").length;
      if (shots > 0) {
        expect(world.shotLock.home).toBe(true);
        break;
      }
    }
    expect(shots).toBe(1);

    for (let i = 0; i < 20; i++) {
      world.whistle = null;
      world.phase = "live";
      world.puck.possessor = "h-C";
      world.puck.pos = { x: 50, y: 0 };
      world.puck.vel = { x: 0, y: 0 };
      const c = world.bodies["h-C"]!;
      c.pos = { x: 50, y: 0 };
      c.vel = { x: 0, y: 0 };
      c.heading = 0;
      const ev = advanceWorld(world, world.directives, rng);
      expect(ev.some((e) => e.type === "Shot")).toBe(false);
      expect(ev.some((e) => e.type === "Save")).toBe(false);
    }
    expect(world.shotLock.home).toBe(true);
  });

  it("Save clears the shooter's shotLock for a rebound chance", () => {
    const world = createWorld({
      shotLock: { home: true, away: false },
      puck: { pos: { x: GOAL_LINE_X - 3, y: 0 }, vel: { x: 20, y: 0 }, possessor: null },
      bodies: {
        "a-G": { pos: { x: GOAL_LINE_X - 2, y: 0 }, vel: { x: 0, y: 0 } },
      },
    });
    const ev = advanceWorld(world, world.directives, createRng(1));
    expect(ev.some((e) => e.type === "Save")).toBe(true);
    expect(world.shotLock.home).toBe(false);
  });

  it("ice F1 shoot beats overlay pass/dump and releases a shot", () => {
    const book = loadPlaybook("original-six");
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      directives: {
        home: { playId: "5v5-122-forecheck", pressure: "neutral", playParams: { shotPolicy: "pass" } },
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
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("shot");
    expect(world.puck.possessor).toBeNull();
  });

  it("overlay shoot/crash still wins over ice pass", () => {
    const book = loadPlaybook("expansion");
    const world = createWorld({
      playId: { home: "5v5-212-forecheck", away: DEFAULT_PLAY_ID },
      playbooks: { home: book, away: book },
      directives: {
        home: { playId: "5v5-212-forecheck", pressure: "aggressive", playParams: { shotPolicy: "shoot" } },
        away: defaultDirective(),
      },
      puck: { pos: { x: 50, y: 0 }, possessor: "h-C" },
      bodies: { "h-C": { pos: { x: 50, y: 0 }, heading: 0 } },
    });
    world.iceIntents = {
      home: { ...computeIceIntent(world, "home"), f1Action: "pass" },
      away: computeIceIntent(world, "away"),
    };
    expect(maybeReleasePuck(world)).toBe(true);
    expect(world.stickRelease).toBe("shot");
  });
});

describe("routeClearOfOwnNet", () => {
  it("does not yank a collapsed Ds off a crease dest onto the hash", () => {
    const world = createWorld({
      puck: { pos: { x: -80, y: 2 }, possessor: "a-C" },
      bodies: {
        "h-LD": { pos: { x: -76, y: 2 } },
      },
    });
    const ld = findBySlot(world, "home", "LD")!;
    const dest = { x: -75, y: 2 };
    const out = routeClearOfOwnNet(world, ld, dest);
    expect(out.x).toBeCloseTo(-75, 0);
    expect(Math.abs(out.y)).toBeLessThan(10);
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
