#!/usr/bin/env node
import { loadConfig, type EnvMap } from "../config.ts";

export const USAGE = `graph-hockey — competing LangGraph teams on a hockey rink

Usage:
  gh --help
  gh simulate [--home ID] [--away ID] [--seed N] [--no-llm]
  gh replay --match ID [--to-tick N]
  gh aar --match ID [--side home|away] [--aar-mode auto|propose|hitl]
  gh playbook --team ID [--diff] [--version N]
  gh series --games N --home ID --away ID [--seed N]
  gh footage --match ID
  gh footage --series ID [--compare i,j] [--json]
  gh engine-selftest

Commands other than --help are stubs until later PRs.

LLM provider is xAI only (XAI_API_KEY, https://api.x.ai/v1).
The browser never receives API keys and never calls xAI.
Engine tests and --no-llm do not require XAI_API_KEY.
`;

const KNOWN_COMMANDS = new Set([
  "simulate",
  "replay",
  "aar",
  "playbook",
  "series",
  "footage",
  "engine-selftest",
]);

export function main(argv: string[], env: EnvMap = process.env): number {
  loadConfig(env);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE.trimEnd());
    return 0;
  }
  const cmd = argv[0];
  if (cmd !== undefined && KNOWN_COMMANDS.has(cmd)) {
    console.error(`gh ${cmd}: not implemented yet`);
    return 1;
  }
  console.error(`gh: unknown command '${cmd ?? ""}'. Try gh --help`);
  return 1;
}

const invoked = process.argv[1]?.replaceAll("\\", "/");
if (invoked && /\/cli\/main\.(ts|js)$/.test(invoked)) {
  process.exit(main(process.argv.slice(2)));
}
