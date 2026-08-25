import { TeamDirectiveSchema, type TeamDirective } from "../../types/directive.ts";
import { DEFAULT_PLAY_ID, type Playbook } from "../../types/play.ts";
import { defaultDirective } from "../../engine/world.ts";
import type { TeamGraphNode } from "../state.ts";

export function playIdKnown(playbook: Playbook, playId: string): boolean {
  return playId === DEFAULT_PLAY_ID || playbook.plays.some((p) => p.id === playId);
}

/** Unknown playId → default-structure. Extra keys stripped via Zod. */
export function clampDirective(raw: unknown, playbook: Playbook, fallback: TeamDirective): {
  directive: TeamDirective;
  errors: string[];
} {
  const errors: string[] = [];
  const parsed = TeamDirectiveSchema.safeParse(raw);
  if (!parsed.success) {
    errors.push("directive failed schema");
    return { directive: fallback, errors };
  }
  const directive = parsed.data;
  if (!playIdKnown(playbook, directive.playId)) {
    errors.push(`unknown playId ${directive.playId}`);
    return { directive: { ...directive, playId: DEFAULT_PLAY_ID }, errors };
  }
  return { directive, errors };
}

export function makeValidateDirective(playbook: Playbook): TeamGraphNode {
  return (state) => {
    const fallback = state.lastDirective ?? defaultDirective(DEFAULT_PLAY_ID);
    const { directive, errors } = clampDirective(state.directive ?? fallback, playbook, fallback);
    return { directive, validationErrors: errors };
  };
}
