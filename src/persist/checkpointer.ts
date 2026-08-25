import { join } from "node:path";

/**
 * LangGraph `SqliteSaver` uses this file — never mix with match events
 * (`data/graph-hockey.sqlite`). Stub graphs in this PR use in-memory `MemorySaver`.
 */
export const CHECKPOINTS_FILENAME = "checkpoints.sqlite";

export function checkpointDbPath(root = process.cwd()): string {
  return join(root, "data", CHECKPOINTS_FILENAME);
}
