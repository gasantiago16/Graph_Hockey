import { describe, expect, it } from "vitest";
import { createWorld } from "../engine/world.ts";
import { observe } from "./observe.ts";

const decision = { kind: "macro" as const, reason: "faceoff" as const };

describe("observe mirror", () => {
  it("home and away puck.pos.x sum to ~0 at the same liveTick", () => {
    const world = createWorld({
      liveTick: 12,
      attackingDir: { home: 1, away: -1 },
      puck: { pos: { x: 12, y: 4 }, vel: { x: 3, y: -1 }, possessor: "h-C" },
      playId: { home: "5v5-122-forecheck", away: "secret-away-play" },
    });
    const home = observe(world, "home", decision);
    const away = observe(world, "away", decision);
    expect(home.puck.pos.x + away.puck.pos.x).toBeCloseTo(0, 10);
    expect(home.puck.vel.x + away.puck.vel.x).toBeCloseTo(0, 10);
    expect(home.puck.pos.y).toBeCloseTo(away.puck.pos.y, 10);
  });

  it("mirrors heading so facing x-components differ by π", () => {
    const world = createWorld({
      attackingDir: { home: 1, away: -1 },
      puck: { pos: { x: 8, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
    });
    const hc = world.bodies["h-C"];
    expect(hc).toBeTruthy();
    hc!.heading = 0;
    const home = observe(world, "home", decision);
    const away = observe(world, "away", decision);
    const homeC = home.players.find((p) => p.id === "h-C");
    const awayView = away.players.find((p) => p.id === "h-C");
    expect(homeC).toBeTruthy();
    expect(awayView).toBeTruthy();
    expect(Math.cos(homeC!.heading)).toBeCloseTo(1, 8);
    expect(Math.cos(awayView!.heading)).toBeCloseTo(-1, 8);
    expect(homeC!.side).toBe("us");
    expect(awayView!.side).toBe("them");
  });

  it("does not leak the opponent playId or assignments", () => {
    const world = createWorld({
      playId: { home: "5v5-122-forecheck", away: "secret-away-play" },
    });
    const home = observe(world, "home", decision);
    const dumped = JSON.stringify(home);
    expect(dumped).not.toContain("secret-away-play");
    expect(home.activePlay.id).toBe("5v5-122-forecheck");
    expect(home.ourAssignments.every((a) => a.playerId.startsWith("h-"))).toBe(true);
    expect("playId" in home).toBe(false);
  });
});
