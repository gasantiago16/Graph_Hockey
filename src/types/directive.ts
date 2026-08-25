import { z } from "zod";
import {
  DzCoverageSchema,
  ForecheckSchema,
  FwdLineSchema,
  NzSchemeSchema,
  PressureSchema,
  ShotPolicySchema,
} from "./hockey.ts";

export const SpecialistParamsSchema = z.object({
  forecheck: ForecheckSchema.optional(),
  nz: NzSchemeSchema.optional(),
  dz: DzCoverageSchema.optional(),
  shotPolicy: ShotPolicySchema.optional(),
  creaseDepth: z.enum(["deep", "mid", "challenge"]).optional(),
  playPuck: z.enum(["stay", "play", "aggressive-cut"]).optional(),
  umbrella: z.boolean().optional(),
});
export type SpecialistParams = z.infer<typeof SpecialistParamsSchema>;

/** §8 playParams only. Goalie/ST knobs stay on SpecialistParams, goalie, and specialTeams. */
export const PlayParamsSchema = z.object({
  forecheck: ForecheckSchema.optional(),
  nz: NzSchemeSchema.optional(),
  dz: DzCoverageSchema.optional(),
  shotPolicy: ShotPolicySchema.optional(),
  pointShotOk: z.boolean().optional(),
  cycleSide: z.enum(["left", "right", "auto"]).optional(),
});
export type PlayParams = z.infer<typeof PlayParamsSchema>;

export const LineChangePlanSchema = z.object({
  fwd: z.enum(["F1", "F2", "F3", "hold"]),
  dpair: z.enum(["D1", "D2", "D3", "hold"]),
  matchup: z
    .object({
      againstFwd: FwdLineSchema.optional(),
    })
    .optional(),
});
export type LineChangePlan = z.infer<typeof LineChangePlanSchema>;

export const TeamDirectiveSchema = z.object({
  playId: z.string(),
  playParams: PlayParamsSchema.optional(),
  pressure: PressureSchema,
  lineChange: LineChangePlanSchema.optional(),
  specialTeams: z
    .object({
      unit: z.enum(["PP1", "PP2", "PK1", "PK2"]),
      umbrella: z.boolean().optional(),
    })
    .optional(),
  goalie: z
    .object({
      playPuck: z.enum(["stay", "play", "aggressive-cut"]),
      creaseDepth: z.enum(["deep", "mid", "challenge"]),
    })
    .optional(),
  pullGoalie: z.boolean().optional(),
  timeout: z.boolean().optional(),
  lockLines: z.boolean().optional(),
  notesForCaptain: z.string().max(240).optional(),
});
export type TeamDirective = z.infer<typeof TeamDirectiveSchema>;

export const CoachIntentSchema = z.object({
  supposedToHappen: z.string().max(800),
  playId: z.string(),
  pressure: PressureSchema,
  matchingNotes: z.string().max(400).optional(),
});
export type CoachIntent = z.infer<typeof CoachIntentSchema>;

export const SpecialistMemoSchema = z.object({
  specialist: z.enum(["oc", "dc", "st", "goalie", "captain", "scout"]),
  memo: z.string().max(600),
  playIdSuggestion: z.string().optional(),
  params: SpecialistParamsSchema.optional(),
});
export type SpecialistMemo = z.infer<typeof SpecialistMemoSchema>;
