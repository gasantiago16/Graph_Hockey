import type { Playbook } from "../../types/play.ts";
import { retrievePlays } from "../../playbook/retrieve.ts";
import type { TeamGraphNode } from "../state.ts";
import { scoreStateFromObservation } from "./situation.ts";

/** Top 6 play digests for the current strength/zone (code, no LLM). */
export function makeRetrievePlays(playbook: Playbook): TeamGraphNode {
  return (state) => {
    const obs = state.observation;
    const scoreState = state.classifiedSituation?.scoreState ?? scoreStateFromObservation(obs);
    return {
      retrievedPlays: retrievePlays(playbook, {
        strength: obs.strength,
        zone: obs.zone,
        scoreState,
        limit: 6,
      }),
    };
  };
}
