import type { Db } from "../persist/db.ts";
import { listEvents } from "../persist/events.ts";
import { insertAarReport } from "../persist/matches.ts";
import { insertPlaybook, latestPlaybook } from "../persist/playbooks.ts";
import { applyPlaybookRevision } from "../playbook/mutate.ts";
import type { AarReport, AarResult } from "../types/aar.ts";
import type { MatchEvent } from "../types/events.ts";
import type { PlayMutation, Playbook, PlaybookRevision } from "../types/play.ts";
import { computeActual } from "./nodes/actual.ts";

export const AAR_MODES = ["auto", "propose", "hitl"] as const;
export type AarMode = (typeof AAR_MODES)[number];

export type ApplyAarResult = {
  applied: boolean;
  ops: PlayMutation[];
  rejectedOps: string[];
  revision: PlaybookRevision;
  playbook: Playbook;
  fromVersion: number;
  toVersion: number;
};

export function parseAarMode(raw: string | undefined): AarMode {
  if (raw === undefined || raw === "") return "auto";
  if (raw === "auto" || raw === "propose" || raw === "hitl") return raw;
  throw new Error(`invalid aar-mode '${raw}' (expected auto|propose|hitl)`);
}

/** Default auto-apply. `--no-llm` and `--aar-mode propose|hitl` never write playbook_versions. */
export function shouldApplyRevision(opts: { noLlm?: boolean; aarMode?: AarMode }): boolean {
  if (opts.noLlm === true) return false;
  return (opts.aarMode ?? "auto") === "auto";
}

export function persistAarReport(db: Db, report: AarReport, applied = false): void {
  insertAarReport(db, report.matchId, report.side, report, applied);
}

function emptyRevision(report: AarReport): PlaybookRevision {
  return report.revision ?? { summary: report.actualSummary?.slice(0, 1200) ?? "", ops: [] };
}

function ensureCurrentPlaybook(db: Db, teamId: string, playbook: Playbook): { version: number; body: Playbook } {
  const latest = latestPlaybook(db, teamId);
  if (latest) return { version: latest.version, body: latest.body };
  const version = playbook.version > 0 ? playbook.version : 1;
  const body = { ...playbook, teamId, version };
  insertPlaybook(db, { teamId, version, body, parentVersion: null, aarMatchId: null });
  return { version, body };
}

/**
 * Persist the AAR report. In auto mode, apply capped ops and write playbook version N+1.
 * Propose/hitl write the JSON and stop. Caps live in playbook/mutate.ts.
 */
export function applyAarRevision(opts: {
  db: Db;
  teamId: string;
  playbook: Playbook;
  report: AarReport;
  mode?: AarMode;
  events?: MatchEvent[];
  noLlm?: boolean;
}): ApplyAarResult {
  const mode = opts.mode ?? "auto";
  const revision = emptyRevision(opts.report);
  const current = ensureCurrentPlaybook(opts.db, opts.teamId, opts.playbook);

  if (!shouldApplyRevision({ noLlm: opts.noLlm, aarMode: mode })) {
    persistAarReport(opts.db, opts.report, false);
    return {
      applied: false,
      ops: revision.ops,
      rejectedOps: opts.report.rejectedOps ?? [],
      revision,
      playbook: current.body,
      fromVersion: current.version,
      toVersion: current.version,
    };
  }

  const events = opts.events ?? listEvents(opts.db, opts.report.matchId);
  const actual = computeActual(opts.report.matchId, events, opts.report.side);
  const result: AarResult = opts.report.result;
  const mutated = applyPlaybookRevision(current.body, revision, {
    result,
    knownEventIds: actual.knownEventIds.length > 0 ? actual.knownEventIds : events.map((e) => e.id),
    playUsage: actual.usage,
    mintEligible: actual.mintEligible,
    mintClusters: actual.mintClusters,
  });

  const rejectedOps = [...(opts.report.rejectedOps ?? []), ...mutated.rejected];
  const body: AarReport = {
    ...opts.report,
    revision: mutated.bumped ? { summary: revision.summary, ops: mutated.applied } : revision,
    rejectedOps,
  };

  if (mutated.bumped) {
    insertPlaybook(opts.db, {
      teamId: opts.teamId,
      version: mutated.book.version,
      body: { ...mutated.book, teamId: opts.teamId, version: mutated.book.version },
      parentVersion: current.version,
      aarMatchId: opts.report.matchId,
    });
  }

  persistAarReport(opts.db, body, mutated.bumped);
  return {
    applied: mutated.bumped,
    ops: mutated.bumped ? mutated.applied : revision.ops,
    rejectedOps,
    revision: body.revision ?? revision,
    playbook: mutated.bumped ? mutated.book : current.body,
    fromVersion: current.version,
    toVersion: mutated.bumped ? mutated.book.version : current.version,
  };
}

/** DESIGN library alias: apply capped revision and return the resulting book. */
export function applyRevision(
  db: Db,
  teamId: string,
  rev: PlaybookRevision,
  opts: {
    matchId: string;
    side: AarReport["side"];
    result: AarResult;
    playbook: Playbook;
    events?: MatchEvent[];
    mode?: AarMode;
  },
): Playbook {
  const report: AarReport = {
    matchId: opts.matchId,
    side: opts.side,
    result: opts.result,
    revision: rev,
  };
  return applyAarRevision({
    db,
    teamId,
    playbook: opts.playbook,
    report,
    mode: opts.mode ?? "auto",
    events: opts.events,
  }).playbook;
}
