import { DT } from "../../engine/rink.ts";
import { MINOR_SECONDS } from "../../engine/rules.ts";
import { DEFAULT_PLAY_ID, type Playbook } from "../../types/play.ts";
import type { MatchEvent } from "../../types/events.ts";
import type { Period, Side, Zone } from "../../types/hockey.ts";
import {
  DIGEST_EVENT_CAP,
  HIGH_VALUE_XG,
  MINT_MIN_SEQUENCES,
  MINT_MIN_XG,
  SIGNATURE_JACCARD,
  SIGNATURE_TYPES,
  TIE_BOOST_XG_SHARE,
  type MatchAggregates,
} from "../../types/aar.ts";
import type { EventDigest } from "../../types/events.ts";

export const SEQUENCE_ACTION_TYPES = new Set<string>([
  "Shot",
  "Save",
  "Goal",
  "Turnover",
  "ZoneEntry",
  "FaceoffWin",
  "Block",
  "Rebound",
]);

const SIGNATURE_SET = new Set<string>(SIGNATURE_TYPES);

const WHISTLE_BREAK = new Set<string>([
  "Icing",
  "Offside",
  "Penalty",
  "Freeze",
  "PuckOut",
  "NetOff",
  "PeriodEnd",
  "Whistle",
  "HighStickGoalWavedOff",
]);

const SKIP_SEQUENCE = new Set<string>(["Contact", "DirectiveApplied", "LineChange", "PossessionChange"]);

export type AnnotatedEvent = {
  id: string;
  type: string;
  liveTick: number;
  playId?: string;
  zone?: Zone;
  xG?: number;
  side?: Side;
  period?: Period;
  seq?: number;
};

export type PlaySequence = {
  playId: string;
  zone: Zone;
  eventIds: string[];
  types: string[];
  xG: number;
};

export type PlayUsage = {
  playId: string;
  xgFor: number;
  xgAgainst: number;
  seconds: number;
  xgShare: number;
};

export type MintCluster = {
  playId: string;
  zone: Zone;
  sequences: PlaySequence[];
  xG: number;
};

export type ActualBundle = {
  digest: EventDigest;
  annotated: AnnotatedEvent[];
  knownEventIds: string[];
  aggregates: MatchAggregates;
  sequences: PlaySequence[];
  usage: PlayUsage[];
  mintClusters: MintCluster[];
  mintEligible: boolean;
  actualSummary: string;
};

export function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
}

export function eventSide(event: MatchEvent): Side | undefined {
  const rec = payloadRecord(event.payload);
  if (rec) {
    if (rec.side === "home" || rec.side === "away") return rec.side;
    if (rec.against === "home" || rec.against === "away") return rec.against;
    if (rec.sideDumping === "home" || rec.sideDumping === "away") return rec.sideDumping;
    if (rec.attacking === "home" || rec.attacking === "away") return rec.attacking;
  }
  const actor = event.actor ?? (typeof event.possessor === "string" ? event.possessor : undefined);
  if (typeof actor === "string") {
    if (actor.startsWith("h-")) return "home";
    if (actor.startsWith("a-")) return "away";
  }
  return undefined;
}

export function penaltyAgainst(event: MatchEvent): Side | undefined {
  const rec = payloadRecord(event.payload);
  if (rec?.against === "home" || rec?.against === "away") return rec.against;
  return undefined;
}

export function zoneForReviewingSide(zone: Zone | undefined, side: Side): Zone | undefined {
  if (!zone) return zone;
  if (side === "home") return zone;
  if (zone === "OZ") return "DZ";
  if (zone === "DZ") return "OZ";
  return "NZ";
}

export function annotateEvents(
  events: readonly MatchEvent[],
  side: Side,
  initialPlayId: string = DEFAULT_PLAY_ID,
): AnnotatedEvent[] {
  let playId = initialPlayId;
  const out: AnnotatedEvent[] = [];
  for (const event of events) {
    const rec = payloadRecord(event.payload);
    if (event.type === "DirectiveApplied" && rec?.side === side) {
      const dir = rec.directive;
      if (dir && typeof dir === "object" && "playId" in dir && typeof (dir as { playId: unknown }).playId === "string") {
        playId = (dir as { playId: string }).playId;
      }
    }
    out.push({
      id: event.id,
      type: event.type,
      liveTick: event.liveTick,
      playId,
      zone: zoneForReviewingSide(event.zone, side),
      xG: event.xG,
      side: eventSide(event),
      period: event.period,
      seq: event.seq,
    });
  }
  return out;
}

