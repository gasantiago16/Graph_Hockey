import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const CAPTAIN_SYSTEM =
  "You are the Captain. Macro: on-ice read. Micro: you are the only LLM; " +
  "playIdSuggestion must be one of retrievedPlays. Output structured advice only.";

export function compileCaptainSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm"> = {}) {
  return compileSpecialistGraph("captain", {
    noLlm: opts.noLlm,
    system: CAPTAIN_SYSTEM,
    privateKey: "iceRead",
  });
}
