import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { drawSpectatorFrame, EXPORT_HEIGHT, EXPORT_WIDTH, worldTo } from "./drawFrame.ts";
import type { SpectatorFrame } from "../types/ws.ts";

const frame: SpectatorFrame = {
  type: "snapshot",
  matchId: "m",
  liveTick: 10,
  stoppageSeq: 0,
  period: 1,
  clockRemaining: 59.2,
  score: { home: 1, away: 0 },
  strength: "5v5",
  phase: "live",
  puck: { x: 20, y: 4, vx: 0, vy: 0 },
  players: [
    { id: "h-C", side: "home", number: 9, position: "C", x: 18, y: 0, heading: 0 },
    { id: "a-G", side: "away", number: 1, position: "G", x: 89, y: 0, heading: Math.PI },
  ],
  lastEvent: null,
};

describe("drawSpectatorFrame", () => {
  it("fills an EXPORT_WIDTH x EXPORT_HEIGHT rgba buffer", () => {
    const canvas = createCanvas(EXPORT_WIDTH, EXPORT_HEIGHT);
    const ctx = canvas.getContext("2d");
    drawSpectatorFrame(ctx, frame);
    const img = ctx.getImageData(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);
    expect(img.data.length).toBe(EXPORT_WIDTH * EXPORT_HEIGHT * 4);
    const ice = worldTo(ctx, 0, 0);
    const px = (Math.floor(ice.x) + Math.floor(ice.y) * EXPORT_WIDTH) * 4;
    expect(img.data[px + 3]).toBe(255);
  });
});
