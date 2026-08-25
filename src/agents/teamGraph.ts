import {
  END,
  MemorySaver,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { TeamDirective } from "../types/directive.ts";
import type { Side } from "../types/hockey.ts";
import type { Playbook } from "../types/play.ts";
import type { TeamObservation } from "../types/observation.ts";
import { ingest } from "./nodes/ingest.ts";
import { situation } from "./nodes/situation.ts";
import { makeRetrievePlays } from "./nodes/retrievePlays.ts";
import { HEAD_COACH_ENDS, makeHeadCoach } from "./nodes/headCoach.ts";
import { makeAssembleDirective } from "./nodes/assembleDirective.ts";
import { makeValidateDirective } from "./nodes/validateDirective.ts";
import { TeamGraphInput, TeamGraphOutput, TeamGraphState } from "./state.ts";

export const STUB_TEAM_NODES = ["ingest", "assemble_directive", "validate_directive"] as const;

export const TEAM_GRAPH_NODES = [
  "ingest",
  "situation",
  "retrieve_plays",
  "head_coach",
  "assemble_directive",
  "validate_directive",
] as const;

export type CompileTeamGraphOpts = {
  side: Side;
  playbook: Playbook;
  checkpointer?: BaseCheckpointSaver;
  /** Skip grok-4.5 in head_coach. Stub assemble still uses the seed default play. */
  noLlm?: boolean;
};

export type TeamGraphInvokeInput = {
  observation: TeamObservation;
  epochReason: string;
  epochKind: "macro" | "micro";
  lastDirective: TeamDirective;
};

export type TeamGraphInvokeConfig = {
  configurable?: { thread_id?: string };
  signal?: AbortSignal;
  recursionLimit?: number;
  callbacks?: unknown[];
  streamMode?: "values" | "updates" | "debug" | "tasks";
};

/**
 * Compile: START → ingest → situation → retrieve_plays → (macro) head_coach
 * → assemble_directive → validate_directive → END.
 * head_coach Command.goto = assemble_directive only (no specialist Send).
 * Micro skips head_coach (captain lands in PR 11). Same factory for home/away;
 * playbooks stay private via closure.
 */
export type CompiledTeamGraph = {
  nodes: Record<string, unknown>;
  invoke: (input: TeamGraphInvokeInput, config?: TeamGraphInvokeConfig) => Promise<unknown>;
  stream: (
    input: TeamGraphInvokeInput,
    config?: TeamGraphInvokeConfig,
  ) => Promise<AsyncIterable<Record<string, unknown>>>;
};

/** Conditional edge after retrieve_plays. Reads graph-state epochKind, not observation. */
export function epochRouter(state: { epochKind?: unknown }): "head_coach" | "assemble_directive" {
  return state.epochKind === "macro" ? "head_coach" : "assemble_directive";
}

export function compileTeamGraph(opts: CompileTeamGraphOpts): CompiledTeamGraph {
  void opts.side;
  const checkpointer = opts.checkpointer ?? new MemorySaver();
  const noLlm = opts.noLlm === true;
  const compiled = new StateGraph({
    state: TeamGraphState,
    input: TeamGraphInput,
    output: TeamGraphOutput,
  })
    .addNode("ingest", ingest)
    // Node `situation`; state channel is classifiedSituation (JS forbids same names).
    .addNode("situation", situation)
    .addNode("retrieve_plays", makeRetrievePlays(opts.playbook))
    .addNode("head_coach", makeHeadCoach({ noLlm }) as never, { ends: [...HEAD_COACH_ENDS] })
    .addNode("assemble_directive", makeAssembleDirective(opts.playbook))
    .addNode("validate_directive", makeValidateDirective(opts.playbook))
    .addEdge(START, "ingest")
    .addEdge("ingest", "situation")
    .addEdge("situation", "retrieve_plays")
    .addConditionalEdges("retrieve_plays", epochRouter as never, {
      head_coach: "head_coach",
      assemble_directive: "assemble_directive",
    })
    .addEdge("assemble_directive", "validate_directive")
    .addEdge("validate_directive", END)
    .compile({ checkpointer });
  return compiled as CompiledTeamGraph;
}
