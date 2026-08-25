import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createRng } from "../engine/rng.ts";
import { advanceWorld } from "../engine/step.ts";
import { insertEvents } from "../persist/events.ts";
import { insertMatch } from "../persist/matches.ts";
import { openMemoryDb } from "../persist/db.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { defaultDirective, type WorldState } from "../engine/world.ts";
import {
  collectReplayEvents,
  eventStreamHash,
  pushDirectiveApplied,
  replayMatch,
  worldFromSnapshot,
} from "./replay.ts";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/golden/pr7-replay-seed42.json");

const LIVE_AFTER_FACEOFF = 24;
const DIRECTIVE_LIVE = 12;
/** Faceoff drop + live ticks; DirectiveApplied is not an `advanceWorld` call. */
const ADVANCE_STEPS = 1 + LIVE_AFTER_FACEOFF + DIRECTIVE_LIVE;

function runScripted(seed: number, matchId: string) {
  const snap = makeOpeningSnapshot({ matchId, seed });
  const world = worldFromSnapshot(snap);
  const rng = createRng(seed);
  let home = defaultDirective(DEFAULT_PLAY_ID);
  let away = defaultDirective(DEFAULT_PLAY_ID);
  const events = [...advanceWorld(world, { home, away }, rng)];

  for (let i = 0; i < LIVE_AFTER_FACEOFF; i++) {
    events.push(...advanceWorld(world, { home, away }, rng));
  }

  home = { playId: "5v5-122-forecheck", pressure: "aggressive" };
  events.push(pushDirectiveApplied(world, "home", home));

  for (let i = 0; i < DIRECTIVE_LIVE; i++) {
    events.push(...advanceWorld(world, { home, away }, rng));
  }

  return { snap, world, events };
}

describe("replayMatch (LLM-free resimulation)", () => {
  it("inserts events and reproduces the seed-42 event hash", async () => {
    const db = await openMemoryDb();
    try {
      const { snap, events, world } = runScripted(42, "golden-pr7");
      insertMatch(db, snap, "2026-08-24T00:00:00.000Z");
      insertEvents(db, snap.matchId, events, world.clockRemaining);

      const replayed = collectReplayEvents(snap.matchId, db, { maxIters: ADVANCE_STEPS });
      const hash = eventStreamHash(events);
      expect(eventStreamHash(replayed)).toBe(hash);
      expect(replayed.map((e) => e.type)).toEqual(events.map((e) => e.type));
      expect(replayed.some((e) => e.type === "DirectiveApplied")).toBe(true);
      expect(replayed.some((e) => e.type === "FaceoffWin")).toBe(true);
      expect(replayed.every((e) => e.id === `${snap.matchId}:${e.seq}`)).toBe(true);

      const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
        seed: number;
        matchId: string;
        hash: string;
        count: number;
        types: string[];
      };
      expect(hash).toBe(fixture.hash);
      expect(events.length).toBe(fixture.count);
      expect(events.map((e) => e.type)).toEqual(fixture.types);
    } finally {
      db.close();
    }
  });

  it("is a Generator<WorldState> and does not need XAI_API_KEY", async () => {
    const db = await openMemoryDb();
    try {
      const { snap, events } = runScripted(7, "replay-gen");
      insertMatch(db, snap, "2026-08-24T00:00:00.000Z");
      insertEvents(db, snap.matchId, events);
      const gen = replayMatch(snap.matchId, db, { maxIters: 8 });
      expect(typeof gen.next).toBe("function");
      const first = gen.next();
      expect(first.done).toBe(false);
      const opening = first.value as WorldState;
      expect(opening.phase).toBe("faceoff_drop");
      expect(opening.seed).toBe(7);
      const second = gen.next();
      expect(second.value?.phase).toBe("live");
    } finally {
      db.close();
    }
  });

  it("seeded faceoff winner varies across seeds", () => {
    const winner = (seed: number) => {
      const snap = makeOpeningSnapshot({ matchId: `seed-${seed}`, seed });
      const world = worldFromSnapshot(snap);
      const dirs = { home: defaultDirective(DEFAULT_PLAY_ID), away: defaultDirective(DEFAULT_PLAY_ID) };
      advanceWorld(world, dirs, createRng(seed));
      return world.puck.possessor;
    };
    const winners = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 42, 43].map(winner));
    expect(winners.size).toBeGreaterThan(1);
  });
});
