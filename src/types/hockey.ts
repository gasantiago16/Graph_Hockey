import { z } from "zod";
import { PlayerIdSchema } from "./ids.ts";

export const Vec2Schema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Vec2 = z.infer<typeof Vec2Schema>;

export const SIDES = ["home", "away"] as const;
export const SideSchema = z.enum(SIDES);
export type Side = z.infer<typeof SideSchema>;

export const ZONES = ["DZ", "NZ", "OZ"] as const;
export const ZoneSchema = z.enum(ZONES);
export type Zone = z.infer<typeof ZoneSchema>;

export const POSITIONS = ["C", "LW", "RW", "LD", "RD", "G"] as const;
export const PositionSchema = z.enum(POSITIONS);
export type Position = z.infer<typeof PositionSchema>;

/** World / observation strength. Observer-relative: `5v4` means we have the extra skater. Empty-net is `6v5`/`5v6`; OT PK is `3v2`/`2v3`. Playbook tag `EN` lives on PlayStrength. */
export const STRENGTHS = [
  "5v5",
  "5v4",
  "4v5",
  "5v3",
  "3v5",
  "4v4",
  "4v3",
  "3v4",
  "3v3",
  "3v2",
  "2v3",
  "6v5",
  "5v6",
] as const;
export const StrengthSchema = z.enum(STRENGTHS);
export type Strength = z.infer<typeof StrengthSchema>;

export const PeriodSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal("OT"),
]);
export type Period = z.infer<typeof PeriodSchema>;

export const PHASES = [
  "live",
  "delayed_offside",
  "delayed_penalty",
  "whistle",
  "faceoff_drop",
  "intermission",
  "game_over",
] as const;
export const PhaseSchema = z.enum(PHASES);
export type Phase = z.infer<typeof PhaseSchema>;

export const WHISTLE_KINDS = [
  "goal",
  "icing",
  "offside",
  "penalty",
  "freeze",
  "puck_out",
  "net_off",
  "period_end",
  "high_stick_goal_waved_off",
] as const;
export const WhistleKindSchema = z.enum(WHISTLE_KINDS);
export type WhistleKind = z.infer<typeof WhistleKindSchema>;

/** No limbs. Kick = skate-puck. */
export const CONTACT_KINDS = [
  "stick-puck",
  "body-puck",
  "skate-puck",
  "body-body",
  "stick-body",
] as const;
export const ContactKindSchema = z.enum(CONTACT_KINDS);
export type ContactKind = z.infer<typeof ContactKindSchema>;

export const EpochKindSchema = z.enum(["macro", "micro"]);
export type EpochKind = z.infer<typeof EpochKindSchema>;

export const EPOCH_REASONS = [
  "period_start",
  "after_goal",
  "penalty_start",
  "special_teams_change",
  "timeout",
  "icing",
  "offside",
  "faceoff",
  "zone_entry",
  "possession_review",
  "last_two_minutes",
  "score_state_flip",
  "bench_review",
] as const;
export const EpochReasonSchema = z.enum(EPOCH_REASONS);
export type EpochReason = z.infer<typeof EpochReasonSchema>;

export const SHOT_POLICIES = ["shoot", "pass", "cycle", "dump", "hold", "crash"] as const;
export const ShotPolicySchema = z.enum(SHOT_POLICIES);
export type ShotPolicy = z.infer<typeof ShotPolicySchema>;

export const FORECHECKS = ["1-2-2", "2-1-2", "1-1-3", "2-3", "aggressive-forecheck"] as const;
export const ForecheckSchema = z.enum(FORECHECKS);
export type Forecheck = z.infer<typeof ForecheckSchema>;

export const NZ_SCHEMES = ["1-3-1", "1-2-2", "2-3", "left-wing-lock"] as const;
export const NzSchemeSchema = z.enum(NZ_SCHEMES);
export type NzScheme = z.infer<typeof NzSchemeSchema>;

export const DZ_COVERAGES = ["man", "zone-box", "zone-diamond", "collapse", "over"] as const;
export const DzCoverageSchema = z.enum(DZ_COVERAGES);
export type DzCoverage = z.infer<typeof DzCoverageSchema>;

export const PRESSURES = ["passive", "neutral", "aggressive"] as const;
export const PressureSchema = z.enum(PRESSURES);
export type Pressure = z.infer<typeof PressureSchema>;

/** LLM jsonMode often says high/attack instead of the enum. Engine still stores Pressure. */
export function coercePressure(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (s === "high" || s === "attack" || s === "aggro" || s === "push" || s === "forecheck" || s === "aggressive") {
    return "aggressive";
  }
  if (s === "low" || s === "defend" || s === "passive") return "passive";
  if (s === "medium" || s === "mid" || s === "neutral") return "neutral";
  return v;
}

export const FWD_LINES = ["F1", "F2", "F3"] as const;
export const FwdLineSchema = z.enum(FWD_LINES);
export type FwdLine = z.infer<typeof FwdLineSchema>;

export const D_PAIRS = ["D1", "D2", "D3"] as const;
export const DPairSchema = z.enum(D_PAIRS);
export type DPair = z.infer<typeof DPairSchema>;

export const PlayerAttributesSchema = z.object({
  speed: z.number(),
  accel: z.number(),
  agility: z.number(),
  shooting: z.number(),
  passing: z.number(),
  faceoff: z.number(),
  defense: z.number(),
  physical: z.number(),
  vision: z.number(),
  discipline: z.number(),
  stamina: z.number(),
  reboundControl: z.number().optional(),
  tracking: z.number().optional(),
});
export type PlayerAttributes = z.infer<typeof PlayerAttributesSchema>;

export const PenaltyClockSchema = z.object({
  playerId: PlayerIdSchema,
  remaining: z.number(),
  kind: z.literal("minor"),
});
export type PenaltyClock = z.infer<typeof PenaltyClockSchema>;

export type AttackingDir = 1 | -1;

/** F4 is the extra-attacker pool; G1/G2 are the two goalies. */
export const LINE_IDS = ["F1", "F2", "F3", "F4", "D1", "D2", "D3", "G1", "G2"] as const;
export const LineIdSchema = z.enum(LINE_IDS);
export type LineId = z.infer<typeof LineIdSchema>;

export const RosterPlayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  number: z.number().int(),
  position: PositionSchema,
  line: LineIdSchema,
  attributes: PlayerAttributesSchema,
});
export type RosterPlayer = z.infer<typeof RosterPlayerSchema>;

/** v1 roster: 12 F + 6 D + 2 G. */
export const RosterSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().min(1),
  players: z.array(RosterPlayerSchema),
});
export type Roster = z.infer<typeof RosterSchema>;
