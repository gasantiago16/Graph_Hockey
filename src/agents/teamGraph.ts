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
import { makeAssembleDirective } from "./nodes/assembleDirective.ts";
import { makeValidateDirective } from "./nodes/validateDirective.ts";
import { TeamGraphInput, TeamGraphOutput, TeamGraphState } from "./state.ts";

export const STUB_TEAM_NODES = ["ingest", "assemble_directive", "validate_directive"] as const;

export type CompileTeamGraphOpts = {
  side: Side;
  playbook: Playbook;
  checkpointer?: BaseCheckpointSaver;
};

/**
 * Stub compile: START → ingest → assemble_directive → validate_directive → END.
 * No LLM, no head_coach, no specialist Send. Same factory for home and away;
 * playbooks stay private via closure.
 */
export type CompiledTeamGraph = {
  nodes: Record<string, unknown>;
  invoke: (
    input: {
      observation: TeamObservation;
      epochReason: string;
      epochKind: "macro" | "micro";
      lastDirective: TeamDirective;
    },
    config?: {
      configurable?: { thread_id?: string };
      signal?: AbortSignal;
      recursionLimit?: number;
    },
  ) => Promise<unknown>;
};

export function compileTeamGraph(opts: CompileTeamGraphOpts): CompiledTeamGraph {
  void opts.side;
  const checkpointer = opts.checkpointer ?? new MemorySaver();
  const compiled = new StateGraph({
    state: TeamGraphState,
    input: TeamGraphInput,
    output: TeamGraphOutput,
  })
    .addNode("ingest", ingest)
    .addNode("assemble_directive", makeAssembleDirective(opts.playbook))
    .addNode("validate_directive", makeValidateDirective(opts.playbook))
    .addEdge(START, "ingest")
    .addEdge("ingest", "assemble_directive")
    .addEdge("assemble_directive", "validate_directive")
    .addEdge("validate_directive", END)
    .compile({ checkpointer });
  return compiled as CompiledTeamGraph;
}
