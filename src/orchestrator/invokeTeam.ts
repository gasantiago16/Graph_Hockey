import { TeamDirectiveSchema, type TeamDirective } from "../types/directive.ts";
import type { TeamObservation } from "../types/observation.ts";
import type { Side } from "../types/hockey.ts";
import {
  EPOCH_TIMEOUT_MS,
  UsageTap,
  copyUsage,
  createBudget,
  emptyUsage,
  gameTripped,
  teamTripped,
  type MatchBudget,
  type TokenUsage,
} from "../llm/budgets.ts";

export type InvokableTeamGraph = {
  invoke: (
    input: {
      observation: TeamObservation;
      epochReason: string;
      epochKind: "macro" | "micro";
      lastDirective: TeamDirective;
    },
    config?: {
      configurable?: { thread_id?: string };
      signal?: AbortSignal;
      recursionLimit?: number;
      callbacks?: unknown[];
    },
  ) => Promise<unknown>;
};

export type TeamInvokeResult =
  | { ok: true; directive: TeamDirective; usage: TokenUsage; billed: boolean; threadId: string; coachIntent?: string }
  | {
      ok: false;
      directive: TeamDirective;
      reason: "timeout" | "circuit" | "parse" | "error";
      billed: boolean;
      usage: TokenUsage;
      threadId: string;
      coachIntent?: string;
    };

function parseCoachIntentText(out: unknown): string | undefined {
  if (!out || typeof out !== "object") return undefined;
  const ci = (out as { coachIntent?: unknown }).coachIntent;
  if (typeof ci === "string" && ci.trim()) return ci;
  if (ci && typeof ci === "object") {
    try {
      return JSON.stringify(ci);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function epochThreadId(matchId: string, side: Side, epochIndex: number): string {
  return `match:${matchId}:team:${side}:epoch:${epochIndex}`;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { name?: string; message?: string };
  if (rec.name === "AbortError" || rec.name === "TimeoutError") return true;
  return typeof rec.message === "string" && /abort|timeout/i.test(rec.message);
}

function parseDirective(out: unknown, fallback: TeamDirective): { directive: TeamDirective; ok: boolean } {
  if (!out || typeof out !== "object") return { directive: fallback, ok: false };
  const parsed = TeamDirectiveSchema.safeParse((out as { directive?: unknown }).directive);
  if (!parsed.success) return { directive: fallback, ok: false };
  return { directive: parsed.data, ok: true };
}

/**
 * Never throws. Independent AbortController per call. timeoutMs 0 = no abort.
 */
export async function invokeTeam(args: {
  graph: InvokableTeamGraph;
  side: Side;
  obs: TeamObservation;
  last: TeamDirective;
  epochIndex: number;
  matchId: string;
  budget: MatchBudget;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<TeamInvokeResult> {
  const threadId = epochThreadId(args.matchId, args.side, args.epochIndex);

  if (teamTripped(args.budget, args.side) || gameTripped(args.budget)) {
    return {
      ok: false,
      directive: args.last,
      reason: "circuit",
      billed: false,
      usage: emptyUsage(),
      threadId,
    };
  }

  const tap = new UsageTap(args.side, args.budget);

  const ac = new AbortController();
  const onExternalAbort = () => ac.abort();
  if (args.signal) {
    if (args.signal.aborted) ac.abort();
    else args.signal.addEventListener("abort", onExternalAbort);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (args.timeoutMs > 0) {
    timer = setTimeout(() => ac.abort(), args.timeoutMs);
  }

  try {
    const out = await args.graph.invoke(
      {
        observation: args.obs,
        epochReason: args.obs.epochReason,
        epochKind: args.obs.epochKind,
        lastDirective: args.last,
      },
      {
        configurable: { thread_id: threadId },
        signal: ac.signal,
        recursionLimit: 12,
        callbacks: [tap],
      },
    );
    const usage = copyUsage(tap.usage);
    const coachIntent = parseCoachIntentText(out);
    const parsed = parseDirective(out, args.last);
    if (!parsed.ok) {
      return {
        ok: false,
        directive: args.last,
        reason: "parse",
        billed: usage.calls > 0,
        usage,
        threadId,
        coachIntent,
      };
    }
    return { ok: true, directive: parsed.directive, usage, billed: usage.calls > 0, threadId, coachIntent };
  } catch (err) {
    const usage = copyUsage(tap.usage);
    const reason = ac.signal.aborted || isAbortError(err) ? "timeout" : "error";
    return { ok: false, directive: args.last, reason, billed: usage.calls > 0, usage, threadId };
  } finally {
    if (args.signal) args.signal.removeEventListener("abort", onExternalAbort);
    if (timer) clearTimeout(timer);
  }
}

export { createBudget, EPOCH_TIMEOUT_MS };
