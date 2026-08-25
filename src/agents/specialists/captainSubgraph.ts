import { compileSpecialistGraph, type CompileSpecialistOpts } from "./compile.ts";

const CAPTAIN_SYSTEM =
  "You are the NHL Captain. Occupy ice: support the puck-carrier, fill the backdoor, " +
  "attack the net when we have it, gap-up when we don't. Prefer a pass that creates a shot " +
  "over a dump. Macro: on-ice read. Micro: you are the only LLM; playIdSuggestion must be " +
  "one of retrievedPlays. Output structured advice only.";

export function compileCaptainSubgraph(opts: Pick<CompileSpecialistOpts, "noLlm" | "profile"> = {}) {
  return compileSpecialistGraph("captain", {
    noLlm: opts.noLlm,
    profile: opts.profile,
    system: CAPTAIN_SYSTEM,
    privateKey: "iceRead",
  });
}
