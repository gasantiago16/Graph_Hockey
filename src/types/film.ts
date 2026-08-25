export type ClipKind =
  | "goal"
  | "shot"
  | "save"
  | "turnover"
  | "penalty"
  | "pp"
  | "pk"
  | "icing"
  | "zone_entry"
  | "aar_cite"
  | "user";

export type Side = "home" | "away";
export type Zone = "DZ" | "NZ" | "OZ";

/** Minimal event the auto-clipper needs. Full match events are a superset. */
export interface ClipEvent {
  id: string;
  type: string;
  liveTick: number;
  zone?: Zone;
  playId?: string;
  side?: Side;
  xG?: number;
}

export interface Clip {
  id: string;
  matchId: string;
  seriesId?: string;
  gameIndex?: number;
  startLiveTick: number;
  endLiveTick: number;
  anchorEventId: string;
  relatedEventIds: string[];
  kind: ClipKind;
  title: string;
  side?: Side | "both";
  playId?: string;
  xG?: number;
  source: "auto" | "aar" | "user";
  signature?: string;
  note?: string;
}

export interface MatchAggregates {
  xgFor: number;
  xgAgainst: number;
  cfPct: number;
  zoneTimeOZ: number;
  zoneTimeDZ: number;
  turnovers: number;
  foPct: number;
  ppPct: number | null;
  pkPct: number | null;
  goalsFor: number;
  goalsAgainst: number;
}

export interface SeriesGameRow {
  matchId: string;
  gameIndex: number;
  score: { home: number; away: number };
  result: { home: "win" | "loss" | "tie"; away: "win" | "loss" | "tie" };
  playbookVersion: { home: number; away: number };
  aggregates: { home: MatchAggregates; away: MatchAggregates };
  clipCounts: Partial<Record<ClipKind, number>>;
  aarSummary?: { home: string; away: string };
}

export interface PairedClip {
  signature: string;
  playId: string;
  zone: Zone;
  early: Clip;
  late: Clip;
  metricHint: string;
}

export interface SeriesImprovement {
  seriesId: string;
  games: SeriesGameRow[];
  deltas: {
    home: Partial<MatchAggregates>;
    away: Partial<MatchAggregates>;
  };
  pairs: PairedClip[];
}

export const CLIP_WINDOWS: Record<Exclude<ClipKind, "user">, { before: number; after: number }> = {
  goal: { before: 40, after: 15 },
  shot: { before: 30, after: 10 },
  save: { before: 25, after: 10 },
  turnover: { before: 25, after: 10 },
  penalty: { before: 20, after: 10 },
  pp: { before: 10, after: 40 },
  pk: { before: 10, after: 40 },
  icing: { before: 20, after: 8 },
  zone_entry: { before: 20, after: 15 },
  aar_cite: { before: 30, after: 15 },
};

export const CLIP_PRIORITY: ClipKind[] = [
  "goal",
  "aar_cite",
  "shot",
  "save",
  "penalty",
  "turnover",
  "zone_entry",
  "icing",
  "pp",
  "pk",
  "user",
];

export const AUTO_CLIP_CAP = 40;
export const AUTO_PLUS_AAR_CAP = 48;