export function isHighValueEvent(event: AnnotatedEvent): boolean {
  if (event.type === "Goal" || event.type === "Penalty" || event.type === "ZoneEntry") return true;
  if (event.type === "Shot" && (event.xG ?? 0) > HIGH_VALUE_XG) return true;
  if (event.type === "Save" && (event.xG ?? 0) >= 0.15) return true;
  if (event.type === "Turnover" && event.zone === "OZ") return true;
  return false;
}

export function buildEventDigest(matchId: string, annotated: readonly AnnotatedEvent[]): EventDigest {
  const high = annotated.filter(isHighValueEvent);
  const sliced = high.length > DIGEST_EVENT_CAP ? high.slice(high.length - DIGEST_EVENT_CAP) : high;
  return {
    matchId,
    events: sliced.map((e) => ({
      id: e.id,
      type: e.type,
      liveTick: e.liveTick,
      playId: e.playId,
      zone: e.zone,
      xG: e.xG,
    })),
  };
}

export function bagJaccard(a: readonly string[], b: readonly string[]): number {
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (const t of a) ca.set(t, (ca.get(t) ?? 0) + 1);
  for (const t of b) cb.set(t, (cb.get(t) ?? 0) + 1);
  const keys = new Set([...ca.keys(), ...cb.keys()]);
  if (keys.size === 0) return 1;
  let inter = 0;
  let union = 0;
  for (const k of keys) {
    const x = ca.get(k) ?? 0;
    const y = cb.get(k) ?? 0;
    inter += Math.min(x, y);
    union += Math.max(x, y);
  }
  return union === 0 ? 0 : inter / union;
}

function signatureBag(types: readonly string[]): string[] {
  const bag: string[] = [];
  for (const t of types) {
    if (SIGNATURE_SET.has(t)) bag.push(t);
  }
  return bag.slice(-8);
}

export function extractSequences(annotated: readonly AnnotatedEvent[]): PlaySequence[] {
  const sequences: PlaySequence[] = [];
  let cur: AnnotatedEvent[] = [];
  let curPlay: string | undefined;
  let curZone: Zone | undefined;

  const close = () => {
    if (cur.length === 0) return;
    const playId = curPlay ?? DEFAULT_PLAY_ID;
    const zone = curZone ?? "NZ";
    const types = signatureBag(cur.map((e) => e.type));
    const xG = cur.reduce((s, e) => s + (e.xG ?? 0), 0);
    sequences.push({
      playId,
      zone,
      eventIds: cur.map((e) => e.id),
      types,
      xG,
    });
    cur = [];
  };

  for (const event of annotated) {
    if (SKIP_SEQUENCE.has(event.type)) continue;
    if (WHISTLE_BREAK.has(event.type)) {
      close();
      continue;
    }
    if (!SEQUENCE_ACTION_TYPES.has(event.type)) continue;
    const playId = event.playId ?? DEFAULT_PLAY_ID;
    const zone = event.zone ?? "NZ";
    if (cur.length > 0 && (playId !== curPlay || zone !== curZone)) close();
    if (cur.length === 0) {
      curPlay = playId;
      curZone = zone;
    }
    cur.push(event);
    if (event.type === "Goal") close();
  }
  close();
  return sequences.filter((s) => s.types.length > 0 || s.eventIds.length > 0);
}

export function findMintClusters(sequences: readonly PlaySequence[]): MintCluster[] {
  const byKey = new Map<string, PlaySequence[]>();
  for (const seq of sequences) {
    const key = `${seq.playId}|${seq.zone}`;
    const list = byKey.get(key) ?? [];
    list.push(seq);
    byKey.set(key, list);
  }
  const clusters: MintCluster[] = [];
  for (const group of byKey.values()) {
    const used = new Set<number>();
    for (let i = 0; i < group.length; i++) {
      if (used.has(i)) continue;
      const seed = group[i];
      if (!seed) continue;
      const members: PlaySequence[] = [seed];
      used.add(i);
      for (let j = i + 1; j < group.length; j++) {
        if (used.has(j)) continue;
        const other = group[j];
        if (!other) continue;
        if (bagJaccard(seed.types, other.types) >= SIGNATURE_JACCARD) {
          members.push(other);
          used.add(j);
        }
      }
      const xG = members.reduce((s, m) => s + m.xG, 0);
      if (members.length >= MINT_MIN_SEQUENCES && xG > MINT_MIN_XG) {
        clusters.push({ playId: seed.playId, zone: seed.zone, sequences: members, xG });
      }
    }
  }
  return clusters;
}

