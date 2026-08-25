import type { AarGraphNode } from "../state.ts";
import { computeActual } from "./actual.ts";

/** Pure aggregates from the event log. Not an LLM. */
export const actualNode: AarGraphNode = (state) => {
  const events = state.events ?? [];
  const actual = computeActual(state.matchId, events, state.side);
  return {
    eventLogDigest: state.eventLogDigest ?? actual.digest,
    knownEventIds: state.knownEventIds ?? actual.knownEventIds,
    aggregates: actual.aggregates,
    actualSummary: actual.actualSummary,
    mintEligible: actual.mintEligible,
    playUsage: actual.usage,
    sequences: actual.sequences,
  };
};
