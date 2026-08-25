import { z } from "zod";
import { PeriodSchema, PositionSchema, PressureSchema } from "./hockey.ts";
import { ProviderIdSchema } from "./provider.ts";

/** Operator inspect toggle. `none` = public geometry only. */
export const InspectSideSchema = z.enum(["home", "away", "none"]);
export type InspectSide = z.infer<typeof InspectSideSchema>;

export const SpectatorPlayerSchema = z.object({
  id: z.string(),
  side: z.enum(["home", "away"]),
  number: z.number(),
  position: PositionSchema,
  x: z.number(),
  y: z.number(),
  heading: z.number(),
});
export type SpectatorPlayer = z.infer<typeof SpectatorPlayerSchema>;

/** 10 Hz world-frame rink snapshot. Never includes playId / playbooks / directives. */
export const SpectatorFrameSchema = z.object({
  type: z.literal("snapshot"),
  matchId: z.string(),
  liveTick: z.number(),
  stoppageSeq: z.number(),
  period: PeriodSchema,
  clockRemaining: z.number(),
  score: z.object({ home: z.number(), away: z.number() }),
  strength: z.string(),
  phase: z.string(),
  puck: z.object({ x: z.number(), y: z.number(), vx: z.number(), vy: z.number() }),
  players: z.array(SpectatorPlayerSchema),
  lastEvent: z.object({ id: z.string(), type: z.string() }).nullable(),
});
export type SpectatorFrame = z.infer<typeof SpectatorFrameSchema>;

/** Inspected side only. Switching sides never includes the other team's playId. */
export const InspectStateSchema = z.object({
  type: z.literal("inspect"),
  side: z.enum(["home", "away"]),
  playName: z.string(),
  playId: z.string(),
  pressure: PressureSchema,
  strength: z.string(),
});
export type InspectState = z.infer<typeof InspectStateSchema>;

export const CostTickSchema = z.object({
  type: z.literal("cost"),
  homeCalls: z.number(),
  awayCalls: z.number(),
  promptTokens: z.number(),
  outputTokens: z.number(),
  usd: z.number(),
});
export type CostTick = z.infer<typeof CostTickSchema>;

export const ClientHelloSchema = z.object({
  type: z.literal("hello"),
  inspectSide: InspectSideSchema.default("none"),
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

/** Browser may send `{ type: "inspect", side }` to retarget inspect. */
export const ClientInspectSchema = z.object({
  type: z.literal("inspect"),
  side: InspectSideSchema,
});
export type ClientInspect = z.infer<typeof ClientInspectSchema>;

export const EventTickSchema = z.object({
  type: z.literal("event"),
  id: z.string(),
  eventType: z.string(),
  liveTick: z.number(),
});
export type EventTick = z.infer<typeof EventTickSchema>;

export const MatchStartSchema = z.object({
  type: z.literal("match_start"),
  matchId: z.string(),
  home: z.object({ id: z.string(), name: z.string() }),
  away: z.object({ id: z.string(), name: z.string() }),
  seed: z.number(),
  periodSeconds: z.number(),
  noLlm: z.boolean(),
  homeProvider: ProviderIdSchema.optional(),
  awayProvider: ProviderIdSchema.optional(),
  homeCoach: z.string().min(1).optional(),
  awayCoach: z.string().min(1).optional(),
  seriesId: z.string().optional(),
  gameIndex: z.number().int().nonnegative().optional(),
  games: z.number().int().positive().optional(),
});
export type MatchStart = z.infer<typeof MatchStartSchema>;

export const MatchOverSchema = z.object({
  type: z.literal("match_over"),
  matchId: z.string(),
  score: z.object({ home: z.number(), away: z.number() }),
  result: z.enum(["home", "away", "tie", "aborted"]),
  seriesId: z.string().optional(),
  gameIndex: z.number().int().nonnegative().optional(),
  games: z.number().int().positive().optional(),
  seriesComplete: z.boolean().optional(),
});
export type MatchOver = z.infer<typeof MatchOverSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  SpectatorFrameSchema,
  InspectStateSchema,
  CostTickSchema,
  EventTickSchema,
  MatchStartSchema,
  MatchOverSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const StartMatchBodySchema = z.object({
  home: z.string().min(1).default("original-six"),
  away: z.string().min(1).default("expansion"),
  seed: z.number().int().optional(),
  noLlm: z.boolean().default(true),
  /** UI demo often sends 5. Omitted → `loadConfig().periodSeconds` (1200 unless env). */
  periodSeconds: z.number().positive().max(1200).optional(),
  homeProvider: ProviderIdSchema.optional(),
  awayProvider: ProviderIdSchema.optional(),
  homeCoach: z.string().min(1).optional(),
  awayCoach: z.string().min(1).optional(),
});
export type StartMatchBody = z.infer<typeof StartMatchBodySchema>;

export const StartSeriesBodySchema = StartMatchBodySchema.extend({
  games: z.number().int().min(1).max(21).default(7),
});
export type StartSeriesBody = z.infer<typeof StartSeriesBodySchema>;
