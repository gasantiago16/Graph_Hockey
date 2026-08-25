import { describe, expect, it } from "vitest";
import {
  BODY_RESTITUTION,
  collideBodies,
  collidePuckPlayers,
  collideRink,
  PUCK_BOARD_RESTITUTION,
  PUCK_GOALIE_RESTITUTION,
  PUCK_RADIUS,
  STICK_REACH,
  updatePossession,
} from "./physics.ts";
import { createRng } from "./rng.ts";
import { isInsideRink } from "./rink.ts";
import { createWorld, GOALIE_RADIUS, onIceBodies, SKATER_RADIUS, type Body } from "./world.ts";

function skater(partial: Partial<Body> & Pick<Body, "id">): Body {
  return {
    side: "home",
    position: "C",
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    heading: 0,
    radius: SKATER_RADIUS,
    mass: 1,
    ...partial,
  };
}

describe("physics collisions", () => {
  it("separates overlapping skaters with body restitution", () => {
    const a = skater({ id: "h-C", pos: { x: 0, y: 0 } });
    const b = skater({ id: "a-C", side: "away", pos: { x: 1, y: 0 } });
    const contacts = collideBodies([a, b]);
    expect(dist(a.pos, b.pos)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-6);
    expect(contacts.some((c) => c.kind === "body-body")).toBe(true);
  });

  it("reflects a puck off the end boards", () => {
    const pos = { x: 99.9, y: 0 };
    const vel = { x: 40, y: 0 };
    collideRink(pos, vel, PUCK_RADIUS, PUCK_BOARD_RESTITUTION);
    expect(isInsideRink(pos, PUCK_RADIUS)).toBe(true);
    expect(vel.x).toBeLessThan(0);
  });

  it("keeps a disk inside a corner quarter-circle", () => {
    const pos = { x: 95, y: 40 };
    const vel = { x: 20, y: 20 };
    collideRink(pos, vel, SKATER_RADIUS, BODY_RESTITUTION);
    expect(isInsideRink(pos, SKATER_RADIUS)).toBe(true);
  });
});

describe("stick possession", () => {
  it("awards the puck to a player in stick reach facing it", () => {
    const world = createWorld({
      onIce: { home: ["h-C"], away: [] },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 4, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
    });
    expect(4).toBeLessThanOrEqual(STICK_REACH);
    updatePossession(world, createRng(1));
    expect(world.puck.possessor).toBe("h-C");
    expect(world.puck.lastStick).toBe("h-C");
  });

  it("does not award possession when in reach but not facing", () => {
    const world = createWorld({
      onIce: { home: ["h-C"], away: [] },
      bodies: {
        "h-C": { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI },
      },
      puck: { pos: { x: 4, y: 0 }, vel: { x: 0, y: 0 }, possessor: null, lastStick: "a-C" },
    });
    updatePossession(world, createRng(1));
    expect(world.puck.possessor).toBeNull();
    expect(world.puck.lastStick).toBe("a-C");
  });

  it("breaks a facing-distance tie with RNG (same seed → same winner)", () => {
    const make = () =>
      createWorld({
        onIce: { home: ["h-C"], away: ["a-C"] },
        bodies: {
          "h-C": { pos: { x: -4, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
          "a-C": { pos: { x: 4, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI },
        },
        puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
      });
    const a = make();
    const b = make();
    updatePossession(a, createRng(99));
    updatePossession(b, createRng(99));
    expect(a.puck.possessor).toBe(b.puck.possessor);
    expect(a.puck.possessor === "h-C" || a.puck.possessor === "a-C").toBe(true);
  });

  it("consumes RNG on a facing-distance tie (stub next picks each side)", () => {
    const make = () =>
      createWorld({
        onIce: { home: ["h-C"], away: ["a-C"] },
        bodies: {
          "h-C": { pos: { x: -4, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
          "a-C": { pos: { x: 4, y: 0 }, vel: { x: 0, y: 0 }, heading: Math.PI },
        },
        puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
      });
    const first = make();
    const second = make();
    updatePossession(first, { next: () => 0 });
    updatePossession(second, { next: () => 0.99 });
    expect(first.puck.possessor).not.toBe(second.puck.possessor);
    expect(new Set([first.puck.possessor, second.puck.possessor])).toEqual(new Set(["a-C", "h-C"]));
  });
});

describe("puck-goalie rebounds", () => {
  it("reflects with restitution 0.35", () => {
    expect(PUCK_GOALIE_RESTITUTION).toBe(0.35);
    const world = createWorld({
      onIce: { home: ["h-G"], away: [] },
      bodies: {
        "h-G": { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, heading: 0 },
      },
      puck: { pos: { x: 1.5, y: 0 }, vel: { x: -24, y: 0 }, possessor: null },
    });
    collidePuckPlayers(world);
    expect(world.puck.vel.x).toBeGreaterThan(0);
  });
});

describe("body sizes", () => {
  it("uses skater 1.6 / goalie 1.8 radii and 1.0 / 1.2 masses", () => {
    const world = createWorld();
    const sk = world.bodies["h-C"];
    const g = world.bodies["h-G"];
    expect(sk?.radius).toBe(SKATER_RADIUS);
    expect(g?.radius).toBe(GOALIE_RADIUS);
    expect(sk?.mass).toBe(1);
    expect(g?.mass).toBe(1.2);
    expect(onIceBodies(world)).toHaveLength(12);
  });
});

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
