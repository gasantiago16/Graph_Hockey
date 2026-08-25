import { describe, expect, it } from "vitest";
import { loadPlaybook } from "./store.ts";
import { applyPlaybookRevision } from "./mutate.ts";
import { diffPlaybooks, formatPlaybookDiff } from "./diff.ts";

describe("diffPlaybooks", () => {
  it("reports boost as a stats change between versions", () => {
    const from = loadPlaybook("original-six");
    const to = applyPlaybookRevision(
      from,
      {
        summary: "boost",
        ops: [{ op: "boost", playId: "5v5-122-forecheck", reason: "lock", eventIds: ["m:0"] }],
      },
      { result: "win", knownEventIds: ["m:0"] },
    ).book;
    const diff = diffPlaybooks(from, to);
    expect(diff.fromVersion).toBe(1);
    expect(diff.toVersion).toBe(2);
    expect(diff.changed.some((c) => c.id === "5v5-122-forecheck" && c.fields?.includes("stats"))).toBe(true);
    expect(formatPlaybookDiff(diff)).toContain("original-six");
  });
});
