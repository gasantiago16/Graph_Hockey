import type { MatchEvent } from "../types/events.ts";
import type { Side, Strength, Zone } from "../types/hockey.ts";
import {
  PLAY_STRENGTHS,
  type Play,
  type Playbook,
  type PlayDigest,
  type PlayPredicate,
  type PlayStrength,
} from "../types/play.ts";
import type { WorldState } from "../engine/world.ts";
import { BLUE_LINE_X } from "../engine/rink.ts";

const PLAY_STRENGTH_SET = new Set<string>(PLAY_STRENGTHS);

export type ScoreState = "leading" | "tied" | "trailing";

export type RetrieveQuery = {
  strength: PlayStrength | Strength | string;
  zone: Zone;
  scoreState?: ScoreState;
  limit?: number;
  /** Public-geometry guess. Never opponent playId. */
  themFamily?: string;
};

export const COUNTER_BONUS = 0.25;

export function zoneForSide(world: WorldState, side: Side): Zone {
  const x = world.puck.pos.x * world.attackingDir[side];
  if (x > BLUE_LINE_X) return "OZ";
  if (x < -BLUE_LINE_X) return "DZ";
  return "NZ";
}

export function scoreStateFor(world: WorldState, side: Side): ScoreState {
  const them: Side = side === "home" ? "away" : "home";
  const us = world.score[side];
  const opp = world.score[them];
  if (us > opp) return "leading";
  if (us < opp) return "trailing";
  return "tied";
}

/** Observer-relative world strength: `5v4` means this side has the extra skater. */
export function observerStrength(world: WorldState, side: Side): Strength {
  if (side === "home") return world.strength;
  const parts = world.strength.split("v");
  const them = parts[0] ?? "5";
  const us = parts[1] ?? "5";
  return `${us}v${them}` as Strength;
}

export function asPlayStrength(strength: string): PlayStrength {
  if (PLAY_STRENGTH_SET.has(strength)) return strength as PlayStrength;
  const parts = strength.split("v");
  const us = Number(parts[0]);
  const them = Number(parts[1]);
  if (!Number.isFinite(us) || !Number.isFinite(them)) return "5v5";
  if (us === 6) return "EN";
  if (us === 3 && them === 3) return "3v3";
  if (us > them) return "PP";
  if (us < them) return "PK";
  return "5v5";
}

export function playStrengthFor(world: WorldState, side: Side): PlayStrength {
  return asPlayStrength(observerStrength(world, side));
}

function pred(
  p: PlayPredicate,
  world: WorldState,
  side: Side,
  events: MatchEvent[],
): boolean {
  switch (p.kind) {
    case "zone":
      return zoneForSide(world, side) === p.eq;
    case "strength":
      return playStrengthFor(world, side) === p.eq || observerStrength(world, side) === p.eq;
    case "score":
      return scoreStateFor(world, side) === p.eq;
    case "timeRemainingLt":
      return world.clockRemaining < p.seconds;
    case "afterEvent":
      return events.some((e) => e.type === p.type);
    default: {
      const _never: never = p;
      return _never;
    }
  }
}

export function playStillValid(
  play: Play,
  world: WorldState,
  side: Side,
  lastEvents: MatchEvent[] = world.lastEvents,
): boolean {
  if (play.status === "retired") return false;
  if (!play.strength.includes(playStrengthFor(world, side))) return false;
  const zone = zoneForSide(world, side);
  if (play.triggers.length === 0) {
    return play.zoneBias.length === 0 || play.zoneBias.includes("any") || play.zoneBias.includes(zone);
  }
  return play.triggers.some((g) => {
    const allOk = (g.all ?? []).every((p) => pred(p, world, side, lastEvents));
    const anyOk = !g.any || g.any.length === 0 || g.any.some((p) => pred(p, world, side, lastEvents));
    return allOk && anyOk;
  });
}

export function toDigest(play: Play): PlayDigest {
  return {
    id: play.id,
    name: play.name,
    family: play.family,
    strength: play.strength,
    zoneBias: play.zoneBias,
    stats: { ...play.stats },
    counters: [...play.counters],
  };
}

type PublicSkater = { side: "us" | "them"; position: string; pos: { x: number; y: number } };

/** Attacking +X frame. Goalies ignored. Names match seed `play.family` / AAR counters. */
export function inferThemFamily(players: readonly PublicSkater[]): string | undefined {
  const them = players.filter((p) => p.side === "them" && p.position !== "G");
  let inDz = 0;
  let deepDz = 0;
  let inNz = 0;
  for (const p of them) {
    if (p.pos.x < -BLUE_LINE_X) {
      inDz += 1;
      if (p.pos.x < -BLUE_LINE_X - 16) deepDz += 1;
    } else if (p.pos.x <= BLUE_LINE_X) {
      inNz += 1;
    }
  }
  if (deepDz >= 2) return "crash-net";
  if (inDz >= 2) return "forecheck-212";
  if (inDz === 1 && inNz >= 2) return "stretch-pass";
  if (inDz === 1) return "forecheck-122";
  if (inNz >= 4) return "trap-122";
  return undefined;
}

function netXg(play: Play): number {
  return play.stats.xgFor - play.stats.xgAgainst;
}

function scoreTriggerBoost(play: Play, scoreState: ScoreState | undefined): number {
  if (!scoreState) return 0;
  for (const g of play.triggers) {
    const preds = [...(g.all ?? []), ...(g.any ?? [])];
    if (preds.some((p) => p.kind === "score" && p.eq === scoreState)) return 0.1;
  }
  return 0;
}

function counterBoost(play: Play, themFamily: string | undefined): number {
  if (!themFamily) return 0;
  return play.counters.includes(themFamily) ? COUNTER_BONUS : 0;
}

/** Empty-net / pull-goalie templates. Short periods make timeRemainingLt always true, so these stay off 5v5 retrieve. */
export function isEmptyNetPlay(play: Pick<Play, "family">): boolean {
  return play.family === "pull-early" || play.family === "en-scramble";
}

/** Filter active plays by strength/zone, rank by net xG, return top 6 digests. */
export function retrievePlays(book: Playbook, query: RetrieveQuery): PlayDigest[] {
  const strength = asPlayStrength(query.strength);
  const limit = query.limit ?? 6;
  const matched = book.plays.filter((play) => {
    if (play.status === "retired") return false;
    if (isEmptyNetPlay(play) && strength !== "EN") return false;
    if (!play.strength.includes(strength)) return false;
    if (play.zoneBias.length === 0) return true;
    return play.zoneBias.includes("any") || play.zoneBias.includes(query.zone);
  });
  matched.sort((a, b) => {
    const db = netXg(b) + scoreTriggerBoost(b, query.scoreState) + counterBoost(b, query.themFamily);
    const da = netXg(a) + scoreTriggerBoost(a, query.scoreState) + counterBoost(a, query.themFamily);
    if (db !== da) return db - da;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return matched.slice(0, limit).map(toDigest);
}
