import {
  END,
  MemorySaver,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { AarResult } from "../types/aar.ts";
import type { Playbook } from "../types/play.ts";
import type { MatchEvent } from "../types/events.ts";
import type { TeamLlmProfile } from "../llm/profiles.ts";
import type { Side } from "../types/hockey.ts";
import type { Db } from "../persist/db.ts";
import type { EpochInvocationRow } from "../persist/events.ts";
import { AarGraphInput, AarGraphOutput, AarGraphState } from "./state.ts";
import { makeLoadMatch } from "./nodes/loadMatch.ts";
import { actualNode } from "./nodes/actualNode.ts";
import { makeIntent } from "./nodes/intent.ts";
import { makeDraftRevision } from "./nodes/draftRevision.ts";
import { makeLoserLens } from "./nodes/loserLens.ts";
import { makeWinnerLens } from "./nodes/winnerLens.ts";
import { makeWhy } from "./nodes/why.ts";
import { citeCheck } from "./nodes/citeCheck.ts";

export const AAR_RECURSION_LIMIT = 8;

export const AAR_GRAPH_NODES = [
  "load_match",
  "intent",
  "actual",
  "why",
  "winner_lens",
  "loser_lens",
  "draft_revision",
  "cite_check",
] as const;

export type CompileAarGraphOpts = {
  db?: Db;
  checkpointer?: BaseCheckpointSaver;
  /** Skip grok-4.5-high; still runs load/actual/cite_check in code. */
  noLlm?: boolean;
  /** That side's company. Ignored when noLlm. */
  profile?: TeamLlmProfile;
};

export type AarGraphInvokeInput = {
  matchId: string;
  side: Side;
  result: AarResult;
  playbook: Playbook;
  events?: MatchEvent[];
  epochs?: EpochInvocationRow[];
};

export type AarGraphInvokeConfig = {
  configurable?: { thread_id?: string };
  signal?: AbortSignal;
  recursionLimit?: number;
  callbacks?: unknown[];
  streamMode?: "values" | "updates" | "debug" | "tasks";
};

export type CompiledAarGraph = {
  nodes: Record<string, unknown>;
  invoke: (input: AarGraphInvokeInput, config?: AarGraphInvokeConfig) => Promise<unknown>;
  stream: (
    input: AarGraphInvokeInput,
    config?: AarGraphInvokeConfig,
  ) => Promise<AsyncIterable<Record<string, unknown>>>;
};

export function aarThreadId(matchId: string, side: Side): string {
  return `aar:${matchId}:${side}`;
}

/** Ties and losses take loser_lens. Only a win takes winner_lens. */
export function lensRouter(state: { result?: unknown }): "winner_lens" | "loser_lens" {
  return state.result === "win" ? "winner_lens" : "loser_lens";
}

/**
 * START → load_match → intent → actual → why → winner_lens|loser_lens
 * → draft_revision → cite_check → END.
 */
export function compileAarGraph(opts: CompileAarGraphOpts = {}): CompiledAarGraph {
  const checkpointer = opts.checkpointer ?? new MemorySaver();
  const noLlm = opts.noLlm === true;
  const llm = { noLlm, profile: noLlm ? undefined : opts.profile };
  const compiled = new StateGraph({
    state: AarGraphState,
    input: AarGraphInput,
    output: AarGraphOutput,
  })
    .addNode("load_match", makeLoadMatch({ db: opts.db }))
    .addNode("intent", makeIntent(llm))
    .addNode("actual", actualNode)
    .addNode("why", makeWhy(llm))
    .addNode("winner_lens", makeWinnerLens(llm))
    .addNode("loser_lens", makeLoserLens(llm))
    .addNode("draft_revision", makeDraftRevision(llm))
    .addNode("cite_check", citeCheck)
    .addEdge(START, "load_match")
    .addEdge("load_match", "intent")
    .addEdge("intent", "actual")
    .addEdge("actual", "why")
    .addConditionalEdges("why", lensRouter as never, {
      winner_lens: "winner_lens",
      loser_lens: "loser_lens",
    })
    .addEdge("winner_lens", "draft_revision")
    .addEdge("loser_lens", "draft_revision")
    .addEdge("draft_revision", "cite_check")
    .addEdge("cite_check", END)
    .compile({ checkpointer });
  return compiled as CompiledAarGraph;
}
