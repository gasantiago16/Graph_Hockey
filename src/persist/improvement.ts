import type { ClipKind, MatchAggregates } from "../types/film.ts";
import type { PlayMutation } from "../types/play.ts";
import type { Db } from "./db.ts";

export type ImprovementMetrics = {
  aggregates: MatchAggregates;
  clipCounts: Partial<Record<ClipKind, number>>;
  chanceCounts?: { shots: number; distinctChances: number; offsides: number };
  openingPlayId?: string;
  retrieveTopId?: string;
};

export type ImprovementRow = {
  seriesId: string;
  teamId: string;
  gameIndex: number;
  matchId: string;
  playbookVersionBefore: number;
  playbookVersionAfter: number;
  result: "win" | "loss" | "tie";
  metrics: ImprovementMetrics;
  aarOps: PlayMutation[] | unknown[];
  pairedClipIds?: string[] | null;
};

function asInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number.parseInt(v, 10);
  throw new Error(`expected integer, got ${typeof v}`);
}

export function insertImprovementRow(db: Db, row: ImprovementRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO improvement_ledger (
      series_id, team_id, game_index, match_id,
      playbook_version_before, playbook_version_after, result,
      metrics_json, aar_ops_json, paired_clip_ids_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.seriesId,
    row.teamId,
    row.gameIndex,
    row.matchId,
    row.playbookVersionBefore,
    row.playbookVersionAfter,
    row.result,
    JSON.stringify(row.metrics),
    JSON.stringify(row.aarOps),
    row.pairedClipIds ? JSON.stringify(row.pairedClipIds) : null,
  );
}

export function listImprovement(db: Db, seriesId: string): ImprovementRow[] {
  return db
    .prepare("SELECT * FROM improvement_ledger WHERE series_id = ? ORDER BY team_id ASC, game_index ASC")
    .all<Record<string, unknown>>(seriesId)
    .map((r) => {
      const resultRaw = String(r.result);
      const result = resultRaw === "win" || resultRaw === "loss" || resultRaw === "tie" ? resultRaw : "tie";
      const pairedRaw = r.paired_clip_ids_json;
      return {
        seriesId: String(r.series_id),
        teamId: String(r.team_id),
        gameIndex: asInt(r.game_index),
        matchId: String(r.match_id),
        playbookVersionBefore: asInt(r.playbook_version_before),
        playbookVersionAfter: asInt(r.playbook_version_after),
        result,
        metrics: JSON.parse(String(r.metrics_json)) as ImprovementMetrics,
        aarOps: JSON.parse(String(r.aar_ops_json)) as unknown[],
        pairedClipIds:
          pairedRaw === null || pairedRaw === undefined ? null : (JSON.parse(String(pairedRaw)) as string[]),
      };
    });
}
