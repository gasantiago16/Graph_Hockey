import { z } from "zod";
import { EventIdSchema, PlayerIdSchema, type EventId, type PlayerId } from "./ids.ts";
import { PeriodSchema, Vec2Schema, ZoneSchema, type Period, type Vec2, type Zone } from "./hockey.ts";

export const PUBLIC_EVENT_TYPES = [
  "Goal",
  "Shot",
  "Save",
  "Block",
  "Rebound",
  "FaceoffWin",
  "ZoneEntry",
  "Icing",
  "Offside",
  "Penalty",
  "Turnover",
  "PossessionChange",
  "LineChange",
  "GoaliePull",
  "Timeout",
  "Whistle",
  "Contact",
  "Freeze",
  "PuckOut",
  "NetOff",
  "PeriodEnd",
  "DirectiveApplied",
  "IllegalChangeRejected",
  "HighStickGoalWavedOff",
] as const;
export const PublicEventTypeSchema = z.enum(PUBLIC_EVENT_TYPES);
export type PublicEventType = z.infer<typeof PublicEventTypeSchema>;

export const PublicEventSchema = z.object({
  id: EventIdSchema,
  liveTick: z.number().int(),
  stoppageSeq: z.number().int(),
  period: PeriodSchema,
  type: PublicEventTypeSchema,
  zone: ZoneSchema,
  pos: Vec2Schema.optional(),
  possessor: PlayerIdSchema.nullable().optional(),
  actor: PlayerIdSchema.optional(),
  xG: z.number().optional(),
});
export type PublicEvent = z.infer<typeof PublicEventSchema>;

export const EventDigestSchema = z.object({
  matchId: z.string(),
  events: z.array(
    z.object({
      id: EventIdSchema,
      type: z.string(),
      liveTick: z.number(),
      playId: z.string().optional(),
      zone: ZoneSchema.optional(),
      xG: z.number().optional(),
    }),
  ),
});
export type EventDigest = z.infer<typeof EventDigestSchema>;

/** World-frame event log row. Geometry is not mirrored. */
export type MatchEvent = {
  id: EventId;
  seq: number;
  liveTick: number;
  stoppageSeq: number;
  period: Period;
  type: PublicEventType | string;
  zone?: Zone;
  pos?: Vec2;
  possessor?: PlayerId | null;
  actor?: PlayerId;
  xG?: number;
  playId?: string;
  payload?: unknown;
};
