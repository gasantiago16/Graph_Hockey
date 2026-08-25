import { z } from "zod";

export const PlayerIdSchema = z.string().min(1);
export type PlayerId = z.infer<typeof PlayerIdSchema>;

export const MatchIdSchema = z.string().min(1);
export type MatchId = z.infer<typeof MatchIdSchema>;

export const TeamIdSchema = z.string().min(1);
export type TeamId = z.infer<typeof TeamIdSchema>;

export const PlayIdSchema = z.string().min(1);
export type PlayId = z.infer<typeof PlayIdSchema>;

/** Public event id: `${matchId}:${seq}` with seq a non-negative integer. */
export const EVENT_ID_RE = /^[^:]+:\d+$/;
export const EventIdSchema = z.string().regex(EVENT_ID_RE);
export type EventId = z.infer<typeof EventIdSchema>;

export function makeEventId(matchId: string, seq: number): EventId {
  return `${matchId}:${seq}`;
}
