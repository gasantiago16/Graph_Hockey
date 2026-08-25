import { describe, expect, it } from "vitest";
import { createWorld } from "../engine/world.ts";
import { loadPlaybook, loadTeam } from "../playbook/store.ts";
import {
  ClientHelloSchema,
  SpectatorFrameSchema,
  StartMatchBodySchema,
} from "../types/ws.ts";
import {
  corsOrigins,
  denylistHits,
  opponentPlayLeak,
  originAllowed,
  parseClientMessage,
  tickMessages,
} from "./protocol.ts";
import { inspectState, spectatorFrame } from "./spectator.ts";

const HOME_PLAY = "5v5-122-forecheck";
const AWAY_PLAY = "5v5-212-forecheck";

function worldWithPlays() {
  return createWorld({
    matchId: "denylist-match",
    playId: { home: HOME_PLAY, away: AWAY_PLAY },
    playbooks: {
      home: loadPlaybook("original-six"),
      away: loadPlaybook("expansion"),
    },
    puck: { pos: { x: 40, y: -12 }, vel: { x: 3, y: 1 } },
    lastEvents: [
      {
        id: "denylist-match:9",
        seq: 9,
        liveTick: 12,
        stoppageSeq: 1,
        period: 1,
        type: "Goal",
        playId: AWAY_PLAY,
        payload: {
          directive: { playId: AWAY_PLAY, pressure: "aggressive" },
          XAI_API_KEY: "must-not-leak",
        },
      },
    ],
  });
}

describe("WS protocol denylist", () => {
  it("snapshot is world-frame public geometry without playId or opponent state", () => {
    const world = worldWithPlays();
    const frame = spectatorFrame(world, {
      rosters: { home: loadTeam("original-six"), away: loadTeam("expansion") },
    });
    expect(SpectatorFrameSchema.parse(frame).type).toBe("snapshot");
    expect(frame.puck.x).toBe(40);
    expect(frame.puck.y).toBe(-12);
    expect(frame.lastEvent).toEqual({ id: "denylist-match:9", type: "Goal" });
    const json = JSON.stringify(frame);
    expect(json).not.toContain(HOME_PLAY);
    expect(json).not.toContain(AWAY_PLAY);
    expect(json).not.toContain("XAI_API_KEY");
    expect(json).not.toContain("must-not-leak");
    expect(json).not.toContain("playbooks");
    expect(denylistHits(frame)).toEqual([]);
    expect(opponentPlayLeak(frame, "none", world.playId)).toEqual([]);
  });

  it("inspect home includes only the home playId", () => {
    const world = worldWithPlays();
    const inspect = inspectState(world, "home");
    expect(inspect.playId).toBe(HOME_PLAY);
    expect(inspect.playName).toBe("F1 1-2-2 dump-and-chase");
    expect(JSON.stringify(inspect)).not.toContain(AWAY_PLAY);
    expect(denylistHits(inspect)).toEqual([]);
    expect(opponentPlayLeak(inspect, "home", world.playId)).toEqual([]);
  });

  it("inspect away includes only the away playId", () => {
    const world = worldWithPlays();
    const inspect = inspectState(world, "away");
    expect(inspect.playId).toBe(AWAY_PLAY);
    expect(inspect.playName).toBe("F1 2-1-2 hunt");
    expect(JSON.stringify(inspect)).not.toContain(HOME_PLAY);
    expect(opponentPlayLeak(inspect, "away", world.playId)).toEqual([]);
  });

  it("tickMessages for inspect none never include either playId", () => {
    const world = worldWithPlays();
    const msgs = tickMessages(world, "none", world.lastEvents);
    const json = JSON.stringify(msgs);
    expect(json).not.toContain(HOME_PLAY);
    expect(json).not.toContain(AWAY_PLAY);
    expect(msgs.some((m) => m.type === "inspect")).toBe(false);
    expect(denylistHits(msgs)).toEqual([]);
    expect(opponentPlayLeak(msgs, "none", world.playId)).toEqual([]);
  });

  it("tickMessages for inspect home omit away playId even when lastEvent carried it", () => {
    const world = worldWithPlays();
    const msgs = tickMessages(world, "home", world.lastEvents);
    expect(msgs.some((m) => m.type === "inspect")).toBe(true);
    expect(opponentPlayLeak(msgs, "home", world.playId)).toEqual([]);
    expect(JSON.stringify(msgs)).not.toContain(AWAY_PLAY);
    expect(JSON.stringify(msgs)).toContain(HOME_PLAY);
  });

  it("does not put DirectiveApplied (payload includes TeamDirective) on the ticker", () => {
    const world = createWorld({
      matchId: "m",
      playId: { home: HOME_PLAY, away: AWAY_PLAY },
    });
    const msgs = tickMessages(world, "none", [
      {
        id: "m:1",
        seq: 1,
        liveTick: 1,
        stoppageSeq: 0,
        period: 1,
        type: "DirectiveApplied",
        payload: { side: "away", directive: { playId: AWAY_PLAY, pressure: "neutral" } },
      },
    ]);
    expect(msgs.filter((m) => m.type === "event")).toHaveLength(0);
    expect(JSON.stringify(msgs)).not.toContain(AWAY_PLAY);
  });

  it("parses client hello defaulting inspect to none", () => {
    expect(ClientHelloSchema.parse({ type: "hello" }).inspectSide).toBe("none");
    expect(parseClientMessage(`{"type":"hello","inspectSide":"away"}`)).toEqual({
      inspectSide: "away",
    });
    expect(parseClientMessage(`{"type":"inspect","side":"home"}`)).toEqual({
      inspectSide: "home",
    });
    expect(parseClientMessage("not-json")).toBeNull();
  });

  it("locks CORS/WS origin to localhost on the bound port", () => {
    expect(corsOrigins(8787)).toEqual(["http://127.0.0.1:8787", "http://localhost:8787"]);
    expect(originAllowed(undefined, 8787)).toBe(true);
    expect(originAllowed("http://127.0.0.1:8787", 8787)).toBe(true);
    expect(originAllowed("http://localhost:8787", 8787)).toBe(true);
    expect(originAllowed("http://127.0.0.1:8788", 8787)).toBe(false);
    expect(originAllowed("http://evil.example", 8787)).toBe(false);
  });

  it("start body defaults noLlm true and leaves periodSeconds optional", () => {
    const body = StartMatchBodySchema.parse({ home: "original-six", away: "expansion", seed: 42 });
    expect(body.noLlm).toBe(true);
    expect(body.periodSeconds).toBeUndefined();
    expect(() => StartMatchBodySchema.parse({ noLlm: true, periodSeconds: 5 })).not.toThrow();
  });
});
