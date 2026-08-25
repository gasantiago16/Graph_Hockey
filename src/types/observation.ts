import { z } from "zod";
import { PlayerIdSchema } from "./ids.ts";
import {
  EpochKindSchema,
  EpochReasonSchema,
  PenaltyClockSchema,
  PeriodSchema,
  PhaseSchema,
  PositionSchema,
  StrengthSchema,
  Vec2Schema,
  WhistleKindSchema,
  ZoneSchema,
} from "./hockey.ts";
import { LineChangePlanSchema, TeamDirectiveSchema } from "./directive.ts";
import { PublicEventSchema } from "./events.ts";
import { PlayDigestSchema, PlayRefSchema, SlotRoleSchema } from "./play.ts";

export const RelativeSideSchema = z.enum(["us", "them"]);
export type RelativeSide = z.infer<typeof RelativeSideSchema>;

export const PublicPlayerSchema = z.object({
  id: PlayerIdSchema,
  side: RelativeSideSchema,
  number: z.number().int(),
  position: PositionSchema,
  pos: Vec2Schema,
  vel: Vec2Schema,
  heading: z.number(),
});
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;

export const AssignmentSchema = z.object({
  playerId: PlayerIdSchema,
  slot: PositionSchema,
  role: SlotRoleSchema,
});
export type Assignment = z.infer<typeof AssignmentSchema>;

export const ScoutNoteSchema = z.object({
  aboutTeamId: z.string(),
  matchId: z.string().optional(),
  note: z.string(),
});
export type ScoutNote = z.infer<typeof ScoutNoteSchema>;

export const PublicObservationSchema = z.object({
  matchId: z.string(),
  epochReason: EpochReasonSchema,
  epochKind: EpochKindSchema,
  period: PeriodSchema,
  clock: z.number(),
  score: z.object({ us: z.number().int(), them: z.number().int() }),
  strength: StrengthSchema,
  zone: ZoneSchema,
  phase: PhaseSchema,
  whistle: WhistleKindSchema.nullable(),
  puck: z.object({
    pos: Vec2Schema,
    vel: Vec2Schema,
    possessor: PlayerIdSchema.nullable(),
  }),
  players: z.array(PublicPlayerSchema),
  lastEvents: z.array(PublicEventSchema),
  zoneTime: z.object({
    usOZ: z.number(),
    themOZ: z.number(),
    nz: z.number(),
  }),
  onIce: z.object({
    us: z.array(PlayerIdSchema),
    them: z.array(PlayerIdSchema),
  }),
  penalties: z.object({
    us: z.array(PenaltyClockSchema),
    them: z.array(PenaltyClockSchema),
  }),
  timeoutLeft: z.object({ us: z.boolean(), them: z.boolean() }),
  goalieInNet: z.object({ us: z.boolean(), them: z.boolean() }),
});
export type PublicObservation = z.infer<typeof PublicObservationSchema>;

export const PrivateObservationSchema = z.object({
  activePlay: PlayRefSchema,
  lastDirective: TeamDirectiveSchema,
  bench: z.object({
    fatigue: z.record(z.string(), z.number()),
    nextChange: LineChangePlanSchema.optional(),
  }),
  playbookDigest: z.array(PlayDigestSchema),
  scoutNotes: z.array(ScoutNoteSchema),
  ourAssignments: z.array(AssignmentSchema),
});
export type PrivateObservation = z.infer<typeof PrivateObservationSchema>;

export const TeamObservationSchema = PublicObservationSchema.merge(PrivateObservationSchema);
export type TeamObservation = z.infer<typeof TeamObservationSchema>;
