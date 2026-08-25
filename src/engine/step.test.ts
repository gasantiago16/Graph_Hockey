import { describe, expect, it } from "vitest";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { DT, isInsideRink } from "./rink.ts";
import { createRng } from "./rng.ts";
import { advanceWorld, clockRuns } from "./step.ts";
import { PUCK_RADIUS, PUCK_MAX_SPEED, SKATER_MAX_SPEED } from "./physics.ts";
import { createWorld, defaultDirective, onIceBodies, type WorldState } from "./world.ts";

const dirs = {
  home: defaultDirective(DEFAULT_PLAY_ID),
  away: defaultDirective(DEFAULT_PLAY_ID),
};

function pose(world: WorldState) {
  const bodies = Object.keys(world.bodies)
    .sort()
    .map((id) => {
      const b = world.bodies[id];
      if (!b) return id;
      return {
        id,
        x: b.pos.x,
        y: b.pos.y,
        vx: b.vel.x,
        vy: b.vel.y,
        heading: b.heading,
      };
    });
  return {
    liveTick: world.liveTick,
    clockRemaining: world.clockRemaining,
    phase: world.phase,
    possessor: world.puck.possessor,
    puck: { x: world.puck.pos.x, y: world.puck.pos.y, vx: world.puck.vel.x, vy: world.puck.vel.y },
    bodies,
  };
}

function assertInside(world: WorldState) {
  expect(isInsideRink(world.puck.pos, PUCK_RADIUS, 1e-4)).toBe(true);
  for (const b of onIceBodies(world)) {
    expect(isInsideRink(b.pos, b.radius, 1e-4), `${b.id} left the ice`).toBe(true);
  }
}

describe("advanceWorld stop-time", () => {
  it("decrements clock and liveTick only in live / delayed_*", () => {
    const live = createWorld({ phase: "live", clockRemaining: 100, liveTick: 5 });
    advanceWorld(live, dirs, createRng(1));
    expect(live.clockRemaining).toBeCloseTo(100 - DT, 10);
    expect(live.liveTick).toBe(6);

    const delayed = createWorld({ phase: "delayed_offside", clockRemaining: 100, liveTick: 5 });
    advanceWorld(delayed, dirs, createRng(1));
    expect(delayed.clockRemaining).toBeCloseTo(100 - DT, 10);
    expect(delayed.liveTick).toBe(6);

    const delayedPen = createWorld({ phase: "delayed_penalty", clockRemaining: 50, liveTick: 9 });
    advanceWorld(delayedPen, dirs, createRng(1));
    expect(delayedPen.clockRemaining).toBeCloseTo(50 - DT, 10);
    expect(delayedPen.liveTick).toBe(10);
  });

  it("does not decrement the clock in whistle or faceoff_drop", () => {
    const whistle = createWorld({
      phase: "whistle",
      whistle: "freeze",
      clockRemaining: 500,
      liveTick: 80,
    });
    advanceWorld(whistle, dirs, createRng(2));
    expect(whistle.clockRemaining).toBe(500);
    expect(whistle.liveTick).toBe(80);
    expect(whistle.phase).toBe("faceoff_drop");

    const drop = createWorld({
      phase: "faceoff_drop",
      clockRemaining: 500,
      liveTick: 80,
      faceoffSpot: { x: 0, y: 0 },
    });
    advanceWorld(drop, dirs, createRng(2));
    expect(drop.clockRemaining).toBe(500);
    expect(drop.liveTick).toBe(80);
    expect(drop.phase).toBe("live");
    expect(drop.puck.possessor === "h-C" || drop.puck.possessor === "a-C").toBe(true);
  });

  it("liveTick increments only on live/delayed steps", () => {
    expect(clockRuns("live")).toBe(true);
    expect(clockRuns("delayed_offside")).toBe(true);
    expect(clockRuns("delayed_penalty")).toBe(true);
    expect(clockRuns("whistle")).toBe(false);
    expect(clockRuns("faceoff_drop")).toBe(false);
    expect(clockRuns("intermission")).toBe(false);
    expect(clockRuns("game_over")).toBe(false);

    const over = createWorld({ phase: "game_over", liveTick: 12, clockRemaining: 0 });
    advanceWorld(over, dirs, createRng(1));
    expect(over.liveTick).toBe(12);
    expect(over.clockRemaining).toBe(0);

    const inter = createWorld({ phase: "intermission", liveTick: 12, period: 1, clockRemaining: 0 });
    advanceWorld(inter, dirs, createRng(1));
    expect(inter.liveTick).toBe(0);
    expect(inter.period).toBe(2);
    expect(inter.phase).toBe("faceoff_drop");
  });

  it("starts OT as 3v3 with 2F + 1D + G", () => {
    const world = createWorld({ phase: "intermission", period: 3, clockRemaining: 0, liveTick: 99 });
    advanceWorld(world, dirs, createRng(1));
    expect(world.period).toBe("OT");
    expect(world.clockRemaining).toBe(300);
    expect(world.strength).toBe("3v3");
    expect(world.phase).toBe("faceoff_drop");
    for (const side of ["home", "away"] as const) {
      const skaters = world.onIce[side].map((id) => world.bodies[id]).filter((b) => b && b.position !== "G");
      const g = world.onIce[side].map((id) => world.bodies[id]).filter((b) => b && b.position === "G");
      expect(skaters).toHaveLength(3);
      expect(g).toHaveLength(1);
      const positions = skaters.map((b) => b!.position).sort();
      expect(positions).toEqual(["C", "LD", "LW"]);
    }
  });

  it("starts OT 3v2 when a minor carries over and does not ice the boxed player", () => {
    const world = createWorld({
      phase: "intermission",
      period: 3,
      clockRemaining: 0,
      liveTick: 99,
      score: { home: 1, away: 1 },
      penalties: { home: [], away: [{ playerId: "a-C", remaining: 90, kind: "minor" }] },
    });
    advanceWorld(world, dirs, createRng(1));
    expect(world.period).toBe("OT");
    expect(world.strength).toBe("3v2");
    expect(world.onIce.away).not.toContain("a-C");
    expect(world.penalties.away.some((p) => p.playerId === "a-C")).toBe(true);
    const awaySkaters = world.onIce.away.map((id) => world.bodies[id]).filter((b) => b && b.position !== "G");
    expect(awaySkaters).toHaveLength(2);
  });
});

