import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod/v4";
import { z as z3 } from "zod";
import { fastLlm } from "../../llm/client.ts";
import { SpecialistParamsSchema } from "../../llm/schemas.ts";
import type { PlayDigest } from "../../types/play.ts";
import type { SpecialistId } from "../nodes/situation.ts";
import {
  SpecialistInputSchema,
  SpecialistOutputSchema,
  specialistInputFields,
  type SpecialistAdvice,
  type SpecialistInput,
} from "../wrapSpecialist.ts";

/** Structured grok-4.3 output (Zod 3, same objects as types). */
export const SpecialistAdviceSchema = z3.object({
  memo: z3.string().max(600),
  playIdSuggestion: z3.string().optional(),
  params: SpecialistParamsSchema.optional(),
});

export type CompileSpecialistOpts = {
  noLlm?: boolean;
  system: string;
  /** Private subgraph key — not a parent TeamGraphState channel. */
  privateKey: string;
};

export function fallbackAdvice(role: SpecialistId): SpecialistAdvice {
  return { memo: `${role} holds last structure` };
}

export function clampPlayIdSuggestion(
  advice: SpecialistAdvice,
  retrievedPlays: readonly Pick<PlayDigest, "id">[],
): SpecialistAdvice {
  const id = advice.playIdSuggestion;
  if (!id) return advice;
  if (retrievedPlays.some((p) => p.id === id)) return advice;
  const { playIdSuggestion: _drop, ...rest } = advice;
  return rest;
}

function userPrompt(role: SpecialistId, state: SpecialistInput): string {
  const plays = (state.retrievedPlays ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    family: p.family,
  }));
  return JSON.stringify({
    role,
    epochKind: state.observation.epochKind,
    epochReason: state.observation.epochReason,
    coachIntent: state.coachIntent ?? null,
    observation: {
      period: state.observation.period,
      clock: state.observation.clock,
      score: state.observation.score,
      strength: state.observation.strength,
      zone: state.observation.zone,
      phase: state.observation.phase,
      whistle: state.observation.whistle,
      lastEvents: state.observation.lastEvents,
      scoutNotes: role === "scout" ? state.observation.scoutNotes : undefined,
    },
    retrievedPlays: plays,
    lastDirective: {
      playId: state.lastDirective.playId,
      pressure: state.lastDirective.pressure,
    },
  });
}

async function invokeAdvice(role: SpecialistId, system: string, state: SpecialistInput): Promise<SpecialistAdvice> {
  const fallback = fallbackAdvice(role);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw: unknown = await fastLlm().withStructuredOutput(SpecialistAdviceSchema).invoke([
        new SystemMessage(system),
        new HumanMessage(userPrompt(role, state)),
      ]);
      const parsed = SpecialistAdviceSchema.safeParse(raw);
      if (!parsed.success) continue;
      return clampPlayIdSuggestion(parsed.data, state.retrievedPlays ?? []);
    } catch {
      continue;
    }
  }
  return fallback;
}

/**
 * Compiled specialist subgraph, no checkpointer (per-invocation). Private keys
 * differ from TeamGraphState so the parent calls invoke inside wrapSpecialist.
 */
export function compileSpecialistGraph(role: SpecialistId, opts: CompileSpecialistOpts) {
  const fields = {
    ...specialistInputFields,
    memo: z.string().optional(),
    playIdSuggestion: z.string().optional(),
    params: z.object({}).passthrough().optional(),
    [opts.privateKey]: z.string().optional(),
  };
  const state = new StateSchema(fields as never) as StateSchema<any>;
  const advise = async (s: SpecialistInput) => {
    const advice = opts.noLlm ? fallbackAdvice(role) : await invokeAdvice(role, opts.system, s);
    return {
      memo: advice.memo,
      playIdSuggestion: advice.playIdSuggestion,
      params: advice.params,
      [opts.privateKey]: advice.memo,
    };
  };
  return new StateGraph({
    state,
    input: SpecialistInputSchema,
    output: SpecialistOutputSchema,
  })
    .addNode("advise", advise as never)
    .addEdge(START, "advise")
    .addEdge("advise", END)
    .compile();
}
