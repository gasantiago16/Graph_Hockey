import { z } from "zod";
import { EventIdSchema } from "./ids.ts";
import {
  DzCoverageSchema,
  ForecheckSchema,
  NzSchemeSchema,
  PositionSchema,
  ShotPolicySchema,
  Vec2Schema,
  ZoneSchema,
} from "./hockey.ts";

export const DEFAULT_PLAY_ID = "default-structure";

export const PLAY_STRENGTHS = ["5v5", "PP", "PK", "EN", "3v3"] as const;
export const PlayStrengthSchema = z.enum(PLAY_STRENGTHS);
export type PlayStrength = z.infer<typeof PlayStrengthSchema>;

export const ZONE_BIASES = ["DZ", "NZ", "OZ", "any"] as const;
export const ZoneBiasSchema = z.enum(ZONE_BIASES);
export type ZoneBias = z.infer<typeof ZoneBiasSchema>;

export const PlayPredicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("zone"), eq: ZoneSchema }),
  z.object({ kind: z.literal("strength"), eq: z.string() }),
  z.object({ kind: z.literal("score"), eq: z.enum(["leading", "tied", "trailing"]) }),
  z.object({ kind: z.literal("timeRemainingLt"), seconds: z.number() }),
  z.object({ kind: z.literal("afterEvent"), type: z.string() }),
]);
export type PlayPredicate = z.infer<typeof PlayPredicateSchema>;

export const PlayTriggerGroupSchema = z.object({
  all: z.array(PlayPredicateSchema).optional(),
  any: z.array(PlayPredicateSchema).optional(),
});
export type PlayTriggerGroup = z.infer<typeof PlayTriggerGroupSchema>;

export const PlayAssignmentsSchema = z.object({
  shotPolicy: ShotPolicySchema,
  forecheck: ForecheckSchema.optional(),
  nz: NzSchemeSchema.optional(),
  dz: DzCoverageSchema.optional(),
  dumpSpot: z.enum(["strong-corner", "weak-corner", "soft-area"]).optional(),
});
export type PlayAssignments = z.infer<typeof PlayAssignmentsSchema>;

export const LANDMARKS = [
  "puck",
  "net-us",
  "net-them",
  "blue-atk",
  "blue-def",
  "dot-strong",
] as const;
export const LandmarkSchema = z.enum(LANDMARKS);
export type Landmark = z.infer<typeof LandmarkSchema>;

export const SLOT_ROLES = [
  "puck",
  "support",
  "net-front",
  "weak-side",
  "point",
  "gap",
  "crease",
] as const;
export const SlotRoleSchema = z.enum(SLOT_ROLES);
export type SlotRole = z.infer<typeof SlotRoleSchema>;

export const FormationSlotSchema = z.object({
  rel: Vec2Schema,
  landmark: LandmarkSchema,
  role: SlotRoleSchema,
});
export type FormationSlot = z.infer<typeof FormationSlotSchema>;

export const FormationSchema = z.object({
  slots: z.record(z.string(), FormationSlotSchema),
});
export type Formation = z.infer<typeof FormationSchema>;

export const PlayStatsSchema = z.object({
  games: z.number(),
  xgFor: z.number(),
  xgAgainst: z.number(),
});
export type PlayStats = z.infer<typeof PlayStatsSchema>;

export const PlaySchema = z.object({
  id: z.string(),
  name: z.string().max(64),
  version: z.number().int(),
  status: z.enum(["active", "experimental", "retired"]),
  family: z.string(),
  strength: z.array(PlayStrengthSchema),
  zoneBias: z.array(ZoneBiasSchema),
  formation: FormationSchema,
  triggers: z.array(PlayTriggerGroupSchema),
  assignments: PlayAssignmentsSchema,
  counters: z.array(z.string()),
  vulnerableTo: z.array(z.string()),
  stats: PlayStatsSchema,
  origin: z.enum(["seed", "minted", "mutated"]),
  parentId: z.string().optional(),
});
export type Play = z.infer<typeof PlaySchema>;

export const PlaybookSchema = z.object({
  teamId: z.string(),
  version: z.number().int(),
  plays: z.array(PlaySchema),
});
export type Playbook = z.infer<typeof PlaybookSchema>;

export const PlayRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
});
export type PlayRef = z.infer<typeof PlayRefSchema>;

export const PlayDigestSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string(),
  strength: z.array(PlayStrengthSchema),
  zoneBias: z.array(ZoneBiasSchema),
  stats: PlayStatsSchema.extend({
    cfPct: z.number().optional(),
  }),
  /** Families this play is designed to beat. Ours, never opponent playIds. */
  counters: z.array(z.string()).optional(),
});
export type PlayDigest = z.infer<typeof PlayDigestSchema>;

export const PlayPatchSchema = z.object({
  name: z.string().max(64).optional(),
  family: z.string().optional(),
  strength: z.array(PlayStrengthSchema).optional(),
  zoneBias: z.array(ZoneBiasSchema).optional(),
  triggers: z.array(PlayTriggerGroupSchema).optional(),
  assignments: PlayAssignmentsSchema.partial().optional(),
  counters: z.array(z.string()).optional(),
  vulnerableTo: z.array(z.string()).optional(),
});
export type PlayPatch = z.infer<typeof PlayPatchSchema>;

const EventIds = z.array(EventIdSchema).min(1);

export const PlayMutationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("boost"),
    playId: z.string(),
    reason: z.string().max(400),
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("nerf"),
    playId: z.string(),
    reason: z.string().max(400),
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("tweak_trigger"),
    playId: z.string(),
    add: z.array(PlayPredicateSchema).optional(),
    remove: z.array(PlayPredicateSchema).optional(),
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("tweak_assignment"),
    playId: z.string(),
    patch: PlayAssignmentsSchema.partial(),
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("tweak_slot"),
    playId: z.string(),
    slot: PositionSchema,
    rel: Vec2Schema,
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("add_counter"),
    playId: z.string(),
    family: z.string(),
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("mint"),
    basedOn: z.string(),
    name: z.string().max(64),
    patch: PlayPatchSchema,
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("retire"),
    playId: z.string(),
    reason: z.string().max(400),
    eventIds: EventIds,
  }),
  z.object({
    op: z.literal("personnel"),
    line: z.enum(["F1", "F2", "F3", "D1", "D2", "D3"]),
    note: z.string().max(240),
    eventIds: EventIds,
  }),
]);
export type PlayMutation = z.infer<typeof PlayMutationSchema>;

export const PlaybookRevisionSchema = z.object({
  summary: z.string().max(1200),
  ops: z.array(PlayMutationSchema).max(3),
});
export type PlaybookRevision = z.infer<typeof PlaybookRevisionSchema>;
