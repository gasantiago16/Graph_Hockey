import { AarLensOutputSchema } from "../../llm/schemas.ts";
import type { AarGraphNode } from "../state.ts";
import { invokeAarStructured } from "../llm.ts";

export type LensOpts = { noLlm?: boolean };

const SYSTEM =
  "Loser lens (also used for ties). Close specific gaps. " +
  "Forbid rewrite-the-system language. Prefer add_counter and tweak_trigger; at most one tweak_assignment. " +
  "Max 3 ops later. Cite only digest eventIds.";

function prompt(state: {
  result: string;
  intentSummary?: string;
  actualSummary?: string;
  causes?: unknown;
  eventLogDigest?: { events: unknown[] };
  playUsage?: unknown;
}): string {
  return JSON.stringify({
    result: state.result,
    intentSummary: state.intentSummary,
    actualSummary: state.actualSummary,
    causes: state.causes,
    digest: state.eventLogDigest?.events ?? [],
    playUsage: state.playUsage,
  });
}

export function codeLoserNotes(state: { result?: string; actualSummary?: string }): string {
  return (
    `${state.result === "tie" ? "Tie" : "Loser"} lens. ${state.actualSummary ?? ""} ` +
    "Hunt specific gaps; do not rewrite the book."
  ).trim();
}

export function makeLoserLens(opts: LensOpts = {}): AarGraphNode {
  return async (state) => {
    const fallback = codeLoserNotes(state);
    if (opts.noLlm) return { lensNotes: fallback };
    const out = await invokeAarStructured(AarLensOutputSchema, SYSTEM, prompt(state));
    return { lensNotes: out?.notes ?? fallback };
  };
}
