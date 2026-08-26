import type { Clip, PairedClip, Zone } from "../types/film.ts";

function parseSignature(sig: string | undefined): { playId: string; zone: Zone; types: string[] } | null {
  if (!sig) return null;
  const [playId, zone, bag] = sig.split("|");
  if (!playId || !zone) return null;
  const types = bag ? bag.split(",").filter(Boolean) : [];
  return { playId, zone: zone as Zone, types };
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

function metricHint(early: Clip, late: Clip): string {
  const e = early.kind;
  const l = late.kind;
  if (e !== "goal" && l === "goal") return `${early.kind} → Goal`;
  if (e === "goal" && l !== "goal") return `Goal against → ${late.kind}`;
  if (typeof early.xG === "number" && typeof late.xG === "number") {
    const d = late.xG - early.xG;
    const sign = d >= 0 ? "+" : "";
    return `xG ${early.xG.toFixed(2)} → ${late.xG.toFixed(2)} (${sign}${d.toFixed(2)})`;
  }
  return `${e} → ${l}`;
}

const CHANCE_KINDS = new Set(["goal", "shot", "save"]);

function isChanceKind(kind: Clip["kind"]): boolean {
  return CHANCE_KINDS.has(kind);
}

function pairEarlyLate(early: Clip[], late: Clip[], prefer: number, fallback: number): PairedClip[] {
  const pairs: PairedClip[] = [];
  const usedLate = new Set<string>();

  for (const e of early) {
    const es = parseSignature(e.signature);
    if (!es) continue;
    let best: { clip: Clip; score: number } | null = null;
    for (const l of late) {
      if (l.id === e.id || usedLate.has(l.id)) continue;
      const ls = parseSignature(l.signature);
      if (!ls) continue;
      if (ls.playId !== es.playId || ls.zone !== es.zone) continue;
      const score = jaccard(es.types, ls.types);
      if (!best || score > best.score) best = { clip: l, score };
    }
    if (!best) continue;
    const bar = best.score >= prefer ? prefer : fallback;
    const chanceFilm = isChanceKind(e.kind) && isChanceKind(best.clip.kind);
    if (best.score < bar && !chanceFilm) continue;
    usedLate.add(best.clip.id);
    pairs.push({
      signature: e.signature!,
      playId: es.playId,
      zone: es.zone,
      early: e,
      late: best.clip,
      metricHint: metricHint(e, best.clip),
    });
  }
  return pairs;
}

/**
 * Pair an early-game clip with a late-game clip of the same play + zone.
 * Jaccard on the event-type bag picks the best late clip. Prefer ≥ 0.7;
 * fall back to ≥ 0.3 so a Goal-against vs later Save still pairs.
 * Same play+zone chance clips (goal/shot/save) still pair when dump-chase
 * bags sit just under 0.3 (thin period-end vs ZoneEntry/Rebound).
 */
export function pairClips(clips: Clip[], gameCount: number, prefer = 0.7, fallback = 0.3): PairedClip[] {
  const earlyMax = gameCount <= 2 ? 0 : 1;
  const lateMin = gameCount <= 2 ? gameCount - 1 : Math.max(0, gameCount - 2);
  const early = clips.filter((c) => (c.gameIndex ?? 0) <= earlyMax && c.signature);
  const late = clips.filter((c) => (c.gameIndex ?? 0) >= lateMin && c.signature);
  return pairEarlyLate(early, late, prefer, fallback);
}

/** Pair clips from two explicit game indexes (CLI `--compare i,j`, dual-rink G0 vs last). */
export function pairClipsForGames(
  clips: Clip[],
  earlyGame: number,
  lateGame: number,
  prefer = 0.7,
  fallback = 0.3,
): PairedClip[] {
  const early = clips.filter((c) => (c.gameIndex ?? 0) === earlyGame && c.signature);
  const late = clips.filter((c) => (c.gameIndex ?? 0) === lateGame && c.signature);
  return pairEarlyLate(early, late, prefer, fallback);
}
