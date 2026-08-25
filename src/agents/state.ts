import { ReducedValue, StateSchema } from "@langchain/langgraph";
import { z } from "zod/v4";
import type { CoachIntent, SpecialistMemo, TeamDirective } from "../types/directive.ts";
import type { EpochKind } from "../types/hockey.ts";
import type { TeamObservation } from "../types/observation.ts";
import type { PlayDigest } from "../types/play.ts";

const Directive = z
  .object({
    playId: z.string(),
    pressure: z.enum(["passive", "neutral", "aggressive"]),
  })
  .passthrough();

const Observation = z
  .object({
    matchId: z.string(),
    epochReason: z.string(),
    epochKind: z.enum(["macro", "micro"]),
  })
  .passthrough();

const Memo = z
  .object({
    specialist: z.enum(["oc", "dc", "st", "goalie", "captain", "scout"]),
    memo: z.string(),
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

export type TeamGraphStateType = {
  observation: TeamObservation;
  epochReason: string;
  epochKind: EpochKind;
  lastDirective: TeamDirective;
  situation?: {
    strength: string;
    zone: "DZ" | "NZ" | "OZ";
    scoreState: "leading" | "tied" | "trailing";
    urgency: "normal" | "protect" | "push" | "desperation";
    specialists: Array<"oc" | "dc" | "st" | "goalie" | "captain" | "scout">;
  };
  retrievedPlays: PlayDigest[];
  coachIntent?: CoachIntent;
  specialistMemos: SpecialistMemo[];
  directive?: TeamDirective;
  validationErrors?: string[];
};

export type TeamGraphInputType = {
  observation: TeamObservation;
  epochReason: string;
  epochKind: EpochKind;
  lastDirective: TeamDirective;
};

export type TeamGraphOutputType = {
  directive: TeamDirective;
  coachIntent?: CoachIntent;
  specialistMemos: SpecialistMemo[];
};

export type TeamGraphNode = (state: TeamGraphStateType) => Partial<TeamGraphStateType> | Promise<Partial<TeamGraphStateType>>;

/**
 * StateSchema (not Annotation.Root). Zod 3.25's Standard Schema types omit
 * `jsonSchema`; LangGraph's StateSchema types require it. Runtime validate works.
 */
const fields = {
  observation: Observation,
  epochReason: z.string(),
  epochKind: z.enum(["macro", "micro"]),
  lastDirective: Directive,
  situation: z
    .object({
      strength: z.string(),
      zone: z.enum(["DZ", "NZ", "OZ"]),
      scoreState: z.enum(["leading", "tied", "trailing"]),
      urgency: z.enum(["normal", "protect", "push", "desperation"]),
      specialists: z.array(z.enum(["oc", "dc", "st", "goalie", "captain", "scout"])),
    })
    .optional(),
  retrievedPlays: z.array(PlayDigestZ).default(() => []),
  coachIntent: CoachIntentZ.optional(),
  specialistMemos: new ReducedValue(z.array(Memo).default(() => []) as never, {
    inputSchema: z.array(Memo) as never,
    reducer: (left: unknown[], right: unknown[]) => left.concat(right),
  }),
  directive: Directive.optional(),
  validationErrors: z.array(z.string()).optional(),
};

export const TeamGraphState = new StateSchema(fields as never) as StateSchema<any>;
export const TeamGraphInput = new StateSchema({
  observation: Observation,
  epochReason: z.string(),
  epochKind: z.enum(["macro", "micro"]),
  lastDirective: Directive,
} as never) as StateSchema<any>;
export const TeamGraphOutput = new StateSchema({
  directive: Directive,
  coachIntent: CoachIntentZ.optional(),
  specialistMemos: z.array(Memo).default(() => []),
} as never) as StateSchema<any>;
