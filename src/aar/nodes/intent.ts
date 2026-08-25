import { AarIntentOutputSchema } from "../../llm/schemas.ts";
import type { CoachIntent } from "../../types/directive.ts";
import type { AarGraphNode, AarGraphStateType } from "../state.ts";
import { invokeAarStructured } from "../llm.ts";

export type IntentOpts = { noLlm?: boolean };

function parseStoredIntent(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "supposedToHappen" in parsed) {
      const ci = parsed as CoachIntent;
      return `${ci.playId}: ${ci.supposedToHappen}`;
    }
  } catch {
    /* stored as plain text */
  }
  return raw;
}

export function codeIntentSummary(state: AarGraphStateType): string {
  const lines: string[] = [];
  for (const row of state.epochs ?? []) {
    if (row.side !== state.side) continue;
    const fromCoach = parseStoredIntent(row.coachIntent);
    const playId = row.directive?.playId;
    if (fromCoach) lines.push(`epoch ${row.seq} ${row.epochKind ?? ""} ${fromCoach}`);
    else if (playId) lines.push(`epoch ${row.seq} ${row.epochKind ?? ""} play ${playId} (${row.reason})`);
  }
  if (lines.length === 0) {
    const plays = [...new Set((state.eventLogDigest?.events ?? []).map((e) => e.playId).filter(Boolean))];
    return plays.length > 0
      ? `No stored coach intents. Plays seen: ${plays.join(", ")}.`
      : "No stored coach intents.";
  }
  return lines.slice(0, 24).join("\n");
}

function prompt(state: AarGraphStateType): string {
  return JSON.stringify({
    matchId: state.matchId,
    side: state.side,
    result: state.result,
    epochs: (state.epochs ?? []).slice(-20).map((e) => ({
      seq: e.seq,
      reason: e.reason,
      kind: e.epochKind,
      playId: e.directive?.playId,
      coachIntent: e.coachIntent,
    })),
    digestHead: (state.eventLogDigest?.events ?? []).slice(0, 12),
  });
}

const SYSTEM =
  "You are the post-game Head Coach. Answer: what was supposed to happen? " +
  "Summarize stored coachIntent + playIds from this match only. Do not invent events.";

export function makeIntent(opts: IntentOpts = {}): AarGraphNode {
  return async (state) => {
    const fallback = codeIntentSummary(state);
    if (opts.noLlm) return { intentSummary: fallback };
    const out = await invokeAarStructured(AarIntentOutputSchema, SYSTEM, prompt(state));
    return { intentSummary: out?.summary ?? fallback };
  };
}
