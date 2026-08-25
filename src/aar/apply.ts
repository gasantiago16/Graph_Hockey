import type { Db } from "../persist/db.ts";
import { insertAarReport } from "../persist/matches.ts";
import type { AarReport } from "../types/aar.ts";
import type { PlayMutation, PlaybookRevision } from "../types/play.ts";

export type ApplyAarResult = {
  applied: false;
  ops: PlayMutation[];
  revision: PlaybookRevision;
};

/**
 * PR 14 applies caps in playbook/mutate.ts. This stub persists the report only
 * and never writes playbook_versions.
 */
export function applyAarRevision(revision: PlaybookRevision): ApplyAarResult {
  return { applied: false, ops: revision.ops, revision };
}

export function persistAarReport(db: Db, report: AarReport, applied = false): void {
  insertAarReport(db, report.matchId, report.side, report, applied);
}
