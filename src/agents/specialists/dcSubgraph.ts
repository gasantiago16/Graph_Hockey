import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const DC_SYSTEM =
  "You are the Defensive Coordinator. Set NZ trap, DZ coverage, gap, and breakout. " +
  "Output structured advice only. playIdSuggestion is advisory.";

export function compileDcSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm" | "profile"> = {}) {
  return compileSpecialistGraph("dc", {
    noLlm: opts.noLlm,
    profile: opts.profile,
    system: DC_SYSTEM,
    privateKey: "dzPlan",
  });
}
