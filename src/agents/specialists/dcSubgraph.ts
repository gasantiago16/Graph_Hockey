import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const DC_SYSTEM =
  "You are the Defensive Coordinator. Set NZ trap, DZ coverage, gap, and breakout. " +
  "Output structured advice only. playIdSuggestion is advisory.";

export function compileDcSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm"> = {}) {
  return compileSpecialistGraph("dc", {
    noLlm: opts.noLlm,
    system: DC_SYSTEM,
    privateKey: "dzPlan",
  });
}
