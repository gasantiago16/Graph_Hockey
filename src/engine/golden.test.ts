import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { createRng } from "./rng.ts";
import { advanceWorld } from "./step.ts";
import { createWorld, defaultDirective } from "./world.ts";

const dirs = {
  home: defaultDirective(DEFAULT_PLAY_ID),
  away: defaultDirective(DEFAULT_PLAY_ID),
};

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/golden/pr4-scripted-seed42.json");

function digest(events: { type: string; liveTick: number; stoppageSeq: number; xG?: number }[]): string {
  const rows = events.map((e) => ({
    type: e.type,
    liveTick: e.liveTick,
    stoppageSeq: e.stoppageSeq,
    xG: e.xG ?? null,
  }));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function runScripted(seed: number) {
  const world = createWorld({
    matchId: "golden-pr4",
    seed,
    phase: "faceoff_drop",
    faceoffSpot: { x: 0, y: 0 },
  });
  const rng = createRng(seed);
  const events = [
    ...advanceWorld(world, dirs, rng),
  ];

  world.phase = "live";
  world.whistle = null;
  world.onIce = { home: ["h-C"], away: ["a-C"] };
  const hc = world.bodies["h-C"];
  const ac = world.bodies["a-C"];
  if (hc) {
    hc.pos = { x: 0, y: 30 };
    hc.vel = { x: 0, y: 0 };
    hc.heading = Math.PI;
  }
  if (ac) {
    ac.pos = { x: 0, y: -30 };
    ac.vel = { x: 0, y: 0 };
    ac.heading = 0;
  }
  world.puck.pos = { x: 88.4, y: 0 };
  world.puck.vel = { x: 20, y: 0 };
  world.puck.possessor = null;
  world.lastPuckContact = { kind: "stick-puck", playerId: "h-C", stickHeight: 3 };

  events.push(...advanceWorld(world, dirs, rng));
  events.push(...advanceWorld(world, dirs, rng));
  events.push(...advanceWorld(world, dirs, rng));
  return { world, events };
}

describe("golden fixture (scripted sequence)", () => {
  it("hashes a seed-42 faceoff → goal → faceoff sequence", () => {
    const { world, events } = runScripted(42);
    expect(world.score.home).toBe(1);
    expect(events.some((e) => e.type === "FaceoffWin")).toBe(true);
    expect(events.some((e) => e.type === "Goal")).toBe(true);
    const hash = digest(events);
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      seed: number;
      hash: string;
      types: string[];
    };
    expect(hash).toBe(fixture.hash);
    expect(events.map((e) => e.type)).toEqual(fixture.types);
  });

  it("is deterministic for the same seed", () => {
    const a = runScripted(42);
    const b = runScripted(42);
    expect(digest(a.events)).toBe(digest(b.events));
    expect(a.world.liveTick).toBe(b.world.liveTick);
    expect(a.world.stoppageSeq).toBe(b.world.stoppageSeq);
    expect(a.world.score).toEqual(b.world.score);
  });
});
