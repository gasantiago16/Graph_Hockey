import { AarWhyOutputSchema } from "../../llm/schemas.ts";
import { EventIdSchema } from "../../types/ids.ts";
import type { AarCause } from "../../types/aar.ts";
import type { AarGraphNode } from "../state.ts";
import { invokeAarStructured, type AarLlmOpts } from "../llm.ts";
import { knownIdSet } from "./citeCheck.ts";

export type WhyOpts = AarLlmOpts;

const SYSTEM =
  "You are the post-game Head Coach. Answer: why did the result happen? " +
  "Each cause MUST cite eventIds from the digest (format matchId:seq). Do not invent ids. " +
  "Ground claims in xG, turnovers, special teams, and the actualSummary.";

function prompt(state: {
  matchId: string;
  side: string;
  result: string;
  intentSummary?: string;
  actualSummary?: string;
  eventLogDigest?: { events: unknown[] };
}): string {
  return JSON.stringify({
    matchId: state.matchId,
    side: state.side,
    result: state.result,
    intentSummary: state.intentSummary,
    actualSummary: state.actualSummary,
    digest: state.eventLogDigest?.events ?? [],
  });
}

function codeCauses(state: {
  eventLogDigest?: { events: { id: string; type: string; playId?: string }[] };
  actualSummary?: string;
}): AarCause[] {
  const events = state.eventLogDigest?.events ?? [];
  const goal = events.find((e) => e.type === "Goal");
  if (goal && EventIdSchema.safeParse(goal.id).success) {
    return [
      {
        claim: state.actualSummary ?? "Result tracked to scored chance.",
        eventIds: [goal.id],
        playIds: goal.playId ? [goal.playId] : [],
      },
    ];
  }
  const first = events[0];
  if (first && EventIdSchema.safeParse(first.id).success) {
    return [
      {
        claim: state.actualSummary ?? "No goal events; see digest.",
        eventIds: [first.id],
        playIds: first.playId ? [first.playId] : [],
      },
    ];
  }
  return [];
}

function groundCauses(causes: AarCause[], known: Set<string>): AarCause[] {
  return causes.filter((c) => c.eventIds.length > 0 && c.eventIds.every((id) => known.has(id)));
}

export function makeWhy(opts: WhyOpts = {}): AarGraphNode {
  return async (state) => {
    const fallback = codeCauses(state);
    if (opts.noLlm) return { causes: fallback };
    const out = await invokeAarStructured(AarWhyOutputSchema, SYSTEM, prompt(state), opts.profile);
    const known = knownIdSet(state.knownEventIds);
    const grounded = groundCauses(out?.causes ?? [], known);
    return { causes: grounded.length > 0 ? grounded : fallback };
  };
}
