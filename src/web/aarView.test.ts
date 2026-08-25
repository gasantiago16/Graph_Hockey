import { describe, expect, it } from "vitest";
import type { AarReport } from "../types/aar.ts";
import type { PlayMutation } from "../types/play.ts";
import { parseFilmQuery } from "./filmRoom.ts";
import {
  aarHref,
  collectWatchEventIds,
  describeMutation,
  escapeHtml,
  parseAarQuery,
  parseAarSide,
  renderAarReportHtml,
  renderWatchLink,
  watchHref,
} from "./aarView.ts";

const BOOST: PlayMutation = {
  op: "boost",
  playId: "5v5-122-forecheck",
  reason: "goal sequence",
  eventIds: ["m1:12"],
};

function report(over: Partial<AarReport> = {}): AarReport {
  return {
    matchId: "m1",
    side: "home",
    result: "win",
    intentSummary: "Hold the 1-2-2 dump-and-chase.",
    actualSummary: "xG 1.2–0.4 · 1–0",
    causes: [
      {
        claim: "OZ cycle produced the goal",
        eventIds: ["m1:12"],
        playIds: ["5v5-122-forecheck"],
      },
    ],
    revision: { summary: "lock the 1-2-2", ops: [BOOST] },
    ...over,
  };
}

describe("AAR query + Watch links", () => {
  it("parses /aar?match=&side=", () => {
    expect(parseAarQuery("?match=m1&side=away")).toEqual({ matchId: "m1", side: "away" });
    expect(parseAarQuery("match=m1&side=both")).toEqual({ matchId: "m1", side: undefined });
    expect(parseAarSide("home")).toBe("home");
    expect(parseAarSide("nope")).toBeUndefined();
    expect(aarHref({ matchId: "m1", side: "home" })).toBe("/aar?match=m1&side=home");
    expect(aarHref({})).toBe("/aar");
  });

  it("Watch href is /film?match=&event= and Film Room can parse it", () => {
    const href = watchHref("m1", "m1:12");
    expect(href.startsWith("/film?")).toBe(true);
    expect(href).toContain("match=m1");
    expect(href).toContain("event=");
    const q = href.slice(href.indexOf("?"));
    expect(parseFilmQuery(q)).toEqual({
      matchId: "m1",
      clipId: undefined,
      eventId: "m1:12",
      tick: undefined,
    });
    expect(renderWatchLink("m1", "m1:12")).toContain("Watch");
    expect(renderWatchLink("m1", "m1:12")).toContain(href.replace(/&/g, "&amp;"));
  });
});

describe("renderAarReportHtml", () => {
  it("shows supposed/actual/why/ops with Watch on eventIds", () => {
    const html = renderAarReportHtml(report(), { applied: true });
    expect(html).toContain("Supposed");
    expect(html).toContain("Hold the 1-2-2 dump-and-chase.");
    expect(html).toContain("Actual");
    expect(html).toContain("xG 1.2–0.4");
    expect(html).toContain("Why");
    expect(html).toContain("OZ cycle produced the goal");
    expect(html).toContain("Ops");
    expect(html).toContain("boost 5v5-122-forecheck");
    expect(html).toContain("Watch");
    expect(html).toContain("/film?");
    expect(html).toContain("event=");
    expect(html).toContain("applied");
    expect(collectWatchEventIds(report())).toEqual(["m1:12"]);
  });

  it("escapes LLM text and still links Watch", () => {
    const html = renderAarReportHtml(
      report({
        intentSummary: "<script>alert(1)</script>",
        causes: [{ claim: "x < y", eventIds: ["m1:3"], playIds: [] }],
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("x &lt; y");
    expect(html).toContain(escapeHtml(watchHref("m1", "m1:3")));
    expect(html).toContain("Watch");
    expect(describeMutation(BOOST)).toContain("boost");
  });

  it("code-only empty causes/ops still render the four sections", () => {
    const html = renderAarReportHtml(
      report({
        noLlm: true,
        causes: [],
        revision: { summary: "code-only AAR digest", ops: [] },
      }),
      { applied: false },
    );
    expect(html).toContain("Supposed");
    expect(html).toContain("Actual");
    expect(html).toContain("Why");
    expect(html).toContain("Ops");
    expect(html).toContain("No cited causes (code-only AAR).");
    expect(html).toContain("No playbook mutations.");
    expect(html).toContain("proposed (not applied)");
  });
});
