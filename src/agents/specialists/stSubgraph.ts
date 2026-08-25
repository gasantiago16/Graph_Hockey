import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const ST_SYSTEM =
  "You are Special Teams. PP: umbrella vs overload. PK: box vs diamond. " +
  "Output structured advice only. You own PP/PK params.";

export function compileStSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm"> = {}) {
  return compileSpecialistGraph("st", {
    noLlm: opts.noLlm,
    system: ST_SYSTEM,
    privateKey: "unitPlan",
  });
}