function periodKey(period: Period | undefined): string {
  return period === undefined ? "?" : String(period);
}

export function computeAggregates(annotated: readonly AnnotatedEvent[], side: Side): MatchAggregates {
  let xgFor = 0;
  let xgAgainst = 0;
  let cfFor = 0;
  let cfAgainst = 0;
  let turnovers = 0;
  let foFor = 0;
  let foAgainst = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let zoneTimeOZ = 0;
  let zoneTimeDZ = 0;
  let zoneEntries = 0;
  let icingUs = 0;
  let ppFor = 0;
  let ppOpp = 0;
  let pkAgainst = 0;
  let pkOpp = 0;
  let ppUs = 0;
  let pkUs = 0;

  let prevTick: number | undefined;
  let prevPeriod: string | undefined;
  let prevZone: Zone = "NZ";

  const them: Side = side === "home" ? "away" : "home";

  for (const event of annotated) {
    const pk = periodKey(event.period);
    if (prevTick !== undefined && prevPeriod === pk) {
      const dt = Math.max(0, event.liveTick - prevTick) * DT;
      if (prevZone === "OZ") zoneTimeOZ += dt;
      else if (prevZone === "DZ") zoneTimeDZ += dt;
      ppUs = Math.max(0, ppUs - dt);
      pkUs = Math.max(0, pkUs - dt);
    }
    prevTick = event.liveTick;
    prevPeriod = pk;
    if (event.zone) prevZone = event.zone;

    const evSide = event.side;
    if (event.type === "Shot" || event.type === "Block") {
      if (evSide === side) cfFor += 1;
      else if (evSide === them) cfAgainst += 1;
    } else if (event.type === "Goal") {
      // Unassisted log rows may omit Shot; still a corsi event.
      if (evSide === side) cfFor += 1;
      else if (evSide === them) cfAgainst += 1;
    }
    if (event.type === "Shot") {
      const xg = event.xG ?? 0;
      if (evSide === side) xgFor += xg;
      else if (evSide === them) xgAgainst += xg;
    }
    if (event.type === "Goal") {
      if (evSide === side) {
        goalsFor += 1;
        if (ppUs > 0) ppFor += 1;
      } else if (evSide === them) {
        goalsAgainst += 1;
        if (pkUs > 0) pkAgainst += 1;
      }
    }
    if (event.type === "Turnover" && (evSide === side || event.zone === "OZ")) {
      if (evSide === side || evSide === undefined) turnovers += 1;
    }
    if (event.type === "FaceoffWin") {
      if (evSide === side) foFor += 1;
      else if (evSide === them) foAgainst += 1;
    }
    if (event.type === "ZoneEntry" && evSide === side) zoneEntries += 1;
    if (event.type === "Icing") {
      const recSide = evSide;
      if (recSide === side) icingUs += 1;
    }
    if (event.type === "Penalty") {
      const offender = evSide;
      if (offender === them) {
        ppUs = MINOR_SECONDS;
        ppOpp += 1;
      } else if (offender === side) {
        pkUs = MINOR_SECONDS;
        pkOpp += 1;
      }
    }
  }

  const cfDen = cfFor + cfAgainst;
  const foDen = foFor + foAgainst;
  const dumpDen = zoneEntries + icingUs;
  return {
    xgFor,
    xgAgainst,
    cfPct: cfDen === 0 ? 50 : (100 * cfFor) / cfDen,
    zoneTimeOZ,
    zoneTimeDZ,
    turnovers,
    foPct: foDen === 0 ? 50 : (100 * foFor) / foDen,
    ppPct: ppOpp === 0 ? null : (100 * ppFor) / ppOpp,
    pkPct: pkOpp === 0 ? null : (100 * (pkOpp - pkAgainst)) / pkOpp,
    goalsFor,
    goalsAgainst,
    dumpInRecoveryPct: dumpDen === 0 ? null : (100 * zoneEntries) / dumpDen,
  };
}

/**
 * Opponent family that generated the most shot xG against `side`.
 * Uses their DirectiveApplied playId + themPlaybook.family — never live observe.
 */
