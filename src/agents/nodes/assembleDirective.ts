import type { Playbook } from "../../types/play.ts";
import { defaultDirective } from "../../engine/world.ts";
import { defaultPlayIdForBook } from "../../playbook/store.ts";
import type { TeamGraphNode } from "../state.ts";

/**
 * Merge HC intent onto lastDirective. Without coachIntent (noLlm / micro) keep
 * the seed-book default play (5v5-122 / 5v5-212 / default-structure).
 */
export function makeAssembleDirective(playbook: Playbook): TeamGraphNode {
  return (state) => {
    const intent = state.coachIntent;
    const playId = intent?.playId ?? defaultPlayIdForBook(playbook);
    const directive = {
      ...defaultDirective(playId),
      ...state.lastDirective,
      playId,
    };
    if (intent) {
      directive.pressure = intent.pressure;
      if (intent.matchingNotes) {
        directive.notesForCaptain = intent.matchingNotes.slice(0, 240);
      }
    }
    return { directive };
  };
}
