import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const ST_SYSTEM =
  "You are Special Teams. PP: umbrella vs overload. PK: box vs diamond. " +
  "Output structured advice only. You own PP/PK params.";

export function compileStSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm" | "profile"> = {}) {
  return compileSpecialistGraph("st", {
    noLlm: opts.noLlm,
    profile: opts.profile,
    system: ST_SYSTEM,
    privateKey: "unitPlan",
  });
}
