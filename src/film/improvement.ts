import { pairClips } from "./pairClips.ts";
import type { Clip, MatchAggregates, SeriesGameRow, SeriesImprovement } from "../types/film.ts";

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
