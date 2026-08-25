import {
  DZ_COVERAGES,
  FORECHECKS,
  NZ_SCHEMES,
  POSITIONS,
  SHOT_POLICIES,
  type Position,
} from "../types/hockey.ts";
import type { Play } from "../types/play.ts";

/** Seed families plus default; unknown families hash into the last bucket. */
export const PLAY_FAMILIES = [
  "default-structure",
  "forecheck-122",
  "forecheck-212",
  "breakout",
  "cycle-low",
  "trap-122",
  "dz-collapse",
  "pp-umbrella",
  "pk-box",
  "en-scramble",
  "protect-113",
  "ot-21-spread",
  "stretch-pass",
  "crash-net",
  "nz-23",
  "dz-over",
  "pp-overload",
  "pk-diamond",
  "pull-early",
  "ot-agg-forecheck",
] as const;

export const SIMILARITY_DEDUP = 0.92;

function oneHot(value: string | undefined, domain: readonly string[]): number[] {
  return domain.map((d) => (d === value ? 1 : 0));
}

function familyIndex(family: string): number {
  const i = (PLAY_FAMILIES as readonly string[]).indexOf(family);
  if (i >= 0) return i;
  let h = 0;
  for (let k = 0; k < family.length; k++) h = (h + family.charCodeAt(k) * (k + 1)) % PLAY_FAMILIES.length;
  return h;
}

/** Flattened slot rel vectors + one-hot scheme + family. Geometric, not an embedding API. */
export function playFeatureVector(play: Play): number[] {
  const rels: number[] = [];
  for (const pos of POSITIONS) {
    const slot = play.formation.slots[pos as Position];
    rels.push(slot?.rel.x ?? 0, slot?.rel.y ?? 0);
  }
  const familyHot = PLAY_FAMILIES.map((_, i) => (i === familyIndex(play.family) ? 1 : 0));
  return [
    ...rels,
    ...oneHot(play.assignments.shotPolicy, SHOT_POLICIES),
    ...oneHot(play.assignments.forecheck, FORECHECKS),
    ...oneHot(play.assignments.nz, NZ_SCHEMES),
    ...oneHot(play.assignments.dz, DZ_COVERAGES),
    ...familyHot,
  ];
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (a.length > n) {
    for (let i = n; i < a.length; i++) na += (a[i] ?? 0) ** 2;
  }
  if (b.length > n) {
    for (let i = n; i < b.length; i++) nb += (b[i] ?? 0) ** 2;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function playSimilarity(a: Play, b: Play): number {
  return cosineSimilarity(playFeatureVector(a), playFeatureVector(b));
}

export function tooSimilar(a: Play, b: Play, threshold = SIMILARITY_DEDUP): boolean {
  return playSimilarity(a, b) > threshold;
}
