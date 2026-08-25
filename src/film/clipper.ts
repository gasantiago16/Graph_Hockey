import {
  AUTO_CLIP_CAP,
  AUTO_PLUS_AAR_CAP,
  CLIP_PRIORITY,
  CLIP_WINDOWS,
  type Clip,
  type ClipEvent,
  type ClipKind,
} from "../types/film.ts";

const PRIORITY_INDEX = new Map(CLIP_PRIORITY.map((k, i) => [k, i]));

export function clipSignature(playId: string | undefined, zone: string | undefined, types: string[]): string {
  const bag = [...new Set(types)].sort().join(",");
  return `${playId ?? "unknown"}|${zone ?? "NZ"}|${bag}`;
}

function windowFor(kind: Exclude<ClipKind, "user">, tick: number, duration: number): { start: number; end: number } {
  const w = CLIP_WINDOWS[kind];
  return {
    start: Math.max(0, tick - w.before),
    end: Math.min(duration, tick + w.after),
  };
}

function overlapRatio(a: { startLiveTick: number; endLiveTick: number }, b: { startLiveTick: number; endLiveTick: number }): number {
  const inter = Math.max(0, Math.min(a.endLiveTick, b.endLiveTick) - Math.max(a.startLiveTick, b.startLiveTick) + 1);
  const union = Math.max(a.endLiveTick, b.endLiveTick) - Math.min(a.startLiveTick, b.startLiveTick) + 1;
  return union === 0 ? 0 : inter / union;
}

function titleFor(kind: ClipKind, ev: ClipEvent): string {
  const side = ev.side === "away" ? "AWAY" : ev.side === "home" ? "HOME" : "";
  switch (kind) {
    case "goal":
      return `${side} GOAL`.trim();
    case "shot":
      return `Chance xG ${(ev.xG ?? 0).toFixed(2)}`;
    case "save":
      return `Save xG ${(ev.xG ?? 0).toFixed(2)}`;
    case "turnover":
      return `${side} OZ turnover`.trim();
    case "penalty":
      return `${side} penalty`.trim();
    case "aar_cite":
      return `AAR cite ${ev.id}`;
    default:
      return `${kind} @ ${ev.liveTick}`;
  }
}

function candidateKind(ev: ClipEvent, next: ClipEvent | undefined): Exclude<ClipKind, "user"> | null {
  switch (ev.type) {
    case "Goal":
      return "goal";
    case "Shot":
      return (ev.xG ?? 0) >= 0.12 ? "shot" : null;
    case "Save":
      return (ev.xG ?? 0) >= 0.15 ? "save" : null;
    case "Turnover":
      return ev.zone === "OZ" ? "turnover" : null;
    case "Penalty":
      return "penalty";
    case "Icing":
      return "icing";
    case "PPStart":
      return "pp";
    case "PKStart":
      return "pk";
    case "ZoneEntry":
      if (next && next.liveTick - ev.liveTick <= 40 && /Whistle|Offside|Icing/.test(next.type)) {
        return "zone_entry";
      }
      return null;
    default:
      return null;
  }
}

function mergeClips(clips: Clip[]): Clip[] {
  const sorted = [...clips].sort((a, b) => a.startLiveTick - b.startLiveTick);
  const out: Clip[] = [];
  for (const clip of sorted) {
    const prev = out[out.length - 1];
    if (prev && overlapRatio(prev, clip) >= 0.5 && prev.matchId === clip.matchId) {
      const prevPri = PRIORITY_INDEX.get(prev.kind) ?? 99;
      const clipPri = PRIORITY_INDEX.get(clip.kind) ?? 99;
      const keep = clipPri < prevPri ? clip : prev;
      const drop = keep === prev ? clip : prev;
      keep.relatedEventIds = [...new Set([...prev.relatedEventIds, ...clip.relatedEventIds])];
      keep.startLiveTick = Math.min(prev.startLiveTick, clip.startLiveTick);
      keep.endLiveTick = Math.max(prev.endLiveTick, clip.endLiveTick);
      if ((drop.xG ?? 0) > (keep.xG ?? 0)) keep.xG = drop.xG;
      out[out.length - 1] = keep;
    } else {
      out.push({ ...clip, relatedEventIds: [...clip.relatedEventIds] });
    }
  }
  return out;
}

function applyCap(clips: Clip[], cap: number): Clip[] {
  if (clips.length <= cap) return clips;
  return [...clips]
    .sort((a, b) => {
      const pa = PRIORITY_INDEX.get(a.kind) ?? 99;
      const pb = PRIORITY_INDEX.get(b.kind) ?? 99;
      if (pa !== pb) return pa - pb;
      return (b.xG ?? 0) - (a.xG ?? 0);
    })
    .slice(0, cap)
    .sort((a, b) => a.startLiveTick - b.startLiveTick);
}

export interface AutoClipOpts {
  matchId: string;
  durationLiveTicks: number;
  seriesId?: string;
  gameIndex?: number;
  aarEventIds?: string[];
}

export function autoClips(events: ClipEvent[], opts: AutoClipOpts): Clip[] {
  const duration = opts.durationLiveTicks;
  const raw: Clip[] = [];
  let n = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    const kind = candidateKind(ev, events[i + 1]);
    if (!kind) continue;
    const { start, end } = windowFor(kind, ev.liveTick, duration);
    const types = events
      .filter((e) => e.liveTick >= start && e.liveTick <= end)
      .map((e) => e.type);
    raw.push({
      id: `${opts.matchId}:clip:${n++}`,
      matchId: opts.matchId,
      seriesId: opts.seriesId,
      gameIndex: opts.gameIndex,
      startLiveTick: start,
      endLiveTick: end,
      anchorEventId: ev.id,
      relatedEventIds: [ev.id],
      kind,
      title: titleFor(kind, ev),
      side: ev.side,
      playId: ev.playId,
      xG: ev.xG,
      source: "auto",
      signature: clipSignature(ev.playId, ev.zone, types),
    });
  }

  let merged = mergeClips(raw);
  merged = applyCap(merged, AUTO_CLIP_CAP);

  if (opts.aarEventIds?.length) {
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const eventId of opts.aarEventIds) {
      const ev = byId.get(eventId);
      if (!ev) continue;
      const { start, end } = windowFor("aar_cite", ev.liveTick, duration);
      merged.push({
        id: `${opts.matchId}:clip:${n++}`,
        matchId: opts.matchId,
        seriesId: opts.seriesId,
        gameIndex: opts.gameIndex,
        startLiveTick: start,
        endLiveTick: end,
        anchorEventId: ev.id,
        relatedEventIds: [ev.id],
        kind: "aar_cite",
        title: titleFor("aar_cite", ev),
        side: ev.side,
        playId: ev.playId,
        xG: ev.xG,
        source: "aar",
        signature: clipSignature(ev.playId, ev.zone, [ev.type]),
      });
    }
    merged = mergeClips(merged);
    merged = applyCap(merged, AUTO_PLUS_AAR_CAP);
  }

  return merged.sort((a, b) => a.startLiveTick - b.startLiveTick);
}

export function resolveEventToTick(events: ClipEvent[], eventId: string): { event: ClipEvent; liveTick: number } | null {
  const event = events.find((e) => e.id === eventId);
  if (!event) return null;
  return { event, liveTick: event.liveTick };
}
