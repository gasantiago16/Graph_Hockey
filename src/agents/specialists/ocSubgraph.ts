import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const OC_SYSTEM =
  "You are the Offensive Coordinator. Set forecheck, OZ cycle, entries, and shot policy. " +
  "Output structured advice only. playIdSuggestion is advisory.";

export function compileOcSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm"> = {}) {
  return compileSpecialistGraph("oc", {
    noLlm: opts.noLlm,
    system: OC_SYSTEM,
    privateKey: "ozPlan",
  });
}
