import { describe, expect, it } from "vitest";
import { parseFilmQuery, filmHref, clipDurationSeconds, progressToTick, tickToProgress, frameIndexForTick, stepFrameIndex } from "./filmRoom.ts";

describe("Film Room query + playhead", () => {
  it("parses /film?match=&clip=&event=&t=", () => {
    expect(parseFilmQuery("?match=abc&clip=abc:clip:0&t=40")).toEqual({
      matchId: "abc",
      clipId: "abc:clip:0",
      eventId: undefined,
      tick: 40,
    });
    expect(parseFilmQuery("event=abc:12")).toEqual({
      matchId: undefined,
      clipId: undefined,
      eventId: "abc:12",
      tick: undefined,
    });
    expect(filmHref({ matchId: "m1", tick: 9 })).toBe("/film?match=m1&t=9");
    expect(filmHref({})).toBe("/film");
  });

  it("maps clip progress to live ticks and frame index", () => {
    const clip = { startLiveTick: 50, endLiveTick: 150 };
    expect(clipDurationSeconds(clip)).toBe(10);
    expect(progressToTick(clip, 0)).toBe(50);
    expect(progressToTick(clip, 1)).toBe(150);
    expect(tickToProgress(clip, 100)).toBe(0.5);
    const frames = [{ liveTick: 50 }, { liveTick: 51 }, { liveTick: 80 }];
    expect(frameIndexForTick(frames, 51)).toBe(1);
    expect(frameIndexForTick(frames, 90)).toBe(2);
    expect(stepFrameIndex(1, -1, 3)).toBe(0);
    expect(stepFrameIndex(2, 5, 3)).toBe(2);
  });
});
