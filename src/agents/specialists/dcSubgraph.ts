import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const DC_SYSTEM =
  "You are the NHL Defensive Coordinator. Tight gaps, sticks in passing lanes, D-to-D or D-to-winger " +
  "breakout pass (not a panic dump). Collapse the slot if they have the puck in our DZ. " +
  "Output structured advice only. playIdSuggestion is advisory.";

export function compileDcSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm" | "profile"> = {}) {
  return compileSpecialistGraph("dc", {
    noLlm: opts.noLlm,
    profile: opts.profile,
    system: DC_SYSTEM,
    privateKey: "dzPlan",
  });
}
