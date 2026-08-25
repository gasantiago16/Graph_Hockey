import { describe, expect, it } from "vitest";
import { makeEventId } from "./ids.ts";
import { STRENGTHS, StrengthSchema, PlayerAttributesSchema, POSITIONS } from "./hockey.ts";
import { PlaySchema, PlaybookSchema, PlayPredicateSchema, DEFAULT_PLAY_ID } from "./play.ts";
import { TeamDirectiveSchema } from "./directive.ts";
import { PublicEventSchema } from "./events.ts";
import { PublicPlayerSchema, TeamObservationSchema } from "./observation.ts";
import type { Clip, Side, Zone } from "./film.ts";

const attributes = {
  speed: 70,
  accel: 65,
  agility: 60,
  shooting: 55,
  passing: 72,
  faceoff: 80,
  defense: 58,
  physical: 50,
  vision: 74,
  discipline: 62,
  stamina: 68,
};

const play = {
  id: "5v5-122-forecheck",
  name: "F1 1-2-2 dump-and-chase",
  version: 1,
  status: "active" as const,
  family: "forecheck-122",
  strength: ["5v5"] as const,
  zoneBias: ["NZ", "OZ"] as const,
  formation: {
    slots: {
      C: { rel: { x: 0, y: 0 }, landmark: "puck" as const, role: "puck" as const },
    },
  },
  triggers: [{ all: [{ kind: "zone" as const, eq: "OZ" as const }] }],
  assignments: { shotPolicy: "dump" as const, forecheck: "1-2-2" as const },
  counters: [],
  vulnerableTo: [],
  stats: { games: 0, xgFor: 0, xgAgainst: 0 },
  origin: "seed" as const,
};

describe("core hockey schemas", () => {
  it("includes listed Strength values including EN", () => {
    for (const s of ["5v5", "5v4", "5v3", "4v4", "4v3", "3v3", "EN"] as const) {
      expect(STRENGTHS).toContain(s);
      expect(StrengthSchema.parse(s)).toBe(s);
    }
  });

  it("parses positions and player attributes", () => {
    expect(POSITIONS).toEqual(["C", "LW", "RW", "LD", "RD", "G"]);
    expect(PlayerAttributesSchema.parse({ ...attributes, reboundControl: 80, tracking: 77 }).tracking).toBe(77);
  });

  it("parses Play, PlayPredicate, and Playbook", () => {
    expect(PlayPredicateSchema.parse({ kind: "strength", eq: "5v5" })).toEqual({ kind: "strength", eq: "5v5" });
    expect(PlaySchema.parse(play).id).toBe("5v5-122-forecheck");
    expect(PlaybookSchema.parse({ teamId: "original-six", version: 1, plays: [play] }).plays).toHaveLength(1);
    expect(DEFAULT_PLAY_ID).toBe("default-structure");
  });

  it("parses TeamDirective and strips unknown keys", () => {
    const dir = TeamDirectiveSchema.parse({
      playId: DEFAULT_PLAY_ID,
      pressure: "neutral",
      pullGoalie: false,
      timeout: false,
      lockLines: true,
      notesForCaptain: "hold the blue",
      extra: "nope",
    });
    expect(dir.playId).toBe(DEFAULT_PLAY_ID);
    expect(dir.pressure).toBe("neutral");
    expect(dir.lockLines).toBe(true);
    expect("extra" in dir).toBe(false);
  });

  it("requires PublicEvent id `${matchId}:${seq}`", () => {
    const id = makeEventId("match-1", 0);
    expect(id).toBe("match-1:0");
    const ev = PublicEventSchema.parse({
      id,
      liveTick: 10,
      stoppageSeq: 0,
      period: 1,
      type: "Shot",
      zone: "OZ",
      xG: 0.2,
    });
    expect(ev.id).toBe("match-1:0");
    expect(() => PublicEventSchema.parse({ ...ev, id: "nocolon" })).toThrow();
  });

  it("parses PublicPlayer and TeamObservation", () => {
    const player = PublicPlayerSchema.parse({
      id: "h-c",
      side: "us",
      number: 9,
      position: "C",
      pos: { x: 10, y: 0 },
      vel: { x: 1, y: 0 },
      heading: 0,
    });
    expect(player.side).toBe("us");

    const obs = TeamObservationSchema.parse({
      matchId: "match-1",
      epochReason: "faceoff",
      epochKind: "micro",
      period: 1,
      clock: 1200,
      score: { us: 0, them: 0 },
      strength: "5v5",
      zone: "NZ",
      phase: "faceoff_drop",
      whistle: null,
      puck: { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, possessor: null },
      players: [player],
      lastEvents: [],
      zoneTime: { usOZ: 0, themOZ: 0, nz: 0 },
      onIce: { us: ["h-c"], them: ["a-c"] },
      penalties: { us: [], them: [] },
      timeoutLeft: { us: true, them: true },
      goalieInNet: { us: true, them: true },
      activePlay: { id: DEFAULT_PLAY_ID, name: "Default", version: 1 },
      lastDirective: { playId: DEFAULT_PLAY_ID, pressure: "neutral" },
      bench: { fatigue: { "h-lw": 0.1 } },
      playbookDigest: [],
      scoutNotes: [],
      ourAssignments: [{ playerId: "h-c", slot: "C", role: "puck" }],
    });
    expect(obs.strength).toBe("5v5");
    expect(obs.lastDirective.playId).toBe(DEFAULT_PLAY_ID);
  });

  it("does not replace Film Room clip types", () => {
    const side: Side = "home";
    const zone: Zone = "OZ";
    const clip: Clip = {
      id: "m:clip:0",
      matchId: "m",
      startLiveTick: 0,
      endLiveTick: 10,
      anchorEventId: "m:0",
      relatedEventIds: ["m:0"],
      kind: "goal",
      title: "HOME GOAL",
      side,
      source: "auto",
    };
    expect(clip.kind).toBe("goal");
    expect(zone).toBe("OZ");
  });
});
