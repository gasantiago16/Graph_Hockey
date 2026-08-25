import { describe, expect, it } from "vitest";
import { createWorld } from "../engine/world.ts";
import { createBudget, recordLlmUsage, toCostTick } from "../llm/budgets.ts";
import { loadPlaybook, loadTeam } from "../playbook/store.ts";
import { formatCostHud } from "../web/hud.ts";
import { formatInspectHud, PLAY_NAME_HIDDEN } from "../web/inspect.ts";
import {
  ClientHelloSchema,
  MatchStartSchema,
  SpectatorFrameSchema,
  StartMatchBodySchema,
  StartSeriesBodySchema,
} from "../types/ws.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  corsOrigins,
  DENYLIST_KEYS,
  denylistHits,
  opponentPlayLeak,
  originAllowed,
  parseClientMessage,
  tickMessages,
} from "./protocol.ts";
import { inspectState, maybeInspectState, spectatorFrame } from "./spectator.ts";

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

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../web");

describe("WS protocol denylist", () => {
  it("lists every vendor key name", () => {
    expect(DENYLIST_KEYS).toEqual(
      expect.arrayContaining([
        "XAI_API_KEY",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        "MODEL_API_KEY",
        "MUSE_API_KEY",
      ]),
    );
    const html = readFileSync(join(webRoot, "index.html"), "utf8");
    const js = readFileSync(join(webRoot, "spectator.js"), "utf8");
    for (const key of ["XAI_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MODEL_API_KEY", "MUSE_API_KEY"]) {
      expect(html).not.toContain(key);
      expect(js).not.toContain(key);
    }
  });

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
    expect(json).not.toContain("OPENAI_API_KEY");
    expect(json).not.toContain("MODEL_API_KEY");
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

  it("emits CostTick without playbook or opponent playId", () => {
    const world = worldWithPlays();
    const msgs = tickMessages(world, "none", world.lastEvents);
    const cost = msgs.find((m) => m.type === "cost");
    expect(cost).toEqual({
      type: "cost",
      homeCalls: 0,
      awayCalls: 0,
      promptTokens: 0,
      outputTokens: 0,
      usd: 0,
    });
    const json = JSON.stringify(cost);
    expect(json).not.toContain(HOME_PLAY);
    expect(json).not.toContain(AWAY_PLAY);
    expect(json).not.toContain("playbooks");
    expect(denylistHits(cost)).toEqual([]);
  });

  it("start body defaults noLlm true and leaves periodSeconds optional", () => {
    const body = StartMatchBodySchema.parse({ home: "original-six", away: "expansion", seed: 42 });
    expect(body.noLlm).toBe(true);
    expect(body.periodSeconds).toBeUndefined();
    expect(() => StartMatchBodySchema.parse({ noLlm: true, periodSeconds: 5 })).not.toThrow();
    expect(StartMatchBodySchema.parse({ noLlm: false }).noLlm).toBe(false);
    expect(StartMatchBodySchema.parse({}).lab).toBeUndefined();
    expect(StartMatchBodySchema.parse({ lab: "chaos", chaosPucks: 25 }).lab).toBe("chaos");
    expect(() => StartMatchBodySchema.parse({ lab: "arcade" })).toThrow();
    expect(() => StartMatchBodySchema.parse({ chaosPucks: 101 })).toThrow();
    const lab = StartMatchBodySchema.parse({
      noLlm: false,
      homeProvider: "xai",
      awayProvider: "muse",
      homeCoach: "grok-4.5",
      awayCoach: "muse-spark-1.2",
    });
    expect(lab.homeProvider).toBe("xai");
    expect(lab.awayProvider).toBe("muse");
    expect(() => StartMatchBodySchema.parse({ homeProvider: "anthropic" })).toThrow();
    const series = StartSeriesBodySchema.parse({});
    expect(series.games).toBe(7);
    expect(series.noLlm).toBe(true);
    expect(StartSeriesBodySchema.parse({ games: 2 }).games).toBe(2);
  });

  it("CostTick with live budget is numbers only (denylist empty, no playId)", () => {
    const world = worldWithPlays();
    const budget = createBudget();
    recordLlmUsage(budget, "home", {
      promptTokens: 1200,
      completionTokens: 80,
      reasoningTokens: 10,
      usd: 0.01,
      calls: 3,
    });
    recordLlmUsage(budget, "away", {
      promptTokens: 400,
      completionTokens: 20,
      reasoningTokens: 0,
      usd: 0.02,
      calls: 2,
    });
    const msgs = tickMessages(world, "home", world.lastEvents, { budget });
    const cost = msgs.find((m) => m.type === "cost");
    expect(cost).toEqual(toCostTick(budget));
    expect(cost).toMatchObject({
      type: "cost",
      homeCalls: 3,
      awayCalls: 2,
      promptTokens: 1600,
      outputTokens: 100,
      usd: 0.03,
    });
    const json = JSON.stringify(cost);
    expect(json).not.toContain(HOME_PLAY);
    expect(json).not.toContain(AWAY_PLAY);
    expect(json).not.toContain("playbooks");
    expect(json).not.toContain("XAI_API_KEY");
    expect(denylistHits(cost)).toEqual([]);
    expect(opponentPlayLeak(cost, "none", world.playId)).toEqual([]);
    expect(formatCostHud(cost!, false)).toBe("$0.03 · 1600/100 tok · home 3 · away 2 calls");
    expect(opponentPlayLeak(msgs, "home", world.playId)).toEqual([]);
  });

  it("inspect none HUD and wire omit both playIds; home inspect omits away", () => {
    const world = worldWithPlays();
    expect(maybeInspectState(world, "none")).toBeUndefined();
    expect(formatInspectHud("none", inspectState(world, "home"))).toBe(PLAY_NAME_HIDDEN);
    const noneMsgs = tickMessages(world, "none", world.lastEvents);
    expect(noneMsgs.some((m) => m.type === "inspect")).toBe(false);
    expect(JSON.stringify(noneMsgs)).not.toContain(HOME_PLAY);
    expect(JSON.stringify(noneMsgs)).not.toContain(AWAY_PLAY);
    expect(opponentPlayLeak(noneMsgs, "none", world.playId)).toEqual([]);

    const homeMsgs = tickMessages(world, "home", []);
    const inspect = homeMsgs.find((m) => m.type === "inspect");
    expect(inspect?.type).toBe("inspect");
    if (inspect?.type !== "inspect") throw new Error("expected inspect");
    expect(formatInspectHud("home", inspect)).not.toContain(AWAY_PLAY);
    expect(formatInspectHud("home", inspect)).not.toContain(HOME_PLAY);
    expect(JSON.stringify(inspect)).not.toContain(AWAY_PLAY);
    expect(opponentPlayLeak(homeMsgs, "home", world.playId)).toEqual([]);
    expect(denylistHits(homeMsgs)).toEqual([]);
  });

  it("match_start may set noLlm false without leaking playbooks or keys", () => {
    const msg = MatchStartSchema.parse({
      type: "match_start",
      matchId: "live-1",
      home: { id: "original-six", name: "Harbor Originals" },
      away: { id: "expansion", name: "Frontier Expansion" },
      seed: 42,
      periodSeconds: 5,
      noLlm: false,
    });
    expect(msg.noLlm).toBe(false);
    const seriesStart = MatchStartSchema.parse({
      ...msg,
      seriesId: "ser-100",
      gameIndex: 0,
      games: 7,
    });
    expect(seriesStart.games).toBe(7);
    expect(seriesStart.gameIndex).toBe(0);
    const json = JSON.stringify(msg);
    expect(json).not.toContain("playbooks");
    expect(json).not.toContain("XAI_API_KEY");
    expect(json).not.toContain(HOME_PLAY);
    expect(denylistHits(msg)).toEqual([]);
  });
});
