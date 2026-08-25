import { getAarReport, getMatch } from "../persist/matches.ts";
import {
  getPlaybook,
  getPlaybookByAarMatch,
  latestPlaybook,
  listPlaybookVersions,
  type PlaybookRow,
} from "../persist/playbooks.ts";
import { diffPlaybooks, type PlaybookDiff } from "../playbook/diff.ts";
import type { Db } from "../persist/db.ts";
import type { Side } from "../types/hockey.ts";
import type { Play } from "../types/play.ts";

function parseSide(raw: string): Side | undefined {
  if (raw === "home" || raw === "away") return raw;
  return undefined;
}

function wantDiff(raw: string | boolean | null | undefined): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw == null || raw === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export type JsonResponse = { status: number; body: unknown };

function playDigest(play: Play) {
  return {
    id: play.id,
    name: play.name,
    status: play.status,
    version: play.version,
    origin: play.origin,
    family: play.family,
    stats: play.stats,
  };
}

export function playbookPublicView(row: PlaybookRow) {
  return {
    teamId: row.teamId,
    version: row.version,
    parentVersion: row.parentVersion,
    aarMatchId: row.aarMatchId,
    plays: row.body.plays.map(playDigest),
  };
}

function asRecord(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return { ...(body as Record<string, unknown>) };
  }
  return {};
}

/** Stored AAR JSON for the operator UI. Drops playbook / digest; never env keys. */
export function publicAarPayload(
  db: Db,
  matchId: string,
  side: Side,
  row: { body: unknown; applied: boolean },
): Record<string, unknown> {
  const rec = asRecord(row.body);
  delete rec.playbook;
  delete rec.eventLogDigest;
  const match = getMatch(db, matchId);
  const teamId = match ? (side === "home" ? match.homeTeam : match.awayTeam) : undefined;
  const out: Record<string, unknown> = {
    matchId: typeof rec.matchId === "string" ? rec.matchId : matchId,
    side: rec.side === "home" || rec.side === "away" ? rec.side : side,
    result: rec.result,
    intentSummary: rec.intentSummary,
    actualSummary: rec.actualSummary,
    causes: rec.causes,
    lensNotes: rec.lensNotes,
    revision: rec.revision,
    rejectedOps: rec.rejectedOps,
    aggregates: rec.aggregates,
    noLlm: rec.noLlm,
    applied: row.applied,
  };
  if (teamId) out.teamId = teamId;
  if (match) {
    out.homeTeam = match.homeTeam;
    out.awayTeam = match.awayTeam;
    out.score = { home: match.finalHome, away: match.finalAway };
    out.matchResult = match.result;
  }
  return out;
}

export function aarApiResponse(db: Db, matchId: string, sideRaw: string): JsonResponse {
  if (matchId === "") return { status: 400, body: { error: "matchId required" } };
  const side = parseSide(sideRaw);
  if (!side) return { status: 400, body: { error: "side must be home or away" } };
  const row = getAarReport(db, matchId, side);
  if (!row) return { status: 404, body: { error: `no aar for ${matchId} ${side}` } };
  return { status: 200, body: publicAarPayload(db, matchId, side, row) };
}

function versionDiff(from: PlaybookRow, to: PlaybookRow): PlaybookDiff {
  const diff = diffPlaybooks(from.body, to.body);
  diff.teamId = to.teamId || from.teamId;
  diff.fromVersion = from.version;
  diff.toVersion = to.version;
  return diff;
}

export type PlaybookApiQuery = {
  diff?: boolean | string | null;
  version?: string | null;
  match?: string | null;
};

export function playbookApiResponse(db: Db, teamId: string, query: PlaybookApiQuery = {}): JsonResponse {
  if (teamId === "") return { status: 400, body: { error: "team required" } };
  const versions = listPlaybookVersions(db, teamId);
  const latest = versions.at(-1) ?? latestPlaybook(db, teamId);
  if (!latest) return { status: 404, body: { error: `no playbook for ${teamId}` } };

  const wantDiffFlag = wantDiff(query.diff);
  const matchId = query.match && query.match !== "" ? query.match : undefined;
  const versionRaw = query.version != null && query.version !== "" ? Number.parseInt(query.version, 10) : Number.NaN;
  const wantVersion = Number.isFinite(versionRaw) ? versionRaw : undefined;

  let target = latest;
  let from = versions.find((r) => r.version === target.version - 1) ?? versions[0] ?? target;

  if (wantVersion !== undefined) {
    const hit = versions.find((r) => r.version === wantVersion);
    if (!hit) return { status: 404, body: { error: `no ${teamId} version ${wantVersion}` } };
    target = hit;
    from = versions.find((r) => r.version === target.version - 1) ?? versions[0] ?? target;
  } else if (matchId) {
    const match = getMatch(db, matchId);
    if (!match) return { status: 404, body: { error: `no match ${matchId}` } };
    const isHome = match.homeTeam === teamId;
    const isAway = match.awayTeam === teamId;
    if (!isHome && !isAway) {
      return { status: 404, body: { error: `team ${teamId} not in match ${matchId}` } };
    }
    const bumped = getPlaybookByAarMatch(db, teamId, matchId);
    if (bumped) {
      target = bumped;
      from =
        (bumped.parentVersion !== null ? getPlaybook(db, teamId, bumped.parentVersion) : undefined) ??
        versions.find((r) => r.version === bumped.version - 1) ??
        versions[0] ??
        bumped;
    } else {
      const startVer = isHome ? match.homePlaybookVersion : match.awayPlaybookVersion;
      const start = getPlaybook(db, teamId, startVer) ?? latest;
      target = start;
      from = start;
    }
  }

  const payload: Record<string, unknown> = {
    ...playbookPublicView(target),
  };
  if (wantDiffFlag) {
    payload.diff = versionDiff(from, target);
  }
  return { status: 200, body: payload };
}
