import { describe, expect, it } from "vitest";
import { GOAL_LINE_X } from "../engine/rink.ts";
import { createWorld } from "../engine/world.ts";
import { loadTeam } from "../playbook/store.ts";
import { SpectatorFrameSchema } from "../types/ws.ts";
import { jerseyNumber, maybeInspectState, spectatorFrame } from "./spectator.ts";

describe("spectatorFrame", () => {
  it("keeps period-1 home net at −X (world frame, not mirrored)", () => {
    const world = createWorld({
      matchId: "ice",
      period: 1,
      puck: { pos: { x: 22, y: 5 } },
    });
    const frame = spectatorFrame(world, {
      rosters: { home: loadTeam("original-six"), away: loadTeam("expansion") },
    });
    expect(SpectatorFrameSchema.parse(frame).players.length).toBe(12);
    const homeG = frame.players.find((p) => p.side === "home" && p.position === "G");
    const awayG = frame.players.find((p) => p.side === "away" && p.position === "G");
    expect(homeG?.x).toBeCloseTo(-GOAL_LINE_X, 5);
    expect(awayG?.x).toBeCloseTo(GOAL_LINE_X, 5);
    expect(frame.puck.x).toBe(22);
    expect(frame.puck.y).toBe(5);
  });

  it("maps jersey numbers from the roster line/position, not engine ids", () => {
    const world = createWorld({ period: 1 });
    const home = loadTeam("original-six");
    const away = loadTeam("expansion");
    const frame = spectatorFrame(world, { rosters: { home, away } });
    const homeC = frame.players.find((p) => p.side === "home" && p.position === "C");
    const bodyC = world.bodies["h-C"];
    expect(bodyC).toBeTruthy();
    expect(homeC?.number).toBe(jerseyNumber(bodyC!, { home, away }));
    expect(homeC?.number).toBe(
      home.players.find((p) => p.position === "C" && p.line === "F1")?.number,
    );
  });

  it("maybeInspectState is omitted for none and one-sided otherwise", () => {
    const world = createWorld({
      matchId: "inspect",
      playId: { home: "5v5-122-forecheck", away: "5v5-212-forecheck" },
    });
    expect(maybeInspectState(world, "none")).toBeUndefined();
    const home = maybeInspectState(world, "home");
    const away = maybeInspectState(world, "away");
    expect(home?.side).toBe("home");
    expect(home?.playId).toBe("5v5-122-forecheck");
    expect(JSON.stringify(home)).not.toContain("5v5-212-forecheck");
    expect(away?.playId).toBe("5v5-212-forecheck");
    expect(JSON.stringify(away)).not.toContain("5v5-122-forecheck");
  });
});
