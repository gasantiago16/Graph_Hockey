import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spectatorFrame } from "../server/spectator.ts";
import { getClip, getRecording, listClips, type RecordingRow } from "../persist/clips.ts";
import type { Db } from "../persist/db.ts";
import { getEvent } from "../persist/events.ts";
import { replayMatch } from "../sim/replay.ts";
import { CLIP_WINDOWS, type Clip } from "../types/film.ts";
import type { SpectatorFrame } from "../types/ws.ts";

export const CLIP_CACHE_DIRNAME = "clip-cache";
export const FULL_CLIP_SUFFIX = "clip:full";

export function defaultClipCacheDir(root = process.cwd()): string {
  return join(root, "data", CLIP_CACHE_DIRNAME);
}

export function sanitizeClipCacheId(clipId: string): string {
  return clipId.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function clipCachePath(clipId: string, cacheDir: string = defaultClipCacheDir()): string {
  return join(cacheDir, `${sanitizeClipCacheId(clipId)}.jsonl`);
}

export function fullMatchClipId(matchId: string): string {
  return `${matchId}:${FULL_CLIP_SUFFIX}`;
}

export function isFullMatchClipId(matchId: string, clipId: string): boolean {
  return clipId === "full" || clipId === fullMatchClipId(matchId);
}

export function fullRecordingClip(recording: RecordingRow): Clip {
  return {
    id: fullMatchClipId(recording.matchId),
    matchId: recording.matchId,
    seriesId: recording.seriesId ?? undefined,
    gameIndex: recording.gameIndex ?? undefined,
    startLiveTick: 0,
    endLiveTick: recording.durationLiveTicks,
    anchorEventId: `${recording.matchId}:0`,
    relatedEventIds: [],
    kind: "user",
    title: "Full recording",
    source: "user",
    note: "Entire match window (not stored in the clip index)",
  };
}

export function* framesForWindow(
  matchId: string,
  startLiveTick: number,
  endLiveTick: number,
  db: Db,
): Generator<SpectatorFrame> {
  for (const world of replayMatch(matchId, db, { toTick: endLiveTick })) {
    if (world.liveTick < startLiveTick) continue;
    if (world.liveTick > endLiveTick) break;
    yield spectatorFrame(world);
  }
}

export function* framesForClip(clip: Clip, db: Db): Generator<SpectatorFrame> {
  yield* framesForWindow(clip.matchId, clip.startLiveTick, clip.endLiveTick, db);
}

export function readJsonlFrames(path: string): SpectatorFrame[] {
  const text = readFileSync(path, "utf8");
  const frames: SpectatorFrame[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    frames.push(JSON.parse(line) as SpectatorFrame);
  }
  return frames;
}

export function writeJsonlFrames(path: string, frames: readonly SpectatorFrame[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = frames.map((f) => JSON.stringify(f)).join("\n");
  writeFileSync(path, body.length > 0 ? `${body}\n` : "", "utf8");
}

export type MaterializeClipOpts = {
  /** Directory for `{clipId}.jsonl`. `false` skips the cache. */
  cacheDir?: string | false;
  force?: boolean;
};

/** First Film Room play lazily writes JSONL; later plays reuse it. */
export function materializeClipFrames(clip: Clip, db: Db, opts: MaterializeClipOpts = {}): SpectatorFrame[] {
  const cacheDir = opts.cacheDir === false ? undefined : (opts.cacheDir ?? defaultClipCacheDir());
  const path = cacheDir ? clipCachePath(clip.id, cacheDir) : undefined;
  if (path && !opts.force && existsSync(path)) {
    return readJsonlFrames(path);
  }
  const frames = [...framesForClip(clip, db)];
  if (path) writeJsonlFrames(path, frames);
  return frames;
}

export function resolveClip(db: Db, matchId: string, clipId: string): Clip | undefined {
  if (isFullMatchClipId(matchId, clipId)) {
    const recording = getRecording(db, matchId);
    return recording ? fullRecordingClip(recording) : undefined;
  }
  const clip = getClip(db, clipId);
  if (!clip || clip.matchId !== matchId) return undefined;
  return clip;
}

export type EventFootage = {
  matchId: string;
  liveTick: number;
  eventId: string;
  clipId?: string;
  ephemeral?: Clip;
};

function matchIdFromEventId(eventId: string): string | undefined {
  const i = eventId.lastIndexOf(":");
  if (i <= 0) return undefined;
  return eventId.slice(0, i);
}

/** Prefer a stored clip that cites or covers the event; else a 30+15 ephemeral window. */
export function resolveEventFootage(db: Db, eventId: string): EventFootage | undefined {
  const event = getEvent(db, eventId);
  if (!event) return undefined;
  const matchId = matchIdFromEventId(event.id) ?? matchIdFromEventId(eventId);
  if (!matchId) return undefined;
  const clips = listClips(db, matchId);
  const cited = clips.find((c) => c.relatedEventIds.includes(eventId) || c.anchorEventId === eventId);
  if (cited) {
    return { matchId, liveTick: event.liveTick, eventId, clipId: cited.id };
  }
  const covering = clips.find((c) => event.liveTick >= c.startLiveTick && event.liveTick <= c.endLiveTick);
  if (covering) {
    return { matchId, liveTick: event.liveTick, eventId, clipId: covering.id };
  }
  const recording = getRecording(db, matchId);
  const duration = recording?.durationLiveTicks ?? event.liveTick + CLIP_WINDOWS.aar_cite.after;
  const start = Math.max(0, event.liveTick - CLIP_WINDOWS.aar_cite.before);
  const end = Math.min(duration, event.liveTick + CLIP_WINDOWS.aar_cite.after);
  const ephemeral: Clip = {
    id: `${matchId}:clip:event:${eventId.replace(/[^A-Za-z0-9._-]+/g, "_")}`,
    matchId,
    startLiveTick: start,
    endLiveTick: end,
    anchorEventId: eventId,
    relatedEventIds: [eventId],
    kind: "aar_cite",
    title: `Event ${event.type} @ ${event.liveTick}`,
    source: "aar",
    note: "Ephemeral window — not persisted",
  };
  return { matchId, liveTick: event.liveTick, eventId, ephemeral };
}

export function framesToJsonl(frames: readonly SpectatorFrame[]): string {
  if (frames.length === 0) return "";
  return `${frames.map((f) => JSON.stringify(f)).join("\n")}\n`;
}
