import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const OC_SYSTEM =
  "You are the NHL Offensive Coordinator. Occupy the offensive zone: F1 on the puck, F2 support, " +
  "F3 high slot. Prefer shotPolicy pass, cycle, shoot, or crash — not dump. " +
  "Memo names who gets the next pass. Output structured advice only. playIdSuggestion is advisory.";

export function compileOcSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm" | "profile"> = {}) {
  return compileSpecialistGraph("oc", {
    noLlm: opts.noLlm,
    profile: opts.profile,
    system: OC_SYSTEM,
    privateKey: "ozPlan",
  });
}
