import { describe, expect, it } from "vitest";
import { checkpointDbPath, defaultDbPath } from "./index.ts";
import { MEMORY_PATH, SCHEMA_VERSION, openMemoryDb } from "./db.ts";

describe("persist db (sql.js)", () => {
  it("opens an in-memory database at schema version 1", async () => {
    const db = await openMemoryDb();
    try {
      expect(db.path).toBe(MEMORY_PATH);
      expect(Number(db.pragma("user_version"))).toBe(SCHEMA_VERSION);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all<{ name: string }>()
        .map((r) => r.name);
      expect(tables).toEqual(
        expect.arrayContaining([
          "matches",
          "events",
          "epoch_invocations",
          "playbooks",
          "aar_reports",
          "recordings",
          "clips",
          "improvement_ledger",
        ]),
      );
    } finally {
      db.close();
    }
  });

  it("keeps checkpoints on a separate path from match events", () => {
    const ck = checkpointDbPath("root");
    const match = defaultDbPath("root");
    expect(ck).not.toBe(match);
    expect(ck.endsWith("checkpoints.sqlite")).toBe(true);
    expect(match.endsWith("graph-hockey.sqlite")).toBe(true);
  });
});
