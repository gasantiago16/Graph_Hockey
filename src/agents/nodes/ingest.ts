import type { TeamGraphNode } from "../state.ts";

/** Copy invoke input. Must not write `specialistMemos` (concat reducer). */
export const ingest: TeamGraphNode = (state) => ({
  observation: state.observation,
  epochReason: state.epochReason,
  epochKind: state.epochKind,
  lastDirective: state.lastDirective,
});
