import type { Playbook } from "../../types/play.ts";
import { defaultDirective } from "../../engine/world.ts";
import { defaultPlayIdForBook } from "../../playbook/store.ts";
import type { TeamGraphNode } from "../state.ts";

/** Stub: seed-book default play (5v5-122 / 5v5-212 / default-structure). No LLM. */
export function makeAssembleDirective(playbook: Playbook): TeamGraphNode {
  return (state) => {
    const playId = defaultPlayIdForBook(playbook);
    return { directive: { ...defaultDirective(playId), ...state.lastDirective, playId } };
  };
}
