import { GOAL_LINE_X } from "../engine/rink.ts";
import { RosterSchema, type Roster } from "../types/hockey.ts";
import {
  DEFAULT_PLAY_ID,
  PlaybookSchema,
  PlaySchema,
  type Play,
  type Playbook,
} from "../types/play.ts";

export const ORIGINAL_SIX_PLAY_IDS = [
  "5v5-122-forecheck",
  "5v5-breakout-d-to-winger",
  "oz-cycle-low",
  "nz-122-trap",
  "dz-collapse",
  "pp1-umbrella",
  "pk1-box",
  "en-6v5-scramble",
  "protect-lead-1-1-3",
  "ot-3v3-2-1-spread",
] as const;

export const EXPANSION_PLAY_IDS = [
  "5v5-212-forecheck",
  "stretch-pass-nz",
  "oz-crash-net",
  "nz-2-3-pressure",
  "dz-over-aggressive",
  "pp1-overload-half-wall",
  "pk1-diamond-press",
  "pull-early-template",
  "ot-3v3-aggressive-forecheck",
] as const;

export const SEED_PLAY_IDS = {
  "original-six": ORIGINAL_SIX_PLAY_IDS,
  expansion: EXPANSION_PLAY_IDS,
} as const;

const EMPTY_STATS = { games: 0, xgFor: 0, xgAgainst: 0 } as const;

/** Attacking-frame DEFAULT_SLOTS expressed as net-us + rel (GOAL_LINE_X = 89). */
export function defaultStructurePlay(): Play {
  return {
    id: DEFAULT_PLAY_ID,
    name: "Default structure",
    version: 1,
    status: "active",
    family: "default-structure",
    strength: ["5v5", "PP", "PK", "EN", "3v3"],
    zoneBias: ["any"],
    formation: {
      slots: {
        C: { rel: { x: 8 + GOAL_LINE_X, y: 0 }, landmark: "net-us", role: "support" },
        LW: { rel: { x: 20 + GOAL_LINE_X, y: 22 }, landmark: "net-us", role: "support" },
        RW: { rel: { x: 20 + GOAL_LINE_X, y: -22 }, landmark: "net-us", role: "support" },
        LD: { rel: { x: -25 + GOAL_LINE_X, y: 18 }, landmark: "net-us", role: "point" },
        RD: { rel: { x: -25 + GOAL_LINE_X, y: -18 }, landmark: "net-us", role: "point" },
        G: { rel: { x: 0, y: 0 }, landmark: "net-us", role: "crease" },
      },
    },
    triggers: [],
    assignments: { shotPolicy: "shoot", forecheck: "1-2-2", nz: "1-2-2", dz: "collapse" },
    counters: [],
    vulnerableTo: [],
    stats: { ...EMPTY_STATS },
    origin: "seed",
  };
}

export function parsePlay(data: unknown): Play {
  return PlaySchema.parse(data);
}

export function parsePlaybook(data: unknown): Playbook {
  return PlaybookSchema.parse(data);
}

export function parseTeam(data: unknown): Roster {
  return RosterSchema.parse(data);
}
