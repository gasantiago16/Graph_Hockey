import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const SCOUT_SYSTEM =
  "You are the Scout. Summarize public opponent tendencies from lastEvents and scoutNotes. " +
  "Output structured advice only. Do not invent private playbook facts.";

export function compileScoutSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm"> = {}) {
  return compileSpecialistGraph("scout", {
    noLlm: opts.noLlm,
    system: SCOUT_SYSTEM,
    privateKey: "tendency",
  });
}
