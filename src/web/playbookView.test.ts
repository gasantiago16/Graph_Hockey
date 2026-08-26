import { describe, expect, it } from "vitest";
import { diffPlaybooks } from "../playbook/diff.ts";
import { applyPlaybookRevision } from "../playbook/mutate.ts";
import { loadPlaybook } from "../playbook/store.ts";
import {
  formatDiffEntry,
  parsePlaybookQuery,
  playbookApiHref,
  renderPlaybookDiffHtml,
  wantDiffParam,
} from "./playbookView.ts";

describe("playbook query", () => {
  it("parses diff=1 and builds /api/playbook/:team?diff=1", () => {
    expect(wantDiffParam("1")).toBe(true);
    expect(wantDiffParam("true")).toBe(true);
    expect(wantDiffParam("0")).toBe(false);
    expect(wantDiffParam(null)).toBe(false);
    expect(parsePlaybookQuery("?diff=1&match=m1")).toEqual({
      matchId: "m1",
      version: undefined,
      diff: true,
    });
    expect(playbookApiHref("original-six", { diff: true, matchId: "m1" })).toBe(
      "/api/playbook/original-six?diff=1&match=m1",
    );
    expect(playbookApiHref("expansion")).toBe("/api/playbook/expansion");
  });
});

describe("renderPlaybookDiffHtml", () => {
  it("renders version field diff after a boost", () => {
    const from = loadPlaybook("original-six");
    const to = applyPlaybookRevision(
      from,
      {
        summary: "boost",
        ops: [{ op: "boost", playId: "5v5-122-forecheck", reason: "lock", eventIds: ["m:0"] }],
      },
      {
        result: "win",
        knownEventIds: ["m:0"],
        playUsage: [{ playId: "5v5-122-forecheck", xgFor: 0.5, xgAgainst: 0, seconds: 60, xgShare: 1 }],
      },
    ).book;
    const diff = diffPlaybooks(from, to);
    const html = renderPlaybookDiffHtml(diff, { applied: true });
    expect(html).toContain("original-six");
    expect(html).toContain(`v${diff.fromVersion} → v${diff.toVersion}`);
    expect(html).toContain("5v5-122-forecheck");
    expect(html).toContain("stats");
    expect(html).toContain("applied");
    const changed = diff.changed.find((c) => c.id === "5v5-122-forecheck");
    expect(changed).toBeTruthy();
    expect(formatDiffEntry(changed!)).toContain("~");
  });

  it("empty diff says no play changes", () => {
    const book = loadPlaybook("expansion");
    const diff = diffPlaybooks(book, book);
    const html = renderPlaybookDiffHtml(diff);
    expect(html).toContain("(no play changes)");
    expect(html).not.toContain("<script>");
  });
});
