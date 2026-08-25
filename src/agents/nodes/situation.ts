import type { EpochKind, Zone } from "../../types/hockey.ts";
import type { TeamObservation } from "../../types/observation.ts";
import { PULL_GOALIE_SECONDS } from "../../engine/rules.ts";
import { asPlayStrength, type ScoreState } from "../../playbook/retrieve.ts";
import type { TeamGraphNode, TeamGraphStateType } from "../state.ts";

export type SpecialistId = "oc" | "dc" | "st" | "goalie" | "captain" | "scout";
export type Urgency = "normal" | "protect" | "push" | "desperation";

export type Situation = {
  strength: string;
  zone: Zone;
  scoreState: ScoreState;
  urgency: Urgency;
  specialists: SpecialistId[];
};

export function scoreStateFromObservation(obs: TeamObservation): ScoreState {
  if (obs.score.us > obs.score.them) return "leading";
  if (obs.score.us < obs.score.them) return "trailing";
  return "tied";
}

export function urgencyFromObservation(obs: TeamObservation, scoreState: ScoreState): Urgency {
  const late = (obs.period === 3 && obs.clock <= PULL_GOALIE_SECONDS) || obs.period === "OT";
  if (scoreState === "trailing" && late) return "desperation";
  if (scoreState === "leading" && late) return "protect";
  if (scoreState === "trailing") return "push";
  return "normal";
}

/** Observation has no delayedPenalty.against; delayed_penalty is treated as legal. */
export function pullGoalieLegalFromObservation(obs: TeamObservation): boolean {
  const trailing = obs.score.us < obs.score.them;
  if (obs.phase === "delayed_penalty") return true;
  if (obs.period === 3 && obs.clock <= PULL_GOALIE_SECONDS && trailing) return true;
  if (obs.period === "OT" && trailing) return true;
  return false;
}

function unique(ids: SpecialistId[]): SpecialistId[] {
  const seen = new Set<SpecialistId>();
  const out: SpecialistId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function withMacroExtras(base: SpecialistId[], obs: TeamObservation): SpecialistId[] {
  const extra: SpecialistId[] = [];
  if (obs.zone === "DZ" && obs.whistle != null) extra.push("goalie");
  if (obs.epochReason === "last_two_minutes") extra.push("goalie");
  if (pullGoalieLegalFromObservation(obs)) extra.push("goalie");
  if (obs.epochReason === "period_start" || obs.epochReason === "bench_review" || obs.epochReason === "after_goal") {
    extra.push("scout");
  }
  return unique([...base, ...extra]);
}

/** §10.3 specialist list. Macro only; micro is routed to captain later (PR 11). */
export function specialistsForMacro(obs: TeamObservation): SpecialistId[] {
  const playStr = asPlayStrength(obs.strength);
  const specialTeams = playStr === "PP" || playStr === "PK";
  const reason = obs.epochReason;

  if (reason === "timeout") return ["oc", "dc", "captain"];

  if (reason === "penalty_start" || reason === "special_teams_change" || specialTeams) {
    return ["st", "captain", "goalie"];
  }

  if (reason === "period_start" || reason === "bench_review" || reason === "after_goal") {
    return ["oc", "dc", "captain", "scout"];
  }

  if (reason === "last_two_minutes" || reason === "score_state_flip") {
    return ["oc", "dc", "captain", "goalie"];
  }

  if (obs.zone === "DZ" && obs.whistle != null) return ["dc", "captain", "goalie"];
  if (obs.zone === "OZ") return withMacroExtras(["oc", "captain"], obs);
  return withMacroExtras(["oc", "dc", "captain"], obs);
}

export function classifySituation(obs: TeamObservation, epochKind: EpochKind = obs.epochKind): Situation {
  const scoreState = scoreStateFromObservation(obs);
  return {
    strength: obs.strength,
    zone: obs.zone,
    scoreState,
    urgency: urgencyFromObservation(obs, scoreState),
    specialists: epochKind === "macro" ? specialistsForMacro(obs) : [],
  };
}

export const situation: TeamGraphNode = (state: TeamGraphStateType) => ({
  classifiedSituation: classifySituation(state.observation, state.epochKind),
});
