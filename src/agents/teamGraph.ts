import {
  END,
  MemorySaver,
  START,
  StateGraph,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { TeamDirective } from "../types/directive.ts";
import type { Side } from "../types/hockey.ts";
import type { TeamLlmProfile } from "../llm/profiles.ts";
import type { Playbook } from "../types/play.ts";
import type { TeamObservation } from "../types/observation.ts";
import { ingest } from "./nodes/ingest.ts";
import { situation } from "./nodes/situation.ts";
import { makeRetrievePlays } from "./nodes/retrievePlays.ts";
import { HEAD_COACH_ENDS, makeHeadCoach } from "./nodes/headCoach.ts";
import { makeAssembleDirective } from "./nodes/assembleDirective.ts";
import { makeValidateDirective } from "./nodes/validateDirective.ts";
import { TeamGraphInput, TeamGraphOutput, TeamGraphState } from "./state.ts";
import { SpecialistInputSchema, wrapSpecialist } from "./wrapSpecialist.ts";
import {
  compileCaptainSubgraph,
  compileDcSubgraph,
  compileGoalieSubgraph,
  compileOcSubgraph,
  compileScoutSubgraph,
  compileStSubgraph,
} from "./specialists/index.ts";

export const STUB_TEAM_NODES = ["ingest", "assemble_directive", "validate_directive"] as const;

export const SPECIALIST_NODES = ["oc", "dc", "st", "goalie", "captain", "scout"] as const;

export const TEAM_GRAPH_NODES = [
  "ingest",
  "situation",
  "retrieve_plays",
  "head_coach",
  "oc",
  "dc",
  "st",
  "goalie",
  "captain",
  "scout",
  "assemble_directive",
  "validate_directive",
] as const;

export type CompileTeamGraphOpts = {
  side: Side;
  playbook: Playbook;
  checkpointer?: BaseCheckpointSaver;
  /** Skip grok-4.5 and grok-4.3. Stub assemble still uses the seed default play. */
  noLlm?: boolean;
  /** Per-side company. Ignored when noLlm. Default xAI when omitted. */
  profile?: TeamLlmProfile;
  /** Specialists run only when opted in. */
  specialists?: boolean;
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
 * → assemble_directive (Send[] specialists only when opts.specialists);
 * (micro) captain → assemble_directive → validate_directive → END.
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
export function epochRouter(state: { epochKind?: unknown }): "head_coach" | "captain" {
  return state.epochKind === "macro" ? "head_coach" : "captain";
}

export function compileTeamGraph(opts: CompileTeamGraphOpts): CompiledTeamGraph {
  void opts.side;
  const checkpointer = opts.checkpointer ?? new MemorySaver();
  const noLlm = opts.noLlm === true;
  const profile = noLlm ? undefined : opts.profile;
  const specOpts = { noLlm, profile };
  const compiled = new StateGraph({
    state: TeamGraphState,
    input: TeamGraphInput,
    output: TeamGraphOutput,
  })
    .addNode("ingest", ingest)
    // Node `situation`; state channel is classifiedSituation (JS forbids same names).
    .addNode("situation", situation)
    .addNode("retrieve_plays", makeRetrievePlays(opts.playbook))
    .addNode("head_coach", makeHeadCoach({ noLlm, profile, specialists: opts.specialists === true }) as never, {
      ends: [...HEAD_COACH_ENDS],
    })
    .addNode("oc", wrapSpecialist("oc", compileOcSubgraph(specOpts)) as never, {
      input: SpecialistInputSchema,
    })
    .addNode("dc", wrapSpecialist("dc", compileDcSubgraph(specOpts)) as never, {
      input: SpecialistInputSchema,
    })
    .addNode("st", wrapSpecialist("st", compileStSubgraph(specOpts)) as never, {
      input: SpecialistInputSchema,
    })
    .addNode("goalie", wrapSpecialist("goalie", compileGoalieSubgraph(specOpts)) as never, {
      input: SpecialistInputSchema,
    })
    .addNode("captain", wrapSpecialist("captain", compileCaptainSubgraph(specOpts)) as never, {
      input: SpecialistInputSchema,
    })
    .addNode("scout", wrapSpecialist("scout", compileScoutSubgraph(specOpts)) as never, {
      input: SpecialistInputSchema,
    })
    .addNode("assemble_directive", makeAssembleDirective(opts.playbook))
    .addNode("validate_directive", makeValidateDirective(opts.playbook))
    .addEdge(START, "ingest")
    .addEdge("ingest", "situation")
    .addEdge("situation", "retrieve_plays")
    .addConditionalEdges("retrieve_plays", epochRouter as never, {
      head_coach: "head_coach",
      captain: "captain",
    })
    .addEdge("oc", "assemble_directive")
    .addEdge("dc", "assemble_directive")
    .addEdge("st", "assemble_directive")
    .addEdge("goalie", "assemble_directive")
    .addEdge("captain", "assemble_directive")
    .addEdge("scout", "assemble_directive")
    .addEdge("assemble_directive", "validate_directive")
    .addEdge("validate_directive", END)
    .compile({ checkpointer });
  return compiled as CompiledTeamGraph;
}
