import { AarLensOutputSchema } from "../../llm/schemas.ts";
import type { AarGraphNode } from "../state.ts";
import { invokeAarStructured } from "../llm.ts";

export type LensOpts = { noLlm?: boolean };

const SYSTEM =
  "Winner lens. Lock what worked. Hunt complacency and tells " +
  "(e.g. always dump to the strong side after a FO win). Do not retire plays that were used. " +
  "At least one boost belongs in the later revision. Cite only digest eventIds.";

function prompt(state: {
  result: string;
  intentSummary?: string;
  actualSummary?: string;
  causes?: unknown;
  eventLogDigest?: { events: unknown[] };
  mintEligible?: boolean;
  playUsage?: unknown;
}): string {
  return JSON.stringify({
    result: state.result,
    intentSummary: state.intentSummary,
    actualSummary: state.actualSummary,
    causes: state.causes,
    digest: state.eventLogDigest?.events ?? [],
    mintEligible: state.mintEligible,
    playUsage: state.playUsage,
  });
}

export function codeWinnerNotes(state: { actualSummary?: string; mintEligible?: boolean }): string {
  return (
    `Winner lens. ${state.actualSummary ?? ""} ` +
    `Lock the working structure; watch for tells. mintEligible=${state.mintEligible === true}.`
  ).trim();
}

export function makeWinnerLens(opts: LensOpts = {}): AarGraphNode {
  return async (state) => {
    const fallback = codeWinnerNotes(state);
    if (opts.noLlm) return { lensNotes: fallback };
    const out = await invokeAarStructured(AarLensOutputSchema, SYSTEM, prompt(state));
    return { lensNotes: out?.notes ?? fallback };
  };
}
