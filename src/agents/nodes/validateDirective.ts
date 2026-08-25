import { TeamDirectiveSchema, type TeamDirective } from "../../types/directive.ts";
import type { TeamObservation } from "../../types/observation.ts";
import { DEFAULT_PLAY_ID, type Playbook } from "../../types/play.ts";
import { defaultDirective } from "../../engine/world.ts";
import type { TeamGraphNode } from "../state.ts";
import { pullGoalieLegalFromObservation } from "./situation.ts";

export function playIdKnown(playbook: Playbook, playId: string): boolean {
  return playId === DEFAULT_PLAY_ID || playbook.plays.some((p) => p.id === playId);
}

export function applyEngineLegality(
  directive: TeamDirective,
  obs: TeamObservation | undefined,
  errors: string[],
): TeamDirective {
  if (!obs) return directive;
  let next = directive;
  if (next.pullGoalie === true && !pullGoalieLegalFromObservation(obs)) {
    errors.push("illegal pullGoalie");
    next = { ...next, pullGoalie: false };
  }
  if (next.timeout === true && obs.timeoutLeft.us === false) {
    errors.push("illegal timeout");
    next = { ...next, timeout: false };
  }
  return next;
}

/** Unknown playId → default-structure. Extra keys stripped via Zod. Illegal pull/timeout cleared. */
export function clampDirective(raw: unknown, playbook: Playbook, fallback: TeamDirective, obs?: TeamObservation): {
  directive: TeamDirective;
  errors: string[];
} {
  const errors: string[] = [];
  const parsed = TeamDirectiveSchema.safeParse(raw);
  if (!parsed.success) {
    errors.push("directive failed schema");
    return { directive: fallback, errors };
  }
  let directive = parsed.data;
  if (!playIdKnown(playbook, directive.playId)) {
    errors.push(`unknown playId ${directive.playId}`);
    directive = { ...directive, playId: DEFAULT_PLAY_ID };
  }
  directive = applyEngineLegality(directive, obs, errors);
  return { directive, errors };
}

export function makeValidateDirective(playbook: Playbook): TeamGraphNode {
  return (state) => {
    const fallback = state.lastDirective ?? defaultDirective(DEFAULT_PLAY_ID);
    const { directive, errors } = clampDirective(
      state.directive ?? fallback,
      playbook,
      fallback,
      state.observation,
    );
    return { directive, validationErrors: errors };
  };
}
