import type { Side } from "../types/hockey.ts";
import type { Db } from "./db.ts";
import { parseOpeningSnapshot, type OpeningSnapshot } from "./snapshot.ts";

export type MatchResultLabel = "home" | "away" | "tie";

export type MatchRow = {
  id: string;
  seed: number;
  startedAt: string;
  homeTeam: string;
  awayTeam: string;
  homePlaybookVersion: number;
  awayPlaybookVersion: number;
  finalHome: number | null;
  finalAway: number | null;
  result: string | null;
  snapshot: OpeningSnapshot;
};

type MatchSqlRow = {
  id: string;
  seed: number;
  started_at: string;
  home_team: string;
  away_team: string;
  home_playbook_version: number;
  away_playbook_version: number;
  final_home: number | null;
  final_away: number | null;
  result: string | null;
  config_json: string;
};

function asInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number.parseInt(v, 10);
  throw new Error(`expected integer, got ${typeof v}`);
}

function asNullableInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return asInt(v);
}

function rowToMatch(row: MatchSqlRow): MatchRow {
  return {
    id: String(row.id),
    seed: asInt(row.seed),
    startedAt: String(row.started_at),
    homeTeam: String(row.home_team),
    awayTeam: String(row.away_team),
    homePlaybookVersion: asInt(row.home_playbook_version),
    awayPlaybookVersion: asInt(row.away_playbook_version),
    finalHome: asNullableInt(row.final_home),
    finalAway: asNullableInt(row.final_away),
    result: row.result === null || row.result === undefined ? null : String(row.result),
    snapshot: parseOpeningSnapshot(row.config_json),
  };
}

export function insertMatch(db: Db, snap: OpeningSnapshot, startedAt: string = new Date().toISOString()): void {
  db.prepare(
    `INSERT INTO matches (
      id, seed, started_at, home_team, away_team,
      home_playbook_version, away_playbook_version,
      final_home, final_away, result, config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
  ).run(
    snap.matchId,
    snap.seed,
    startedAt,
    snap.homeTeamId,
    snap.awayTeamId,
    snap.homePlaybookVersion,
    snap.awayPlaybookVersion,
    JSON.stringify(snap),
  );
}

export function getMatch(db: Db, matchId: string): MatchRow | undefined {
  const row = db.prepare("SELECT * FROM matches WHERE id = ?").get<MatchSqlRow>(matchId);
  return row ? rowToMatch(row) : undefined;
}

export function listMatches(db: Db): MatchRow[] {
  return db.prepare("SELECT * FROM matches ORDER BY started_at ASC").all<MatchSqlRow>().map(rowToMatch);
}

export function loadOpeningSnapshot(db: Db, matchId: string): OpeningSnapshot {
  const match = getMatch(db, matchId);
  if (!match) throw new Error(`no match ${matchId}`);
  return match.snapshot;
}

export function finishMatch(
  db: Db,
  matchId: string,
  score: { home: number; away: number },
  result: MatchResultLabel,
): void {
  db.prepare("UPDATE matches SET final_home = ?, final_away = ?, result = ? WHERE id = ?").run(
    score.home,
    score.away,
    result,
    matchId,
  );
}

export function insertAarReport(db: Db, matchId: string, side: Side, body: unknown, applied: boolean): void {
  db.prepare(
    "INSERT OR REPLACE INTO aar_reports (match_id, side, body_json, applied) VALUES (?, ?, ?, ?)",
  ).run(matchId, side, JSON.stringify(body), applied ? 1 : 0);
}

export function getAarReport(
  db: Db,
  matchId: string,
  side: Side,
): { body: unknown; applied: boolean } | undefined {
  const row = db
    .prepare("SELECT body_json, applied FROM aar_reports WHERE match_id = ? AND side = ?")
    .get<{ body_json: string; applied: number }>(matchId, side);
  if (!row) return undefined;
  return { body: JSON.parse(String(row.body_json)), applied: asInt(row.applied) === 1 };
}
