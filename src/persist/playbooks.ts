import { parsePlaybook } from "../playbook/schema.ts";
import { loadPlaybook, SEED_TEAM_IDS } from "../playbook/store.ts";
import type { Playbook } from "../types/play.ts";
import type { Db } from "./db.ts";

export type PlaybookRow = {
  teamId: string;
  version: number;
  body: Playbook;
  parentVersion: number | null;
  aarMatchId: string | null;
};

type PlaybookSqlRow = {
  team_id: string;
  version: number;
  body_json: string;
  parent_version: number | null;
  aar_match_id: string | null;
};

function asInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number.parseInt(v, 10);
  throw new Error(`expected integer, got ${typeof v}`);
}

function rowToPlaybook(row: PlaybookSqlRow): PlaybookRow {
  return {
    teamId: String(row.team_id),
    version: asInt(row.version),
    body: parsePlaybook(JSON.parse(String(row.body_json))),
    parentVersion: row.parent_version === null || row.parent_version === undefined ? null : asInt(row.parent_version),
    aarMatchId: row.aar_match_id === null || row.aar_match_id === undefined ? null : String(row.aar_match_id),
  };
}

export function insertPlaybook(db: Db, row: PlaybookRow): void {
  db.prepare(
    `INSERT INTO playbooks (team_id, version, body_json, parent_version, aar_match_id)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.teamId, row.version, JSON.stringify(row.body), row.parentVersion, row.aarMatchId);
}

export function getPlaybook(db: Db, teamId: string, version: number): PlaybookRow | undefined {
  const row = db
    .prepare("SELECT * FROM playbooks WHERE team_id = ? AND version = ?")
    .get<PlaybookSqlRow>(teamId, version);
  return row ? rowToPlaybook(row) : undefined;
}

export function latestPlaybook(db: Db, teamId: string): PlaybookRow | undefined {
  const row = db
    .prepare("SELECT * FROM playbooks WHERE team_id = ? ORDER BY version DESC LIMIT 1")
    .get<PlaybookSqlRow>(teamId);
  return row ? rowToPlaybook(row) : undefined;
}

/** Copy JSON seeds into `playbooks(team, version=1)` when missing. */
export function ensureSeedPlaybooks(db: Db): void {
  for (const teamId of SEED_TEAM_IDS) {
    if (getPlaybook(db, teamId, 1)) continue;
    const body = loadPlaybook(teamId);
    insertPlaybook(db, {
      teamId,
      version: 1,
      body,
      parentVersion: null,
      aarMatchId: null,
    });
  }
}

export function insertScoutNote(
  db: Db,
  row: { teamId: string; aboutTeam: string; matchId?: string | null; note: unknown },
): void {
  db.prepare("INSERT INTO scout_notes (team_id, about_team, match_id, note_json) VALUES (?, ?, ?, ?)").run(
    row.teamId,
    row.aboutTeam,
    row.matchId ?? null,
    JSON.stringify(row.note),
  );
}

export function listScoutNotes(db: Db, teamId: string): { aboutTeam: string; matchId: string | null; note: unknown }[] {
  return db
    .prepare("SELECT about_team, match_id, note_json FROM scout_notes WHERE team_id = ?")
    .all<{ about_team: string; match_id: string | null; note_json: string }>(teamId)
    .map((r) => ({
      aboutTeam: String(r.about_team),
      matchId: r.match_id === null || r.match_id === undefined ? null : String(r.match_id),
      note: JSON.parse(String(r.note_json)),
    }));
}
