import { StateSchema } from "@langchain/langgraph";
import { z } from "zod/v4";
import type { AarCause, AarResult, MatchAggregates } from "../types/aar.ts";
import type { EventDigest, MatchEvent } from "../types/events.ts";
import type { Side } from "../types/hockey.ts";
import type { Playbook, PlaybookRevision } from "../types/play.ts";
import type { PlaySequence, PlayUsage } from "./nodes/actual.ts";
import type { EpochInvocationRow } from "../persist/events.ts";

const PlaybookZ = z
  .object({
    teamId: z.string(),
    version: z.number(),
    plays: z.array(z.object({ id: z.string() }).passthrough()),
  })
  .passthrough();

const DigestZ = z
  .object({
    matchId: z.string(),
    events: z.array(z.object({ id: z.string(), type: z.string(), liveTick: z.number() }).passthrough()),
  })
  .passthrough();

const AggZ = z
  .object({
    xgFor: z.number(),
    xgAgainst: z.number(),
    cfPct: z.number(),
  })
  .passthrough();

const RevisionZ = z
  .object({
    summary: z.string(),
    ops: z.array(z.object({ op: z.string() }).passthrough()),
  })
  .passthrough();

const CauseZ = z
  .object({
    claim: z.string(),
    eventIds: z.array(z.string()),
    playIds: z.array(z.string()),
  })
  .passthrough();

export type AarGraphStateType = {
  matchId: string;
  side: Side;
  result: AarResult;
  playbook: Playbook;
  themPlaybook?: Playbook;
  events?: MatchEvent[];
  epochs?: EpochInvocationRow[];
  eventLogDigest?: EventDigest;
  knownEventIds?: string[];
  aggregates?: MatchAggregates;
  intentSummary?: string;
  actualSummary?: string;
  causes?: AarCause[];
  lensNotes?: string;
  revision?: PlaybookRevision;
  rejectedOps?: string[];
  mintEligible?: boolean;
  playUsage?: PlayUsage[];
  sequences?: PlaySequence[];
};

export type AarGraphInputType = {
  matchId: string;
  side: Side;
  result: AarResult;
  playbook: Playbook;
  themPlaybook?: Playbook;
  events?: MatchEvent[];
  epochs?: EpochInvocationRow[];
};

export type AarGraphOutputType = {
  intentSummary?: string;
  actualSummary?: string;
  causes?: AarCause[];
  lensNotes?: string;
  revision?: PlaybookRevision;
  rejectedOps?: string[];
  aggregates?: MatchAggregates;
  eventLogDigest?: EventDigest;
};

export type AarGraphNode = (
  state: AarGraphStateType,
) => Partial<AarGraphStateType> | Promise<Partial<AarGraphStateType>>;

const fields = {
  matchId: z.string(),
  side: z.enum(["home", "away"]),
  result: z.enum(["win", "loss", "tie"]),
  playbook: PlaybookZ,
  themPlaybook: PlaybookZ.optional(),
  events: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  epochs: z.array(z.object({}).passthrough()).optional(),
  eventLogDigest: DigestZ.optional(),
  knownEventIds: z.array(z.string()).optional(),
  aggregates: AggZ.optional(),
  intentSummary: z.string().optional(),
  actualSummary: z.string().optional(),
  causes: z.array(CauseZ).optional(),
  lensNotes: z.string().optional(),
  revision: RevisionZ.optional(),
  rejectedOps: z.array(z.string()).optional(),
  mintEligible: z.boolean().optional(),
  playUsage: z.array(z.object({ playId: z.string() }).passthrough()).optional(),
  sequences: z.array(z.object({ playId: z.string() }).passthrough()).optional(),
};

export const AarGraphState = new StateSchema(fields as never) as StateSchema<any>;
export const AarGraphInput = new StateSchema({
  matchId: z.string(),
  side: z.enum(["home", "away"]),
  result: z.enum(["win", "loss", "tie"]),
  playbook: PlaybookZ,
  themPlaybook: PlaybookZ.optional(),
  events: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  epochs: z.array(z.object({}).passthrough()).optional(),
} as never) as StateSchema<any>;
export const AarGraphOutput = new StateSchema({
  intentSummary: z.string().optional(),
  actualSummary: z.string().optional(),
  causes: z.array(CauseZ).optional(),
  lensNotes: z.string().optional(),
  revision: RevisionZ.optional(),
  rejectedOps: z.array(z.string()).optional(),
  aggregates: AggZ.optional(),
  eventLogDigest: DigestZ.optional(),
} as never) as StateSchema<any>;
