import { computeActual } from "../aar/nodes/actual.ts";
import { sideResult } from "../aar/runAar.ts";
import { listClips, listClipsBySeries, listRecordingsBySeries, type RecordingRow } from "../persist/clips.ts";
import type { Db } from "../persist/db.ts";
import { listEvents } from "../persist/events.ts";
import { insertImprovementRow, listImprovement, type ImprovementMetrics, type ImprovementRow } from "../persist/improvement.ts";
import { getAarReport, getMatch, type MatchResultLabel } from "../persist/matches.ts";
import { latestPlaybook } from "../persist/playbooks.ts";
import { loadTeam } from "../playbook/store.ts";
import type { AarReport } from "../types/aar.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Clip, ClipKind, MatchAggregates, SeriesGameRow, SeriesImprovement } from "../types/film.ts";
import type { PlayMutation } from "../types/play.ts";
import { pairClips } from "./pairClips.ts";

const AGG_KEYS = [
  "xgFor",
  "xgAgainst",
  "cfPct",
  "zoneTimeOZ",
  "zoneTimeDZ",
  "turnovers",
  "foPct",
  "goalsFor",
  "goalsAgainst",
] as const;

export const EMPTY_AGGREGATES: MatchAggregates = {
  xgFor: 0,
  xgAgainst: 0,
  cfPct: 50,
  zoneTimeOZ: 0,
  zoneTimeDZ: 0,
  turnovers: 0,
  foPct: 50,
  ppPct: null,
  pkPct: null,
  goalsFor: 0,
  goalsAgainst: 0,
};

function deltaAggs(first: MatchAggregates, last: MatchAggregates): Partial<MatchAggregates> {
  const out: Partial<MatchAggregates> = {};
  for (const k of AGG_KEYS) {
    out[k] = Number((last[k] - first[k]).toFixed(3));
  }
  if (first.ppPct != null && last.ppPct != null) {
    out.ppPct = Number((last.ppPct - first.ppPct).toFixed(3));
  }
  if (first.pkPct != null && last.pkPct != null) {
    out.pkPct = Number((last.pkPct - first.pkPct).toFixed(3));
  }
  return out;
}

export function seriesImprovement(
  seriesId: string,
  games: SeriesGameRow[],
  clips: Clip[],
): SeriesImprovement {
  const ordered = [...games].sort((a, b) => a.gameIndex - b.gameIndex);
  if (ordered.length === 0) {
    return { seriesId, games: [], deltas: { home: {}, away: {} }, pairs: [] };
  }
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  return {
    seriesId,
    games: ordered,
    deltas: {
      home: deltaAggs(first.aggregates.home, last.aggregates.home),
      away: deltaAggs(first.aggregates.away, last.aggregates.away),
    },
    pairs: pairClips(clips, ordered.length),
  };
}

/** One-line record for the ledger / CLI. */
export function formatDelta(team: "home" | "away", improvement: SeriesImprovement): string {
  const d = improvement.deltas[team];
  const xgF = d.xgFor ?? 0;
  const xgA = d.xgAgainst ?? 0;
  const gf = d.goalsFor ?? 0;
  const ga = d.goalsAgainst ?? 0;
  const cf = d.cfPct ?? 0;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return `${team} Δ xG ${sign(xgF)}/${sign(xgA)}  G ${sign(gf)}/${sign(ga)}  CF% ${sign(cf)}`;
}

export function countClipKinds(clips: readonly Clip[]): Partial<Record<ClipKind, number>> {
  const out: Partial<Record<ClipKind, number>> = {};
  for (const c of clips) {
    out[c.kind] = (out[c.kind] ?? 0) + 1;
  }
  return out;
}

