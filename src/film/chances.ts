import { eventSide, payloadRecord } from "../aar/nodes/actual.ts";
import { isLeadProtectPlay, retrievePlays } from "../playbook/retrieve.ts";
import { resolvePlay } from "../playbook/store.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Side } from "../types/hockey.ts";
import type { Playbook } from "../types/play.ts";

/** Gap after which a Shot is a new chance (1.5s at 10 Hz). */
export const CHANCE_GAP_TICKS = 15;

const STOP_CLUSTER = new Set([
  "Icing",
  "Offside",
  "Penalty",
  "Freeze",
  "PuckOut",
  "NetOff",
  "PeriodEnd",
  "Whistle",
  "HighStickGoalWavedOff",
  "Goal",
]);

export type ChanceCounts = {
  shots: number;
  distinctChances: number;
  offsides: number;
};

function appliedPlayId(event: MatchEvent): string | undefined {
  const rec = payloadRecord(event.payload);
  const dir = rec?.directive;
  if (dir && typeof dir === "object" && "playId" in dir && typeof (dir as { playId: unknown }).playId === "string") {
    return (dir as { playId: string }).playId;
  }
  return undefined;
}

export function openingPlayId(events: readonly MatchEvent[], side: Side): string | undefined {
  for (const event of events) {
    if (event.type !== "DirectiveApplied") continue;
    const rec = payloadRecord(event.payload);
    if (rec?.side !== side) continue;
    const playId = appliedPlayId(event);
    if (playId !== undefined) return playId;
  }
  return undefined;
}

function isAppliedLeadProtect(playId: string, book: Playbook | undefined): boolean {
  if (!book) return isLeadProtectPlay({ id: playId, family: "" });
  const play = resolvePlay(playId, book);
  return isLeadProtectPlay({ id: playId, family: play.family });
}

/**
 * True if this side applied a lead-protect play while tied or trailing.
 * Running score is Goal payload.side only. With a book, playId resolves via resolvePlay.
 */
export function leadProtectWhileTrailing(
  events: readonly MatchEvent[],
  side: Side,
  book?: Playbook,
): boolean {
  const them: Side = side === "home" ? "away" : "home";
  let us = 0;
  let opp = 0;
  for (const event of events) {
    if (event.type === "Goal") {
      const rec = payloadRecord(event.payload);
      if (rec?.side === side) us += 1;
      else if (rec?.side === them) opp += 1;
      continue;
    }
    if (event.type !== "DirectiveApplied") continue;
    const rec = payloadRecord(event.payload);
    if (rec?.side !== side) continue;
    const playId = appliedPlayId(event);
    if (playId === undefined) continue;
    if (!isAppliedLeadProtect(playId, book)) continue;
    if (us <= opp) return true;
  }
  return false;
}

export function retrieveTopId(book: Playbook | undefined): string | undefined {
  if (!book) return undefined;
  return retrievePlays(book, { strength: "5v5", zone: "OZ" })[0]?.id;
}

function attackingSide(event: MatchEvent): Side | undefined {
  const rec = payloadRecord(event.payload);
  if (rec?.attacking === "home" || rec?.attacking === "away") return rec.attacking;
  return eventSide(event);
}

function possessorSide(event: MatchEvent): Side | undefined {
  const id = event.possessor;
  if (typeof id !== "string") return undefined;
  if (id.startsWith("h-")) return "home";
  if (id.startsWith("a-")) return "away";
  return undefined;
}

/** Shot clusters, not raw Shot rows. Offsides charged to the attacking side. */
export function chanceCounts(events: readonly MatchEvent[], side: Side): ChanceCounts {
  let shots = 0;
  let distinctChances = 0;
  let offsides = 0;
  let lastShotTick: number | undefined;
  let broken = true;

  for (const event of events) {
    if (STOP_CLUSTER.has(event.type)) broken = true;
    if (event.type === "PossessionChange") {
      const holder = possessorSide(event);
      if (holder && holder !== side) broken = true;
    }
    if (event.type === "Offside" && attackingSide(event) === side) {
      offsides += 1;
    }
    if (event.type !== "Shot" || eventSide(event) !== side) continue;
    shots += 1;
    const gap = lastShotTick !== undefined && event.liveTick - lastShotTick > CHANCE_GAP_TICKS;
    if (broken || gap || lastShotTick === undefined) {
      distinctChances += 1;
      broken = false;
    }
    lastShotTick = event.liveTick;
  }

  return { shots, distinctChances, offsides };
}

export type SideScorecard = ChanceCounts & {
  openingPlayId?: string;
  retrieveTopId?: string;
  playbookVersion: number;
  leadProtectWhileTrailing: boolean;
};

export function sideScorecard(
  events: readonly MatchEvent[],
  side: Side,
  book: Playbook | undefined,
  playbookVersion: number,
): SideScorecard {
  return {
    ...chanceCounts(events, side),
    openingPlayId: openingPlayId(events, side),
    retrieveTopId: retrieveTopId(book),
    playbookVersion,
    leadProtectWhileTrailing: leadProtectWhileTrailing(events, side, book),
  };
}

export function retrieveTopChanged(tops: readonly (string | undefined)[]): number {
  let n = 0;
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] !== tops[i - 1]) n += 1;
  }
  return n;
}
