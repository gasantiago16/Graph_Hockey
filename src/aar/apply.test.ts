import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../persist/db.ts";
import { getAarReport, insertMatch } from "../persist/matches.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
import { persistAarReport } from "./apply.ts";

describe("persistAarReport", () => {
  it("writes aar_reports without applying", async () => {
    const db = await openMemoryDb();
    try {
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      persistAarReport(
        db,
        {
          matchId: "m1",
          side: "home",
          result: "win",
          actualSummary: "xG 1-0",
          revision: { summary: "ok", ops: [] },
        },
        false,
      );
      const row = getAarReport(db, "m1", "home");
      expect(row?.applied).toBe(false);
      expect((row?.body as { actualSummary?: string }).actualSummary).toBe("xG 1-0");
    } finally {
      db.close();
    }
  });
});