function asFinite(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function asNullablePct(n: unknown): number | null {
  if (n === null || n === undefined) return null;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function filmAggregates(raw: unknown, fallback: MatchAggregates = EMPTY_AGGREGATES): MatchAggregates {
  if (!raw || typeof raw !== "object") return fallback;
  const a = raw as Record<string, unknown>;
  return {
    xgFor: asFinite(a.xgFor, fallback.xgFor),
    xgAgainst: asFinite(a.xgAgainst, fallback.xgAgainst),
    cfPct: asFinite(a.cfPct, fallback.cfPct),
    zoneTimeOZ: asFinite(a.zoneTimeOZ, fallback.zoneTimeOZ),
    zoneTimeDZ: asFinite(a.zoneTimeDZ, fallback.zoneTimeDZ),
    turnovers: asFinite(a.turnovers, fallback.turnovers),
    foPct: asFinite(a.foPct, fallback.foPct),
    ppPct: "ppPct" in a ? asNullablePct(a.ppPct) : fallback.ppPct,
    pkPct: "pkPct" in a ? asNullablePct(a.pkPct) : fallback.pkPct,
    goalsFor: asFinite(a.goalsFor, fallback.goalsFor),
    goalsAgainst: asFinite(a.goalsAgainst, fallback.goalsAgainst),
  };
}

function aarOps(report: AarReport | undefined): PlayMutation[] {
  const ops = report?.revision?.ops;
  return Array.isArray(ops) ? ops : [];
}

function aarSummary(report: AarReport | undefined): string {
  const text = report?.actualSummary ?? report?.intentSummary ?? "";
  return text.slice(0, 400);
}

function teamLabel(id: string): string {
  try {
    return loadTeam(id).name;
  } catch {
    return id;
  }
}

function versionAfter(db: Db, teamId: string, before: number): number {
  return latestPlaybook(db, teamId)?.version ?? before;
}

function aggregatesForSide(
  report: AarReport | undefined,
  matchId: string,
  side: "home" | "away",
  events: readonly MatchEvent[] | undefined,
): MatchAggregates {
  if (report?.aggregates) return filmAggregates(report.aggregates);
  if (events && events.length > 0) return filmAggregates(computeActual(matchId, events, side).aggregates);
  return EMPTY_AGGREGATES;
}

export type RecordGameImprovementInput = {
  db: Db;
  seriesId: string;
  gameIndex: number;
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchResult: MatchResultLabel;
  playbookVersionBefore: { home: number; away: number };
  aar: { home: AarReport; away: AarReport };
  events?: readonly MatchEvent[];
};

function pairedIds(clips: Clip[], gameCount: number): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const p of pairClips(clips, gameCount)) {
    for (const id of [p.early.id, p.late.id]) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function buildSideRow(
  input: RecordGameImprovementInput,
  side: "home" | "away",
  teamId: string,
  before: number,
  after: number,
  clips: Clip[],
  seriesClips: Clip[],
): ImprovementRow {
  const report = input.aar[side];
  const metrics: ImprovementMetrics = {
    aggregates: aggregatesForSide(report, input.matchId, side, input.events),
    clipCounts: countClipKinds(clips.filter((c) => c.side === side || c.side === "both" || c.side === undefined)),
  };
  return {
    seriesId: input.seriesId,
    teamId,
    gameIndex: input.gameIndex,
    matchId: input.matchId,
    playbookVersionBefore: before,
    playbookVersionAfter: after,
    result: sideResult(input.matchResult, side),
    metrics,
    aarOps: aarOps(report),
    pairedClipIds: pairedIds(seriesClips, input.gameIndex + 1),
  };
}

/** After a series game's AAR, append one ledger row per team (DESIGN §16c). */
export function recordGameImprovement(input: RecordGameImprovementInput): {
  home: ImprovementRow;
  away: ImprovementRow;
} {
  const matchClips = listClips(input.db, input.matchId);
  const seriesClips = listClipsBySeries(input.db, input.seriesId);
  const home = buildSideRow(
    input,
    "home",
    input.homeTeamId,
    input.playbookVersionBefore.home,
    versionAfter(input.db, input.homeTeamId, input.playbookVersionBefore.home),
    matchClips,
    seriesClips,
  );
  const away = buildSideRow(
    input,
    "away",
    input.awayTeamId,
    input.playbookVersionBefore.away,
    versionAfter(input.db, input.awayTeamId, input.playbookVersionBefore.away),
    matchClips,
    seriesClips,
  );
  insertImprovementRow(input.db, home);
  insertImprovementRow(input.db, away);
  return { home, away };
}

export type SeriesRecordingMeta = {
  matchId: string;
  gameIndex: number;
  durationLiveTicks: number;
};

export type SeriesImprovementView = SeriesImprovement & {
  clips: Clip[];
  recordings: SeriesRecordingMeta[];
  ledger: ImprovementRow[];
  home: { id: string; name: string };
  away: { id: string; name: string };
};

function asReport(body: unknown): AarReport | undefined {
  if (!body || typeof body !== "object") return undefined;
  return body as AarReport;
}

function matchResultLabel(raw: string | null | undefined): MatchResultLabel {
  if (raw === "home" || raw === "away" || raw === "tie") return raw;
  return "tie";
}

function gameFromRecording(
  db: Db,
  rec: RecordingRow,
  homeId: string,
  awayId: string,
  ledgerByKey: Map<string, ImprovementRow>,
): SeriesGameRow {
  const gameIndex = rec.gameIndex ?? 0;
  const match = getMatch(db, rec.matchId);
  const homeReport = asReport(getAarReport(db, rec.matchId, "home")?.body);
  const awayReport = asReport(getAarReport(db, rec.matchId, "away")?.body);
  const events = homeReport?.aggregates && awayReport?.aggregates ? undefined : listEvents(db, rec.matchId);
  const homeLedger = ledgerByKey.get(`${homeId}:${gameIndex}`);
  const awayLedger = ledgerByKey.get(`${awayId}:${gameIndex}`);
  const resultRaw = matchResultLabel(match?.result);
  const homeAgg =
    homeLedger?.metrics.aggregates ?? aggregatesForSide(homeReport, rec.matchId, "home", events);
  const awayAgg =
    awayLedger?.metrics.aggregates ?? aggregatesForSide(awayReport, rec.matchId, "away", events);
  const clips = listClips(db, rec.matchId);
  const score = { home: match?.finalHome ?? 0, away: match?.finalAway ?? 0 };
  return {
    matchId: rec.matchId,
    gameIndex,
    score,
    result: {
      home: homeLedger?.result ?? sideResult(resultRaw, "home"),
      away: awayLedger?.result ?? sideResult(resultRaw, "away"),
    },
    playbookVersion: {
      home: homeLedger?.playbookVersionAfter ?? match?.homePlaybookVersion ?? 1,
      away: awayLedger?.playbookVersionAfter ?? match?.awayPlaybookVersion ?? 1,
    },
    aggregates: { home: homeAgg, away: awayAgg },
    clipCounts: countClipKinds(clips),
    aarSummary: {
      home: aarSummary(homeReport),
      away: aarSummary(awayReport),
    },
  };
}

function gamesFromLedger(db: Db, ledger: ImprovementRow[], homeId: string, awayId: string): SeriesGameRow[] {
  const byGame = new Map<number, { home?: ImprovementRow; away?: ImprovementRow }>();
  for (const row of ledger) {
    const slot = byGame.get(row.gameIndex) ?? {};
    if (row.teamId === homeId) slot.home = row;
    else if (row.teamId === awayId) slot.away = row;
    else if (!slot.home) slot.home = row;
    else slot.away = row;
    byGame.set(row.gameIndex, slot);
  }
  const games: SeriesGameRow[] = [];
  for (const gameIndex of [...byGame.keys()].sort((a, b) => a - b)) {
    const slot = byGame.get(gameIndex)!;
    const matchId = slot.home?.matchId ?? slot.away?.matchId ?? "";
    const match = matchId ? getMatch(db, matchId) : undefined;
    games.push({
      matchId,
      gameIndex,
      score: { home: match?.finalHome ?? 0, away: match?.finalAway ?? 0 },
      result: {
        home: slot.home?.result ?? "tie",
        away: slot.away?.result ?? "tie",
      },
      playbookVersion: {
        home: slot.home?.playbookVersionAfter ?? 1,
        away: slot.away?.playbookVersionAfter ?? 1,
      },
      aggregates: {
        home: slot.home?.metrics.aggregates ?? EMPTY_AGGREGATES,
        away: slot.away?.metrics.aggregates ?? EMPTY_AGGREGATES,
      },
      clipCounts: {
        ...(slot.home?.metrics.clipCounts ?? {}),
        ...(slot.away?.metrics.clipCounts ?? {}),
      },
    });
  }
  return games;
}

/** Rebuild the series board from recordings + ledger. */
export function loadSeriesImprovement(db: Db, seriesId: string): SeriesImprovementView | undefined {
  const recordings = listRecordingsBySeries(db, seriesId);
  const ledger = listImprovement(db, seriesId);
  if (recordings.length === 0 && ledger.length === 0) return undefined;

  const firstMatchId = recordings[0]?.matchId ?? ledger[0]?.matchId;
  const firstMatch = firstMatchId ? getMatch(db, firstMatchId) : undefined;
  const homeId = firstMatch?.homeTeam ?? "original-six";
  const awayId = firstMatch?.awayTeam ?? "expansion";
  const ledgerByKey = new Map(ledger.map((r) => [`${r.teamId}:${r.gameIndex}`, r]));

  const games =
    recordings.length > 0
      ? recordings.map((rec) => gameFromRecording(db, rec, homeId, awayId, ledgerByKey))
      : gamesFromLedger(db, ledger, homeId, awayId);
  const clips = listClipsBySeries(db, seriesId);
  const base = seriesImprovement(seriesId, games, clips);
  return {
    ...base,
    clips,
    recordings: recordings.map((r) => ({
      matchId: r.matchId,
      gameIndex: r.gameIndex ?? 0,
      durationLiveTicks: r.durationLiveTicks,
    })),
    ledger,
    home: { id: homeId, name: teamLabel(homeId) },
    away: { id: awayId, name: teamLabel(awayId) },
  };
}
