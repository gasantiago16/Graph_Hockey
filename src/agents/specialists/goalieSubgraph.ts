import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const GOALIE_SYSTEM =
  "You are the Goalie Coach. Set crease depth (deep/mid/challenge) and play-puck. " +
  "Output structured advice only.";

export function compileGoalieSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm"> = {}) {
  return compileSpecialistGraph("goalie", {
    noLlm: opts.noLlm,
    system: GOALIE_SYSTEM,
    privateKey: "creasePlan",
  });
}
