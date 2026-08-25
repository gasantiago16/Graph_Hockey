import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { compileTeamGraph } from "../agents/teamGraph.ts";
import { scaledOtSeconds } from "../config.ts";
import { runMatch } from "../orchestrator/match.ts";
import { getFootage } from "../persist/clips.ts";
import { openMemoryDb } from "../persist/db.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { SpectatorFrameSchema } from "../types/ws.ts";
import {
  framesForWindow,
  framesToJsonl,
  fullRecordingClip,
  materializeClipFrames,
  resolveClip,
  resolveEventFootage,
} from "./frames.ts";

const SHORT = 5;

async function sim(matchId: string) {
  const db = await openMemoryDb();
  const homePlaybook = loadPlaybook("original-six");
  const awayPlaybook = loadPlaybook("expansion");
  const result = await runMatch({
    matchId,
    seed: 42,
    homeTeamId: "original-six",
    awayTeamId: "expansion",
    homePlaybook,
    awayPlaybook,
    homeGraph: compileTeamGraph({
      side: "home",
      playbook: homePlaybook,
      checkpointer: new MemorySaver(),
      noLlm: true,
    }),
    awayGraph: compileTeamGraph({
      side: "away",
      playbook: awayPlaybook,
      checkpointer: new MemorySaver(),
      noLlm: true,
    }),
    db,
    periodSeconds: SHORT,
    otSeconds: scaledOtSeconds(SHORT),
    startedAt: "2026-08-24T00:00:00.000Z",
    timeoutMs: 2000,
    noLlm: true,
  });
  return { db, result };
}

describe("framesForClip / footage resolve", () => {
  it("resimulates a window into SpectatorFrames and caches JSONL", async () => {
    const { db, result } = await sim("film-frames");
    try {
      const footage = getFootage(db, "film-frames");
      expect(footage).toBeTruthy();
      expect(footage!.recording.durationLiveTicks).toBe(result.liveTick);
      const clip = resolveClip(db, "film-frames", "full");
      expect(clip?.title).toBe("Full recording");
      const end = Math.min(12, result.liveTick);
      const frames = [...framesForWindow("film-frames", 0, end, db)];
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) {
        expect(SpectatorFrameSchema.parse(frame).matchId).toBe("film-frames");
        expect(frame.liveTick).toBeGreaterThanOrEqual(0);
        expect(frame.liveTick).toBeLessThanOrEqual(end);
      }
      const cacheDir = mkdtempSync(join(tmpdir(), "gh-clip-cache-"));
      const windowClip = fullRecordingClip({
        matchId: "film-frames",
        recordedAt: "2026-08-24T00:00:00.000Z",
        durationLiveTicks: end,
      });
      windowClip.endLiveTick = end;
      const first = materializeClipFrames(windowClip, db, { cacheDir });
      expect(first.length).toBe(frames.length);
      const jsonlPath = join(cacheDir, "film-frames_clip_full.jsonl");
      expect(existsSync(jsonlPath)).toBe(true);
      const second = materializeClipFrames(windowClip, db, { cacheDir });
      expect(second).toEqual(first);
      expect(framesToJsonl(first).split("\n").filter(Boolean).length).toBe(first.length);
    } finally {
      db.close();
    }
  });

  it("resolves an eventId to a tick (clip or ephemeral window)", async () => {
    const { db, result } = await sim("film-event");
    try {
      const ev = result.events[0];
      expect(ev).toBeTruthy();
      const resolved = resolveEventFootage(db, ev!.id);
      expect(resolved?.matchId).toBe("film-event");
      expect(resolved?.liveTick).toBe(ev!.liveTick);
      expect(resolved?.clipId || resolved?.ephemeral).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