export function themFamilyFromEvents(
  events: readonly MatchEvent[],
  side: Side,
  themPlaybook: Playbook | undefined,
): string | undefined {
  if (!themPlaybook || events.length === 0) return undefined;
  const them: Side = side === "home" ? "away" : "home";
  let themPlayId: string | undefined;
  const xgByPlay = new Map<string, number>();
  for (const event of events) {
    const rec = payloadRecord(event.payload);
    if (event.type === "DirectiveApplied" && rec?.side === them) {
      const dir = rec.directive;
      if (dir && typeof dir === "object" && "playId" in dir && typeof (dir as { playId: unknown }).playId === "string") {
        themPlayId = (dir as { playId: string }).playId;
      }
    }
    if (event.type === "Shot" && eventSide(event) === them && themPlayId) {
      xgByPlay.set(themPlayId, (xgByPlay.get(themPlayId) ?? 0) + (event.xG ?? 0));
    }
  }
  const ranked = [...xgByPlay.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const playId = ranked[0]?.[0] ?? themPlayId;
  if (!playId) return undefined;
  return themPlaybook.plays.find((p) => p.id === playId)?.family;
}

export function playUsage(annotated: readonly AnnotatedEvent[], side: Side): PlayUsage[] {
  const map = new Map<string, { xgFor: number; xgAgainst: number; seconds: number }>();
  let prevTick: number | undefined;
  let prevPeriod: string | undefined;
  let prevPlay = DEFAULT_PLAY_ID;
  const them: Side = side === "home" ? "away" : "home";

  const bump = (playId: string) => {
    const cur = map.get(playId) ?? { xgFor: 0, xgAgainst: 0, seconds: 0 };
    map.set(playId, cur);
    return cur;
  };

  for (const event of annotated) {
    const playId = event.playId ?? DEFAULT_PLAY_ID;
    const pk = periodKey(event.period);
    if (prevTick !== undefined && prevPeriod === pk) {
      bump(prevPlay).seconds += Math.max(0, event.liveTick - prevTick) * DT;
    }
    prevTick = event.liveTick;
    prevPeriod = pk;
    prevPlay = playId;
    const row = bump(playId);
    if (event.type === "Shot") {
      const xg = event.xG ?? 0;
      if (event.side === side) row.xgFor += xg;
      else if (event.side === them) row.xgAgainst += xg;
    }
  }

  const totalFor = [...map.values()].reduce((s, r) => s + r.xgFor, 0);
  return [...map.entries()]
    .map(([playId, r]) => ({
      playId,
      xgFor: r.xgFor,
      xgAgainst: r.xgAgainst,
      seconds: r.seconds,
      xgShare: totalFor > 0 ? r.xgFor / totalFor : 0,
    }))
    .sort((a, b) => b.xgFor - a.xgFor);
}

export function formatActualSummary(agg: MatchAggregates, usage: readonly PlayUsage[]): string {
  const pp = agg.ppPct === null ? "n/a" : `${agg.ppPct.toFixed(0)}%`;
  const pk = agg.pkPct === null ? "n/a" : `${agg.pkPct.toFixed(0)}%`;
  const dump = agg.dumpInRecoveryPct === null || agg.dumpInRecoveryPct === undefined ? "n/a" : `${agg.dumpInRecoveryPct.toFixed(0)}%`;
  const top = usage[0];
  const topLine = top ? ` topPlay=${top.playId} xG=${top.xgFor.toFixed(2)} share=${(top.xgShare * 100).toFixed(0)}%` : "";
  return (
    `xG ${agg.xgFor.toFixed(2)}-${agg.xgAgainst.toFixed(2)}  G ${agg.goalsFor}-${agg.goalsAgainst}  ` +
    `CF% ${agg.cfPct.toFixed(1)}  FO% ${agg.foPct.toFixed(1)}  OZ ${agg.zoneTimeOZ.toFixed(0)}s DZ ${agg.zoneTimeDZ.toFixed(0)}s  ` +
    `TO ${agg.turnovers}  PP ${pp} PK ${pk} dumpRec ${dump}${topLine}`
  );
}

export function computeActual(matchId: string, events: readonly MatchEvent[], side: Side): ActualBundle {
  const annotated = annotateEvents(events, side);
  const digest = buildEventDigest(matchId, annotated);
  const aggregates = computeAggregates(annotated, side);
  const sequences = extractSequences(annotated);
  const usage = playUsage(annotated, side);
  const mintClusters = findMintClusters(sequences);
  return {
    digest,
    annotated,
    knownEventIds: events.map((e) => e.id),
    aggregates,
    sequences,
    usage,
    mintClusters,
    mintEligible: mintClusters.length > 0,
    actualSummary: formatActualSummary(aggregates, usage),
  };
}

export function playWithXgShare(usage: readonly PlayUsage[], minShare: number = TIE_BOOST_XG_SHARE): PlayUsage | undefined {
  return usage.find((p) => p.xgShare > minShare);
}

export function topPlay(usage: readonly PlayUsage[]): PlayUsage | undefined {
  return usage[0];
}
