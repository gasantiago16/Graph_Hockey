import { StateSchema } from "@langchain/langgraph";
import { z } from "zod/v4";
import { SpecialistParamsSchema, type SpecialistMemo } from "../llm/schemas.ts";
import type { CoachIntent, SpecialistParams, TeamDirective } from "../types/directive.ts";
import type { TeamObservation } from "../types/observation.ts";
import type { PlayDigest } from "../types/play.ts";
import type { SpecialistId } from "./nodes/situation.ts";

const Observation = z
  .object({
    matchId: z.string(),
    epochReason: z.string(),
    epochKind: z.enum(["macro", "micro"]),
  })
  .passthrough();

const Directive = z
  .object({
    playId: z.string(),
    pressure: z.enum(["passive", "neutral", "aggressive"]),
  })
  .passthrough();

const PlayDigestZ = z
  .object({
    id: z.string(),
    name: z.string(),
    family: z.string(),
  })
  .passthrough();

const CoachIntentZ = z
  .object({
    supposedToHappen: z.string(),
    playId: z.string(),
    pressure: z.enum(["passive", "neutral", "aggressive"]),
  })
  .passthrough();

/** Send payload is not full TeamGraphState (§10.5). */
export const specialistInputFields = {
  observation: Observation,
  lastDirective: Directive,
  retrievedPlays: z.array(PlayDigestZ).default(() => []),
  coachIntent: CoachIntentZ.optional(),
};

export const SpecialistInputSchema = new StateSchema(specialistInputFields as never) as StateSchema<any>;

export const SpecialistOutputSchema = new StateSchema({
  memo: z.string(),
  playIdSuggestion: z.string().optional(),
  params: z.object({}).passthrough().optional(),
} as never) as StateSchema<any>;

export type SpecialistInput = {
  observation: TeamObservation;
  lastDirective: TeamDirective;
  retrievedPlays: PlayDigest[];
  coachIntent?: CoachIntent;
};

export type SpecialistAdvice = {
  memo: string;
  playIdSuggestion?: string;
  params?: SpecialistParams;
};

export type SpecialistSubgraph = {
  invoke: (input: SpecialistInput, config?: { signal?: AbortSignal }) => Promise<unknown>;
};

export function asSpecialistAdvice(out: unknown): SpecialistAdvice {
  if (!out || typeof out !== "object") return { memo: "" };
  const rec = out as Record<string, unknown>;
  const memo = typeof rec.memo === "string" ? rec.memo.slice(0, 600) : "";
  const playIdSuggestion = typeof rec.playIdSuggestion === "string" ? rec.playIdSuggestion : undefined;
  const parsed = rec.params === undefined ? undefined : SpecialistParamsSchema.safeParse(rec.params);
  return {
    memo,
    playIdSuggestion,
    params: parsed?.success ? parsed.data : undefined,
  };
}

/**
 * Call a specialist subgraph inside a parent node (private keys stay off parent state).
 */
export function wrapSpecialist(name: SpecialistId, subgraph: SpecialistSubgraph) {
  return async (state: SpecialistInput, config?: { signal?: AbortSignal }) => {
    const out = await subgraph.invoke(
      {
        observation: state.observation,
        coachIntent: state.coachIntent,
        retrievedPlays: state.retrievedPlays ?? [],
        lastDirective: state.lastDirective,
      },
      config?.signal ? { signal: config.signal } : undefined,
    );
    const advice = asSpecialistAdvice(out);
    const memo: SpecialistMemo = {
      specialist: name,
      memo: advice.memo,
      playIdSuggestion: advice.playIdSuggestion,
      params: advice.params,
    };
    return { specialistMemos: [memo] };
  };
}
