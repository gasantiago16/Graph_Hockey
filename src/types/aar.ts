import { z } from "zod";
import { EventIdSchema } from "./ids.ts";
import { SideSchema, ZoneSchema } from "./hockey.ts";
import { EventDigestSchema } from "./events.ts";
import { PlaybookRevisionSchema, PlaybookSchema } from "./play.ts";

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

/** DESIGN §12 MatchAggregates plus goals (Film Room ledger). */
export const MatchAggregatesSchema = z.object({
  xgFor: z.number(),
  xgAgainst: z.number(),
  cfPct: z.number(),
  zoneTimeOZ: z.number(),
  zoneTimeDZ: z.number(),
  turnovers: z.number(),
  foPct: z.number(),
  ppPct: z.number().nullable(),
  pkPct: z.number().nullable(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
  dumpInRecoveryPct: z.number().nullable().optional(),
});
export type MatchAggregates = z.infer<typeof MatchAggregatesSchema>;

export const AarIntentOutputSchema = z.object({
  summary: z.string().max(1200),
});
export type AarIntentOutput = z.infer<typeof AarIntentOutputSchema>;

export const AarWhyOutputSchema = z.object({
  causes: z.array(AarCauseSchema).max(8),
});
export type AarWhyOutput = z.infer<typeof AarWhyOutputSchema>;

export const AarLensOutputSchema = z.object({
  notes: z.string().max(1200),
  tells: z.array(z.string().max(240)).max(6).optional(),
  lockPlayIds: z.array(z.string()).max(6).optional(),
  gapPlayIds: z.array(z.string()).max(6).optional(),
});
export type AarLensOutput = z.infer<typeof AarLensOutputSchema>;

export const AarReportSchema = z.object({
  matchId: z.string(),
  side: SideSchema,
  result: AarResultSchema,
  intentSummary: z.string().optional(),
  actualSummary: z.string().optional(),
  causes: z.array(AarCauseSchema).optional(),
  lensNotes: z.string().optional(),
  revision: PlaybookRevisionSchema.optional(),
  rejectedOps: z.array(z.string()).optional(),
  aggregates: MatchAggregatesSchema.optional(),
  eventLogDigest: EventDigestSchema.optional(),
  playbook: PlaybookSchema.optional(),
  noLlm: z.boolean().optional(),
});
export type AarReport = z.infer<typeof AarReportSchema>;

export const HIGH_VALUE_XG = 0.12;
export const DIGEST_EVENT_CAP = 80;
export const SIGNATURE_JACCARD = 0.7;
export const MINT_MIN_SEQUENCES = 3;
export const MINT_MIN_XG = 0.4;
export const TIE_BOOST_XG_SHARE = 0.4;
export const SIGNATURE_TYPES = ["Shot", "Save", "Goal", "Turnover", "ZoneEntry", "FaceoffWin"] as const;
export type SignatureType = (typeof SIGNATURE_TYPES)[number];

export const AAR_CITATION_REJECTED = "AarCitationRejected";
