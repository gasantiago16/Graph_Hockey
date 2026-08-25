import { Command } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { coachLlm } from "../../llm/client.ts";
import { CoachIntentSchema, type CoachIntent } from "../../llm/schemas.ts";
import type { PlayDigest } from "../../types/play.ts";
import type { TeamGraphStateType } from "../state.ts";

export const HEAD_COACH_ENDS = ["assemble_directive"] as const;

const COACH_SYSTEM =
  "You are the Head Coach. Pick exactly one playId from retrievedPlays. " +
  "Output structured CoachIntent only. Do not invent play ids.";

export type HeadCoachOpts = {
  /** Skip grok-4.5; assemble_directive still uses the seed default play. */
  noLlm?: boolean;
};

export function clampCoachPlayId(playId: string, retrievedPlays: readonly Pick<PlayDigest, "id">[]): string {
  if (retrievedPlays.some((p) => p.id === playId)) return playId;
  return retrievedPlays[0]?.id ?? playId;
}

function fallbackIntent(state: TeamGraphStateType): CoachIntent {
  return {
    supposedToHappen: "continue the current structure",
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

async function invokeCoachIntent(state: TeamGraphStateType): Promise<CoachIntent> {
  const fallback = fallbackIntent(state);
  try {
    const raw: unknown = await coachLlm().withStructuredOutput(CoachIntentSchema).invoke([
      new SystemMessage(COACH_SYSTEM),
      new HumanMessage(coachUserPrompt(state)),
    ]);
    const parsed = CoachIntentSchema.safeParse(raw);
    if (!parsed.success) return fallback;
    return { ...parsed.data, playId: clampCoachPlayId(parsed.data.playId, state.retrievedPlays) };
  } catch {
    return fallback;
  }
}

/**
 * Macro supervisor. Command.goto is assemble_directive only (no specialist Send).
 */
export function makeHeadCoach(opts: HeadCoachOpts = {}) {
  return async (state: TeamGraphStateType) => {
    if (opts.noLlm) {
      return new Command({ goto: "assemble_directive" });
    }
    const coachIntent = await invokeCoachIntent(state);
    return new Command({
      update: { coachIntent },
      goto: "assemble_directive",
    });
  };
}
