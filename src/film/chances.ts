import { eventSide, payloadRecord } from "../aar/nodes/actual.ts";
import { retrievePlays } from "../playbook/retrieve.ts";
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

export function openingPlayId(events: readonly MatchEvent[], side: Side): string | undefined {
  for (const event of events) {
    if (event.type !== "DirectiveApplied") continue;
    const rec = payloadRecord(event.payload);
    if (rec?.side !== side) continue;
    const dir = rec.directive;
    if (dir && typeof dir === "object" && "playId" in dir && typeof (dir as { playId: unknown }).playId === "string") {
      return (dir as { playId: string }).playId;
    }
  }
  return undefined;
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

export type PlayMixRow = { playId: string; directives: number };

/** DirectiveApplied counts for this side, highest first. Transfer evidence is a non-seed play here, not a version integer. */
export function executedPlayMix(events: readonly MatchEvent[], side: Side): PlayMixRow[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "DirectiveApplied") continue;
    const rec = payloadRecord(event.payload);
    if (rec?.side !== side) continue;
    const dir = rec.directive;
    if (!dir || typeof dir !== "object" || !("playId" in dir)) continue;
    const playId = (dir as { playId: unknown }).playId;
    if (typeof playId !== "string" || playId.length === 0) continue;
    counts.set(playId, (counts.get(playId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([playId, directives]) => ({ playId, directives }))
    .sort((a, b) => b.directives - a.directives || a.playId.localeCompare(b.playId));
}

export type SideScorecard = ChanceCounts & {
  openingPlayId?: string;
  retrieveTopId?: string;
  playbookVersion: number;
  playMix: PlayMixRow[];
  openingMatchesRetrieve: boolean;
};

export function sideScorecard(
  events: readonly MatchEvent[],
  side: Side,
  book: Playbook | undefined,
  playbookVersion: number,
): SideScorecard {
  const opening = openingPlayId(events, side);
  const top = retrieveTopId(book);
  return {
    ...chanceCounts(events, side),
    openingPlayId: opening,
    retrieveTopId: top,
    playbookVersion,
    playMix: executedPlayMix(events, side),
    openingMatchesRetrieve: opening !== undefined && top !== undefined && opening === top,
  };
}

export function retrieveTopChanged(tops: readonly (string | undefined)[]): number {
  let n = 0;
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] !== tops[i - 1]) n += 1;
  }
  return n;
}
