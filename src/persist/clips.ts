import type { Clip, ClipKind } from "../types/film.ts";
import type { Db } from "./db.ts";

export type RecordingRow = {
  matchId: string;
  seriesId?: string | null;
  gameIndex?: number | null;
  recordedAt: string;
  durationLiveTicks: number;
};

type ClipSqlRow = {
  id: string;
  match_id: string;
  series_id: string | null;
  start_live_tick: number;
  end_live_tick: number;
  anchor_event_id: string;
  related_event_ids_json: string;
  kind: string;
  title: string;
  side: string | null;
  play_id: string | null;
  xg: number | null;
  source: string;
  signature: string | null;
  note: string | null;
  created_at: string;
};

function asInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number.parseInt(v, 10);
  throw new Error(`expected integer, got ${typeof v}`);
}

function asNullableNumber(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number.parseFloat(v);
  return undefined;
}

export function insertRecording(db: Db, row: RecordingRow): void {
  db.prepare(
    `INSERT INTO recordings (match_id, series_id, game_index, recorded_at, duration_live_ticks)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.matchId, row.seriesId ?? null, row.gameIndex ?? null, row.recordedAt, row.durationLiveTicks);
}

export function getRecording(db: Db, matchId: string): RecordingRow | undefined {
  const row = db.prepare("SELECT * FROM recordings WHERE match_id = ?").get<Record<string, unknown>>(matchId);
  if (!row) return undefined;
  return {
    matchId: String(row.match_id),
    seriesId: row.series_id === null || row.series_id === undefined ? null : String(row.series_id),
    gameIndex: row.game_index === null || row.game_index === undefined ? null : asInt(row.game_index),
    recordedAt: String(row.recorded_at),
    durationLiveTicks: asInt(row.duration_live_ticks),
  };
}

export function insertClip(db: Db, clip: Clip, createdAt: string = new Date().toISOString()): void {
  db.prepare(
    `INSERT INTO clips (
      id, match_id, series_id, start_live_tick, end_live_tick, anchor_event_id,
      related_event_ids_json, kind, title, side, play_id, xg, source, signature, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clip.id,
    clip.matchId,
    clip.seriesId ?? null,
    clip.startLiveTick,
    clip.endLiveTick,
    clip.anchorEventId,
    JSON.stringify(clip.relatedEventIds),
    clip.kind,
    clip.title,
    clip.side ?? null,
    clip.playId ?? null,
    clip.xG ?? null,
    clip.source,
    clip.signature ?? null,
    clip.note ?? null,
    createdAt,
  );
}

function rowToClip(row: ClipSqlRow): Clip {
  const related = JSON.parse(String(row.related_event_ids_json)) as string[];
  const sideRaw = row.side === null || row.side === undefined ? undefined : String(row.side);
  const side = sideRaw === "home" || sideRaw === "away" || sideRaw === "both" ? sideRaw : undefined;
  const source = row.source === "aar" || row.source === "user" ? row.source : "auto";
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    seriesId: row.series_id === null || row.series_id === undefined ? undefined : String(row.series_id),
    startLiveTick: asInt(row.start_live_tick),
    endLiveTick: asInt(row.end_live_tick),
    anchorEventId: String(row.anchor_event_id),
    relatedEventIds: related,
    kind: String(row.kind) as ClipKind,
    title: String(row.title),
    side,
    playId: row.play_id === null || row.play_id === undefined ? undefined : String(row.play_id),
    xG: asNullableNumber(row.xg),
    source,
    signature: row.signature === null || row.signature === undefined ? undefined : String(row.signature),
    note: row.note === null || row.note === undefined ? undefined : String(row.note),
  };
}

export function listClips(db: Db, matchId: string): Clip[] {
  return db
    .prepare("SELECT * FROM clips WHERE match_id = ? ORDER BY start_live_tick ASC")
    .all<ClipSqlRow>(matchId)
    .map(rowToClip);
}
