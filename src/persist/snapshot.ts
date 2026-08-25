import { z } from "zod";
import { DEFAULT_PLAY_ID } from "../types/play.ts";
import { PlayerIdSchema, type PlayerId } from "../types/ids.ts";
import { RosterSchema, Vec2Schema, type Roster, type Vec2 } from "../types/hockey.ts";
import type { TeamDirective } from "../types/directive.ts";
import { loadTeam } from "../playbook/store.ts";
import { CENTER_ICE, OT_SECONDS, PERIOD_SECONDS } from "../engine/rink.ts";
import { createWorld, defaultDirective } from "../engine/world.ts";

/** DESIGN §4. Stored as `matches.config_json`. Replay starts from this + event stream. */
export const OpeningSnapshotSchema = z.object({
  matchId: z.string().min(1),
  seed: z.number().int(),
  homeTeamId: z.string().min(1),
  awayTeamId: z.string().min(1),
  rosters: z.object({
    home: RosterSchema,
    away: RosterSchema,
  }),
  openingFaceoff: z.object({
    spot: Vec2Schema,
    homeOnIce: z.array(PlayerIdSchema),
    awayOnIce: z.array(PlayerIdSchema),
  }),
  homePlaybookVersion: z.number().int(),
  awayPlaybookVersion: z.number().int(),
  models: z.object({
    home: z.string(),
    away: z.string(),
  }),
  /** Absent in older snapshots → full NHL 20:00 / OT 5:00. */
  periodSeconds: z.number().positive().optional(),
  otSeconds: z.number().positive().optional(),
});
export type OpeningSnapshot = z.infer<typeof OpeningSnapshotSchema>;

export type MakeOpeningSnapshotInput = {
  matchId: string;
  seed: number;
  homeTeamId?: string;
  awayTeamId?: string;
  homePlaybookVersion?: number;
  awayPlaybookVersion?: number;
  models?: { home: string; away: string };
  periodSeconds?: number;
  otSeconds?: number;
  openingFaceoff?: {
    spot?: Vec2;
    homeOnIce?: PlayerId[];
    awayOnIce?: PlayerId[];
  };
  rosters?: { home: Roster; away: Roster };
};

/** Opening 5v5 six; engine default ids (`h-C`, …) so resimulation matches `createWorld`. */
export function defaultOpeningOnIce(): { home: PlayerId[]; away: PlayerId[] } {
  return createWorld().onIce;
}

export function makeOpeningSnapshot(input: MakeOpeningSnapshotInput): OpeningSnapshot {
  const homeTeamId = input.homeTeamId ?? "original-six";
  const awayTeamId = input.awayTeamId ?? "expansion";
  const ice = defaultOpeningOnIce();
  return OpeningSnapshotSchema.parse({
    matchId: input.matchId,
    seed: input.seed,
    homeTeamId,
    awayTeamId,
    rosters: input.rosters ?? { home: loadTeam(homeTeamId), away: loadTeam(awayTeamId) },
    openingFaceoff: {
      spot: input.openingFaceoff?.spot ?? { x: CENTER_ICE.x, y: CENTER_ICE.y },
      homeOnIce: input.openingFaceoff?.homeOnIce ?? ice.home,
      awayOnIce: input.openingFaceoff?.awayOnIce ?? ice.away,
    },
    homePlaybookVersion: input.homePlaybookVersion ?? 1,
    awayPlaybookVersion: input.awayPlaybookVersion ?? 1,
    models: input.models ?? { home: "none", away: "none" },
    periodSeconds: input.periodSeconds,
    otSeconds: input.otSeconds,
  });
}

export function defaultDirectiveFromSnapshot(_side: "home" | "away", _snap: OpeningSnapshot): TeamDirective {
  return defaultDirective(DEFAULT_PLAY_ID);
}

export function parseOpeningSnapshot(raw: unknown): OpeningSnapshot {
  if (typeof raw === "string") return OpeningSnapshotSchema.parse(JSON.parse(raw));
  return OpeningSnapshotSchema.parse(raw);
}
