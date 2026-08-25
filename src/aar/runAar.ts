import { MemorySaver } from "@langchain/langgraph";
import { UsageTap, type MatchBudget } from "../llm/budgets.ts";
import type { Db } from "../persist/db.ts";
import { listEpochInvocations, listEvents } from "../persist/events.ts";
import type { MatchResultLabel } from "../persist/matches.ts";
import type { AarReport, AarResult } from "../types/aar.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Side } from "../types/hockey.ts";
import type { Playbook, PlaybookRevision } from "../types/play.ts";
import { AAR_RECURSION_LIMIT, aarThreadId, compileAarGraph, type CompiledAarGraph } from "./aarGraph.ts";
import { applyAarRevision, persistAarReport, shouldApplyRevision, type AarMode } from "./apply.ts";
import { computeActual } from "./nodes/actual.ts";
import { codeIntentSummary } from "./nodes/intent.ts";

export function sideResult(matchResult: MatchResultLabel, side: Side): AarResult {
  if (matchResult === "tie") return "tie";
  if (matchResult === side) return "win";
  return "loss";
}

function asRevision(raw: unknown): PlaybookRevision | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as { revision?: unknown };
  if (!rec.revision || typeof rec.revision !== "object") return undefined;
  const rev = rec.revision as PlaybookRevision;
  if (typeof rev.summary !== "string" || !Array.isArray(rev.ops)) return undefined;
  return rev;
}

function reportFromOutput(
  input: { matchId: string; side: Side; result: AarResult },
  out: Record<string, unknown>,
  extras: { noLlm?: boolean } = {},
): AarReport {
  return {
    matchId: input.matchId,
    side: input.side,
    result: input.result,
    intentSummary: typeof out.intentSummary === "string" ? out.intentSummary : undefined,
    actualSummary: typeof out.actualSummary === "string" ? out.actualSummary : undefined,
    causes: Array.isArray(out.causes) ? (out.causes as AarReport["causes"]) : undefined,
    lensNotes: typeof out.lensNotes === "string" ? out.lensNotes : undefined,
    revision: asRevision(out),
    rejectedOps: Array.isArray(out.rejectedOps) ? (out.rejectedOps as string[]) : undefined,
    aggregates: out.aggregates as AarReport["aggregates"],
    eventLogDigest: out.eventLogDigest as AarReport["eventLogDigest"],
    noLlm: extras.noLlm,
  };
}

/** Code-only AAR: digest + aggregates, no grok-4.5. */
export function codeOnlyAarReport(args: {
  matchId: string;
  side: Side;
  result: AarResult;
  events: readonly MatchEvent[];
  epochs?: { seq: number; side: Side; reason: string; epochKind?: string | null; coachIntent?: string | null; directive?: { playId: string } | null }[];
}): AarReport {
  const actual = computeActual(args.matchId, args.events, args.side);
  const intentSummary = codeIntentSummary({
    matchId: args.matchId,
    side: args.side,
    result: args.result,
    playbook: { teamId: "", version: 1, plays: [] },
    epochs: args.epochs as never,
    eventLogDigest: actual.digest,
  });
  return {
    matchId: args.matchId,
    side: args.side,
    result: args.result,
    intentSummary,
    actualSummary: actual.actualSummary,
    causes: [],
    revision: { summary: actual.actualSummary.slice(0, 1200) || "code-only AAR digest", ops: [] },
    rejectedOps: [],
    aggregates: actual.aggregates,
    eventLogDigest: actual.digest,
    noLlm: true,
  };
}

export type PostMatchAarOpts = {
  db: Db;
  matchId: string;
  matchResult: MatchResultLabel;
  homePlaybook: Playbook;
  awayPlaybook: Playbook;
  events?: MatchEvent[];
  noLlm?: boolean;
  /** Default auto. propose/hitl persist the report and do not bump playbook versions. */
  aarMode?: AarMode;
  budget?: MatchBudget;
  graph?: CompiledAarGraph;
  signal?: AbortSignal;
};

export async function runAarForSide(
  opts: PostMatchAarOpts & { side: Side; playbook: Playbook; graph: CompiledAarGraph },
): Promise<AarReport> {
  const result = sideResult(opts.matchResult, opts.side);
  const events = opts.events ?? listEvents(opts.db, opts.matchId);
  const epochs = listEpochInvocations(opts.db, opts.matchId).filter((e) => e.side === opts.side);
  const tap = opts.budget ? new UsageTap(opts.side, opts.budget) : undefined;
  const out = (await opts.graph.invoke(
    {
      matchId: opts.matchId,
      side: opts.side,
      result,
      playbook: opts.playbook,
      events,
      epochs,
    },
    {
      configurable: { thread_id: aarThreadId(opts.matchId, opts.side) },
      recursionLimit: AAR_RECURSION_LIMIT,
      signal: opts.signal,
      callbacks: tap ? [tap] : undefined,
    },
  )) as Record<string, unknown>;
  return reportFromOutput({ matchId: opts.matchId, side: opts.side, result }, out, { noLlm: opts.noLlm });
}

function finalizeSide(
  opts: PostMatchAarOpts,
  playbook: Playbook,
  report: AarReport,
  events: MatchEvent[],
): AarReport {
  const noLlm = opts.noLlm === true;
  if (!shouldApplyRevision({ noLlm, aarMode: opts.aarMode })) {
    persistAarReport(opts.db, report, false);
    return report;
  }
  const out = applyAarRevision({
    db: opts.db,
    teamId: playbook.teamId,
    playbook,
    report,
    mode: opts.aarMode ?? "auto",
    events,
    noLlm,
  });
  return {
    ...report,
    revision: out.revision,
    rejectedOps: out.rejectedOps,
  };
}

/**
 * Invoked twice after every result. `--no-llm` skips grok-4.5 and writes a code digest.
 * Auto-apply (default) writes playbook version N+1 unless `--aar-mode propose` / noLlm.
 */
export async function runPostMatchAar(opts: PostMatchAarOpts): Promise<{ home: AarReport; away: AarReport }> {
  const events = opts.events ?? listEvents(opts.db, opts.matchId);
  const noLlm = opts.noLlm === true;

  if (noLlm) {
    const epochs = listEpochInvocations(opts.db, opts.matchId);
    const home = codeOnlyAarReport({
      matchId: opts.matchId,
      side: "home",
      result: sideResult(opts.matchResult, "home"),
      events,
      epochs,
    });
    const away = codeOnlyAarReport({
      matchId: opts.matchId,
      side: "away",
      result: sideResult(opts.matchResult, "away"),
      events,
      epochs,
    });
    persistAarReport(opts.db, home, false);
    persistAarReport(opts.db, away, false);
    return { home, away };
  }

  const graph = opts.graph ?? compileAarGraph({ db: opts.db, checkpointer: new MemorySaver(), noLlm: false });
  const home = await runAarForSide({ ...opts, side: "home", playbook: opts.homePlaybook, graph, events });
  const away = await runAarForSide({ ...opts, side: "away", playbook: opts.awayPlaybook, graph, events });
  return {
    home: finalizeSide(opts, opts.homePlaybook, home, events),
    away: finalizeSide(opts, opts.awayPlaybook, away, events),
  };
}
