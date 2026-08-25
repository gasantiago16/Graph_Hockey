import { describe, expect, it, vi } from "vitest";
import { AAR_CITATION_REJECTED } from "../../types/aar.ts";
import type { PlayMutation } from "../../types/play.ts";
import { filterCitedOps } from "./citeCheck.ts";

const boost = (eventIds: string[], playId = "5v5-122-forecheck"): PlayMutation => ({
  op: "boost",
  playId,
  reason: "test",
  eventIds,
});

describe("cite_check", () => {
  it("keeps ops whose eventIds are in this match and drops the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { kept, rejectedOps } = filterCitedOps(
        [boost(["m:0"]), boost(["m:99"]), boost(["ghost:1"]), boost(["m:1", "m:0"])],
        ["m:0", "m:1"],
      );
      expect(kept.map((o) => o.eventIds)).toEqual([["m:0"], ["m:1", "m:0"]]);
      expect(rejectedOps).toHaveLength(2);
      expect(rejectedOps[0]).toContain("unknown");
      expect(warn).toHaveBeenCalledWith(AAR_CITATION_REJECTED, expect.any(String));
    } finally {
      warn.mockRestore();
    }
  });

  it("drops ops with empty eventIds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { kept, rejectedOps } = filterCitedOps(
        [{ op: "boost", playId: "x", reason: "r", eventIds: [] } as unknown as PlayMutation],
        ["m:0"],
      );
      expect(kept).toEqual([]);
      expect(rejectedOps[0]).toContain("missing");
    } finally {
      warn.mockRestore();
    }
  });
});