describe("advanceWorld kinematics", () => {
  it("is deterministic: same seed + same dirs → identical liveTick positions after N steps", () => {
    const n = 80;
    const make = () =>
      createWorld({
        seed: 42,
        phase: "live",
        puck: { pos: { x: 0, y: 0 }, vel: { x: 18, y: -11 }, possessor: null },
        bodies: {
          "h-C": { vel: { x: 12, y: 6 } },
          "a-C": { vel: { x: -9, y: -7 } },
          "h-LW": { vel: { x: 4, y: -15 } },
          "a-RW": { vel: { x: -20, y: 3 } },
        },
      });
    const a = make();
    const b = make();
    const rngA = createRng(42);
    const rngB = createRng(42);
    for (let i = 0; i < n; i++) {
      advanceWorld(a, dirs, rngA);
      advanceWorld(b, dirs, rngB);
    }
    expect(a.liveTick).toBe(n);
    expect(b.liveTick).toBe(n);
    expect(pose(a)).toEqual(pose(b));
  });

  it("does not let onIce array order change live physics", () => {
    const home = ["h-C", "h-LW", "h-RW", "h-LD", "h-RD", "h-G"];
    const away = ["a-C", "a-LW", "a-RW", "a-LD", "a-RD", "a-G"];
    const make = (onIce: { home: string[]; away: string[] }) =>
      createWorld({
        seed: 42,
        phase: "live",
        onIce,
        puck: { pos: { x: 0, y: 0 }, vel: { x: 18, y: -11 }, possessor: null },
        bodies: {
          "h-C": { vel: { x: 12, y: 6 } },
          "a-C": { vel: { x: -9, y: -7 } },
        },
      });
    const a = make({ home, away });
    const b = make({ home: [...home].reverse(), away: [...away].reverse() });
    const rngA = createRng(42);
    const rngB = createRng(42);
    for (let i = 0; i < 20; i++) {
      advanceWorld(a, dirs, rngA);
      advanceWorld(b, dirs, rngB);
    }
    expect(pose(a)).toEqual(pose(b));
  });

  it("keeps puck and players inside 200×85 ice with r=28 corners", () => {
    const shots: { puckVel: { x: number; y: number }; playerVel: { x: number; y: number } }[] = [
      { puckVel: { x: PUCK_MAX_SPEED, y: 0 }, playerVel: { x: SKATER_MAX_SPEED, y: 0 } },
      { puckVel: { x: -PUCK_MAX_SPEED, y: 0 }, playerVel: { x: -SKATER_MAX_SPEED, y: 0 } },
      { puckVel: { x: 0, y: PUCK_MAX_SPEED }, playerVel: { x: 0, y: SKATER_MAX_SPEED } },
      { puckVel: { x: 0, y: -PUCK_MAX_SPEED }, playerVel: { x: 0, y: -SKATER_MAX_SPEED } },
      { puckVel: { x: 110, y: 110 }, playerVel: { x: 28, y: 28 } },
      { puckVel: { x: -120, y: 90 }, playerVel: { x: -24, y: 20 } },
      { puckVel: { x: 90, y: -130 }, playerVel: { x: 16, y: -30 } },
    ];
    for (const shot of shots) {
      const world = createWorld({
        phase: "live",
        puck: { pos: { x: 0, y: 0 }, vel: shot.puckVel, possessor: null },
        bodies: {
          "h-C": { pos: { x: 10, y: 10 }, vel: shot.playerVel, heading: 0 },
        },
      });
      for (let i = 0; i < 60; i++) {
        advanceWorld(world, dirs, createRng(3 + i));
        assertInside(world);
      }
    }
  });

  it("awards possession when the puck is in stick reach of one player facing it", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: [] },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 4, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
    });
    advanceWorld(world, dirs, createRng(5));
    expect(world.puck.possessor).toBe("h-C");
    expect(world.lastEvents.some((e) => e.type === "PossessionChange")).toBe(true);
    expect(
      world.lastEvents.some(
        (e) => e.type === "Contact" && (e.payload as { kind?: string } | undefined)?.kind === "stick-puck",
      ),
    ).toBe(true);
  });

  it("does not award stick possession when the only in-reach player faces away", () => {
    const world = createWorld({
      phase: "live",
      onIce: { home: ["h-C"], away: [] },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI },
      },
      puck: { pos: { x: 4, y: 0 }, vel: { x: 0, y: 0 }, possessor: null, lastStick: null },
    });
    advanceWorld(world, dirs, createRng(5));
    expect(world.puck.possessor).toBeNull();
    expect(world.puck.lastStick).toBeNull();
    expect(
      world.lastEvents.some(
        (e) => e.type === "Contact" && (e.payload as { kind?: string } | undefined)?.kind === "stick-puck",
      ),
    ).toBe(false);
  });
});
