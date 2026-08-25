import { describe, expect, it } from "vitest";
import { createWorld } from "../engine/world.ts";
import { loadPlaybook } from "../playbook/store.ts";
import { denylistHits, opponentPlayLeak } from "../server/protocol.ts";
import { inspectState, maybeInspectState } from "../server/spectator.ts";
import { formatInspectHud, PLAY_NAME_HIDDEN } from "./inspect.ts";

const HOME_PLAY = "5v5-122-forecheck";
const AWAY_PLAY = "5v5-212-forecheck";

function worldWithPlays() {
  return createWorld({
    matchId: "inspect-hud",
    playId: { home: HOME_PLAY, away: AWAY_PLAY },
    playbooks: {
      home: loadPlaybook("original-six"),
      away: loadPlaybook("expansion"),
    },
  });
}

describe("inspect HUD", () => {
  it("none hides play names and never includes either playId", () => {
    const world = worldWithPlays();
    const home = inspectState(world, "home");
    const text = formatInspectHud("none", home);
    expect(text).toBe(PLAY_NAME_HIDDEN);
    expect(text).not.toContain(HOME_PLAY);
    expect(text).not.toContain(AWAY_PLAY);
    expect(maybeInspectState(world, "none")).toBeUndefined();
  });

  it("home shows only the home play name (not playId, not away)", () => {
    const world = worldWithPlays();
    const inspect = inspectState(world, "home");
    const text = formatInspectHud("home", inspect);
    expect(text).toBe(`home · ${inspect.playName} (${inspect.pressure})`);
    expect(text).not.toContain(HOME_PLAY);
    expect(text).not.toContain(AWAY_PLAY);
    expect(JSON.stringify(inspect)).not.toContain(AWAY_PLAY);
    expect(denylistHits(inspect)).toEqual([]);
    expect(opponentPlayLeak(inspect, "home", world.playId)).toEqual([]);
    expect(opponentPlayLeak(text, "home", world.playId)).toEqual([]);
  });

  it("away shows only the away play name", () => {
    const world = worldWithPlays();
    const inspect = inspectState(world, "away");
    const text = formatInspectHud("away", inspect);
    expect(text).toBe(`away · ${inspect.playName} (${inspect.pressure})`);
    expect(text).not.toContain(HOME_PLAY);
    expect(text).not.toContain(AWAY_PLAY);
    expect(JSON.stringify(inspect)).not.toContain(HOME_PLAY);
    expect(opponentPlayLeak(inspect, "away", world.playId)).toEqual([]);
  });

  it("does not render a stale opponent inspect payload", () => {
    const world = worldWithPlays();
    const away = inspectState(world, "away");
    const text = formatInspectHud("home", away);
    expect(text).toBe(PLAY_NAME_HIDDEN);
    expect(text).not.toContain(away.playName);
    expect(text).not.toContain(AWAY_PLAY);
  });
});
