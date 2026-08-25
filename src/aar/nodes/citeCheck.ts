import { EventIdSchema } from "../../types/ids.ts";
import { AAR_CITATION_REJECTED } from "../../types/aar.ts";
import type { PlayMutation, PlaybookRevision } from "../../types/play.ts";
import type { AarGraphStateType } from "../state.ts";

export type CiteCheckResult = {
  kept: PlayMutation[];
  rejectedOps: string[];
};

export function knownIdSet(ids: readonly string[] | undefined): Set<string> {
  return new Set(ids ?? []);
}

function eventIdsValid(ids: readonly string[] | undefined, known: Set<string>): boolean {
  if (!ids || ids.length === 0) return false;
  for (const id of ids) {
    if (EventIdSchema.safeParse(id).success !== true) return false;
    if (!known.has(id)) return false;
  }
  return true;
}

export function describeRejected(op: PlayMutation, reason: string): string {
  const play = "playId" in op ? op.playId : "basedOn" in op ? op.basedOn : op.op;
  const ids = op.eventIds?.join(",") ?? "";
  return `${op.op}:${play}:${reason}:${ids}`;
}

/** Drop any mutation whose eventIds are missing, empty, malformed, or not in this match. */
export function filterCitedOps(ops: readonly PlayMutation[], knownEventIds: readonly string[]): CiteCheckResult {
  const known = knownIdSet(knownEventIds);
  const kept: PlayMutation[] = [];
  const rejectedOps: string[] = [];
  for (const op of ops) {
    if (!eventIdsValid(op.eventIds, known)) {
      const reason = !op.eventIds?.length ? "missing" : "unknown";
      const line = describeRejected(op, reason);
      rejectedOps.push(line);
      console.warn(AAR_CITATION_REJECTED, line);
      continue;
    }
    kept.push(op);
  }
  return { kept, rejectedOps };
}

export function citeCheck(state: AarGraphStateType): Partial<AarGraphStateType> {
  const revision = state.revision;
  if (!revision) {
    return { rejectedOps: [] };
  }
  const { kept, rejectedOps } = filterCitedOps(revision.ops, state.knownEventIds ?? []);
  return {
    revision: { summary: revision.summary, ops: kept },
    rejectedOps,
  };
}
