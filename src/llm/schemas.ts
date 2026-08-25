/**
 * Structured-output Zod for ChatXAI `.withStructuredOutput`.
 * Canonical objects live in `src/types` — re-exported here so graphs import one module.
 * Re-export only — no custom wrappers.
 */
export { EpochKindSchema } from "../types/hockey.ts";
export type { EpochKind } from "../types/hockey.ts";

export {
  CoachIntentSchema,
  PlayParamsSchema,
  SpecialistMemoSchema,
  SpecialistParamsSchema,
  TeamDirectiveSchema,
} from "../types/directive.ts";
export type {
  CoachIntent,
  PlayParams,
  SpecialistMemo,
  SpecialistParams,
  TeamDirective,
} from "../types/directive.ts";

export {
  PlayDigestSchema,
  PlayMutationSchema,
  PlayPatchSchema,
  PlaySchema,
  PlaybookRevisionSchema,
  PlaybookSchema,
} from "../types/play.ts";
export type {
  Play,
  PlayDigest,
  PlayMutation,
  PlayPatch,
  Playbook,
  PlaybookRevision,
} from "../types/play.ts";

export {
  PrivateObservationSchema,
  PublicObservationSchema,
  ScoutNoteSchema,
  TeamObservationSchema,
} from "../types/observation.ts";
export type {
  PrivateObservation,
  PublicObservation,
  ScoutNote,
  TeamObservation,
} from "../types/observation.ts";

export { AarCauseSchema, AarReportMetaSchema, AarResultSchema } from "../types/aar.ts";
export type { AarCause, AarReportMeta, AarResult } from "../types/aar.ts";

export { EventDigestSchema } from "../types/events.ts";
export type { EventDigest } from "../types/events.ts";
