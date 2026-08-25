import { describe, expect, it } from "vitest";
import { sortHighlightClips } from "./exportMp4.ts";
import type { Clip } from "../types/film.ts";

function clip(over: Partial<Clip> & Pick<Clip, "id" | "kind">): Clip {
  return {
    matchId: "m",
    startLiveTick: over.startLiveTick ?? 0,
    endLiveTick: over.endLiveTick ?? 10,
    anchorEventId: "m:0",
    relatedEventIds: [],
    title: over.kind,
    source: "auto",
    ...over,
  };
}

describe("sortHighlightClips", () => {
  it("puts goals ahead of shots", () => {
    const ordered = sortHighlightClips([
      clip({ id: "s", kind: "shot", startLiveTick: 1 }),
      clip({ id: "g", kind: "goal", startLiveTick: 40 }),
      clip({ id: "p", kind: "penalty", startLiveTick: 2 }),
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["g", "s", "p"]);
  });
});
