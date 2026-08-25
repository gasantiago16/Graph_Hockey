import { z } from "zod";
import { EventIdSchema } from "./ids.ts";
import { SideSchema } from "./hockey.ts";

export const AarResultSchema = z.enum(["win", "loss", "tie"]);
export type AarResult = z.infer<typeof AarResultSchema>;

export const AarCauseSchema = z.object({
  claim: z.string(),
  eventIds: z.array(EventIdSchema).min(1),
  playIds: z.array(z.string()),
});
export type AarCause = z.infer<typeof AarCauseSchema>;

export const AarReportMetaSchema = z.object({
  matchId: z.string(),
  side: SideSchema,
  result: AarResultSchema,
});
export type AarReportMeta = z.infer<typeof AarReportMetaSchema>;
