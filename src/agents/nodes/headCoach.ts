import { Command, Send } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { coachLlm } from "../../llm/client.ts";
import type { TeamLlmProfile } from "../../llm/profiles.ts";
import { CoachIntentSchema, type CoachIntent } from "../../llm/schemas.ts";
import { invokeStructured } from "../../llm/structured.ts";
import type { PlayDigest } from "../../types/play.ts";
import type { TeamGraphStateType } from "../state.ts";
import { SPECIALIST_IDS, type SpecialistId } from "./situation.ts";

export const HEAD_COACH_ENDS = [
  "oc",
  "dc",
  "st",
  "goalie",
  "captain",
  "scout",
  "assemble_directive",
] as const;

const ALLOWED_SPECIALISTS = new Set<string>(SPECIALIST_IDS);

const COACH_SYSTEM =
  "You are an NHL Head Coach. Win the period by occupying ice and creating a scoring chance. " +
  "supposedToHappen must name the hockey action (support-below-the-puck, pass to the slot/backdoor, " +
  "cycle low, crash the net) — never 'continue the current structure'. " +
  "Prefer plays that enter the OZ with possession and pass to a shooter. Dump only if no pass exists. " +
  "Pick exactly one playId from retrievedPlays. Output structured CoachIntent only. Do not invent play ids.";

export type HeadCoachOpts = {
  /** Skip grok-4.5; assemble_directive still uses the seed default play. */
  noLlm?: boolean;
  profile?: TeamLlmProfile;
};

export function clampCoachPlayId(playId: string, retrievedPlays: readonly Pick<PlayDigest, "id">[]): string {
  if (retrievedPlays.some((p) => p.id === playId)) return playId;
  return retrievedPlays[0]?.id ?? playId;
}

function fallbackIntent(state: TeamGraphStateType): CoachIntent {
  return {
    supposedToHappen: "occupy ice, pass to a teammate in a scoring spot, attack the net",
    playId: clampCoachPlayId(state.lastDirective.playId, state.retrievedPlays),
    pressure: state.lastDirective.pressure,
  };
}

function coachUserPrompt(state: TeamGraphStateType): string {
  const sit = state.classifiedSituation;
  const plays = state.retrievedPlays.map((p) => ({
    id: p.id,
    name: p.name,
    family: p.family,
    strength: p.strength,
    zoneBias: p.zoneBias,
  }));
  return JSON.stringify({
    epochKind: state.epochKind,
    epochReason: state.epochReason,
    observation: {
      period: state.observation.period,
      clock: state.observation.clock,
      score: state.observation.score,
      strength: state.observation.strength,
      zone: state.observation.zone,
      phase: state.observation.phase,
      whistle: state.observation.whistle,
    },
    situation: sit,
    retrievedPlays: plays,
    lastDirective: {
      playId: state.lastDirective.playId,
      pressure: state.lastDirective.pressure,
    },
  });
}

async function invokeCoachIntent(state: TeamGraphStateType, profile?: TeamLlmProfile): Promise<CoachIntent> {
  const fallback = fallbackIntent(state);
  const parsed = await invokeStructured(
    coachLlm(process.env, profile),
    CoachIntentSchema,
    [new SystemMessage(COACH_SYSTEM), new HumanMessage(coachUserPrompt(state))],
    { label: "coach" },
  );
  if (!parsed) return fallback;
  return { ...parsed, playId: clampCoachPlayId(parsed.playId, state.retrievedPlays) };
}

function routedSpecialists(state: TeamGraphStateType): SpecialistId[] {
  return (state.classifiedSituation?.specialists ?? []).filter((s): s is SpecialistId => ALLOWED_SPECIALISTS.has(s));
}

function specialistPayload(state: TeamGraphStateType, intent: CoachIntent) {
  return {
    observation: state.observation,
    coachIntent: intent,
    retrievedPlays: state.retrievedPlays ?? [],
    lastDirective: state.lastDirective,
  };
}

/**
 * Macro supervisor. Command.goto is Send[] to specialists, or assemble_directive if empty.
 * --no-llm skips grok-4.5 and specialists (goto assemble).
 */
export function makeHeadCoach(opts: HeadCoachOpts = {}) {
  return async (state: TeamGraphStateType) => {
    if (opts.noLlm) {
      return new Command({ goto: "assemble_directive" });
    }
    const coachIntent = await invokeCoachIntent(state, opts.profile);
    const specs = routedSpecialists(state);
    if (specs.length === 0) {
      return new Command({ update: { coachIntent }, goto: "assemble_directive" });
    }
    return new Command({
      update: { coachIntent },
      goto: specs.map((s) => new Send(s, specialistPayload(state, coachIntent))),
    });
  };
}
