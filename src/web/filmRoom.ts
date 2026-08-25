import { DT } from "../engine/rink.ts";
import type { Clip } from "../types/film.ts";

export type FilmQuery = {
  matchId?: string;
  clipId?: string;
  eventId?: string;
  tick?: number;
};

function emptyToUndef(v: string | null): string | undefined {
  if (v === null || v === "") return undefined;
  return v;
}

/** Parse `/film?match=&clip=&event=&t=` (AAR Watch links use `event=`). */
export function parseFilmQuery(search: string): FilmQuery {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const q = new URLSearchParams(raw);
  const tRaw = q.get("t");
  const tick = tRaw !== null && tRaw !== "" ? Number.parseInt(tRaw, 10) : Number.NaN;
  return {
    matchId: emptyToUndef(q.get("match")),
    clipId: emptyToUndef(q.get("clip")),
    eventId: emptyToUndef(q.get("event")),
    tick: Number.isFinite(tick) ? tick : undefined,
  };
}

export function filmHref(query: FilmQuery): string {
  const q = new URLSearchParams();
  if (query.matchId) q.set("match", query.matchId);
  if (query.clipId) q.set("clip", query.clipId);
  if (query.eventId) q.set("event", query.eventId);
  if (query.tick !== undefined) q.set("t", String(query.tick));
  const s = q.toString();
  return s ? `/film?${s}` : "/film";
}

export function clipDurationSeconds(
  clip: Pick<Clip, "startLiveTick" | "endLiveTick">,
  dt: number = DT,
): number {
  return Math.max(dt, (clip.endLiveTick - clip.startLiveTick) * dt);
}

export function tickToProgress(
  clip: Pick<Clip, "startLiveTick" | "endLiveTick">,
  tick: number,
): number {
  const span = clip.endLiveTick - clip.startLiveTick;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (tick - clip.startLiveTick) / span));
}

export function progressToTick(
  clip: Pick<Clip, "startLiveTick" | "endLiveTick">,
  u: number,
): number {
  const span = clip.endLiveTick - clip.startLiveTick;
  const t = clip.startLiveTick + Math.round(Math.max(0, Math.min(1, u)) * span);
  return t;
}

export function frameIndexForTick(frames: readonly { liveTick: number }[], tick: number): number {
  if (frames.length === 0) return 0;
  let best = 0;
  for (let i = 0; i < frames.length; i++) {
    const live = frames[i]!.liveTick;
    if (live <= tick) best = i;
    else break;
  }
  return best;
}

export function stepFrameIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index + delta));
}

/** Virtual full-match tray item — same canvas as auto clips. */
export function trayFullClip(
  matchId: string,
  durationLiveTicks: number,
): Pick<Clip, "id" | "matchId" | "startLiveTick" | "endLiveTick" | "kind" | "title" | "source"> {
  return {
    id: `${matchId}:clip:full`,
    matchId,
    startLiveTick: 0,
    endLiveTick: durationLiveTicks,
    kind: "user",
    title: "Full recording",
    source: "user",
  };
}
