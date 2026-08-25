import { AAR_CITATION_REJECTED, TIE_BOOST_XG_SHARE, type AarResult } from "../types/aar.ts";
import { EventIdSchema } from "../types/ids.ts";
import type { Position } from "../types/hockey.ts";
import { POSITIONS } from "../types/hockey.ts";
import {
  DEFAULT_PLAY_ID,
  type Play,
  type PlayMutation,
  type PlayPatch,
  type PlayPredicate,
  type Playbook,
  type PlaybookRevision,
} from "../types/play.ts";
import { playSimilarity, tooSimilar } from "./similarity.ts";
import { defaultPlayIdForBook } from "./store.ts";

/** DESIGN §12 caps — enforced here, not in the prompt. */
export const MAX_MUTATIONS_PER_AAR = 3;
export const MAX_MINTS_PER_AAR = 1;
export const MAX_RETIRES_PER_AAR = 1;
export const MAX_LOSER_TWEAK_ASSIGNMENT = 1;
export const RETIRE_MIN_GAMES = 3;
export const RETIRE_CATASTROPHIC_XG = 1.5;
export const RETIRE_CATASTROPHIC_SECONDS = 90;
export const BOOST_XG = 0.1;
export const NERF_XG = 0.1;
export const PLAY_NAME_RE = /^[A-Za-z0-9 _-]{1,64}$/;
export const AAR_MUTATION_REJECTED = "AarMutationRejected";

export type MutatePlayUsage = {
  playId: string;
  xgFor: number;
  xgAgainst: number;
  seconds: number;
  xgShare: number;
};

export type MutateMintCluster = {
  playId: string;
};

export type MutateContext = {
  result: AarResult;
  knownEventIds: readonly string[];
  playUsage?: readonly MutatePlayUsage[];
  mintEligible?: boolean;
  mintClusters?: readonly MutateMintCluster[];
};

export type MutateResult = {
  book: Playbook;
  applied: PlayMutation[];
  rejected: string[];
  bumped: boolean;
};

function cloneBook(book: Playbook): Playbook {
  return structuredClone(book);
}

function clonePlay(play: Play): Play {
  return structuredClone(play);
}

function predKey(p: PlayPredicate): string {
  return JSON.stringify(p);
}

function playIdOf(op: PlayMutation): string | undefined {
  if ("playId" in op) return op.playId;
  if ("basedOn" in op) return op.basedOn;
  return undefined;
}

function findPlay(book: Playbook, id: string): Play | undefined {
  return book.plays.find((p) => p.id === id);
}

/** `default-structure` is a code fallback, not a seed row — retarget to the book's default play. */
function resolveTargetPlayId(book: Playbook, playId: string): string {
  if (playId !== DEFAULT_PLAY_ID) return playId;
  if (findPlay(book, playId)) return playId;
  return defaultPlayIdForBook(book);
}

function playUsed(usage: MutatePlayUsage | undefined): boolean {
  return !!usage && (usage.seconds > 0 || usage.xgFor > 0 || usage.xgAgainst > 0);
}

function describeRejected(op: PlayMutation, reason: string): string {
  const play = "playId" in op ? op.playId : "basedOn" in op ? op.basedOn : op.op;
  const ids = op.eventIds?.join(",") ?? "";
  return `${op.op}:${play}:${reason}:${ids}`;
}

function eventIdsValid(ids: readonly string[] | undefined, known: Set<string>): boolean {
  if (!ids || ids.length === 0) return false;
  for (const id of ids) {
    if (EventIdSchema.safeParse(id).success !== true) return false;
    if (!known.has(id)) return false;
  }
  return true;
}

function filterCited(ops: readonly PlayMutation[], knownEventIds: readonly string[]): {
  kept: PlayMutation[];
  rejectedOps: string[];
} {
  const known = new Set(knownEventIds);
  const kept: PlayMutation[] = [];
  const rejectedOps: string[] = [];
  for (const op of ops) {
    if (!eventIdsValid(op.eventIds, known)) {
      const reason = !op.eventIds?.length ? "missing" : "unknown";
      const line = describeRejected(op, reason);
      rejectedOps.push(line);
      console.warn(AAR_CITATION_REJECTED, line);
      continue;
    }
    kept.push(op);
  }
  return { kept, rejectedOps };
}

export function retireAllowed(
  play: Play,
  usage: MutatePlayUsage | undefined,
  result: AarResult,
): boolean {
  if (result === "win" && playUsed(usage)) return false;
  if (play.stats.games >= RETIRE_MIN_GAMES) return true;
  if (
    usage &&
    usage.xgAgainst - usage.xgFor > RETIRE_CATASTROPHIC_XG &&
    usage.seconds >= RETIRE_CATASTROPHIC_SECONDS
  ) {
    return true;
  }
  return false;
}

export function mintAllowed(basedOn: string, ctx: Pick<MutateContext, "mintEligible" | "mintClusters" | "result">): boolean {
  if (ctx.result === "win") {
    if (ctx.mintClusters && ctx.mintClusters.length > 0) {
      return ctx.mintClusters.some((c) => c.playId === basedOn);
    }
    return ctx.mintEligible === true;
  }
  return true;
}

export function slugifyPlayId(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s.length > 0 ? s : "minted-play";
}

function uniquePlayId(book: Playbook, base: string): string {
  if (!book.plays.some((p) => p.id === base)) return base;
  for (let i = 2; i < 1000; i++) {
    const id = `${base}-${i}`;
    if (!book.plays.some((p) => p.id === id)) return id;
  }
  return `${base}-x`;
}

function applyPatch(play: Play, patch: PlayPatch): Play {
  const next = clonePlay(play);
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.family !== undefined) next.family = patch.family;
  if (patch.strength !== undefined) next.strength = [...patch.strength];
  if (patch.zoneBias !== undefined) next.zoneBias = [...patch.zoneBias];
  if (patch.triggers !== undefined) next.triggers = structuredClone(patch.triggers);
  if (patch.assignments !== undefined) next.assignments = { ...next.assignments, ...patch.assignments };
  if (patch.counters !== undefined) next.counters = [...patch.counters];
  if (patch.vulnerableTo !== undefined) next.vulnerableTo = [...patch.vulnerableTo];
  return next;
}

function slotWithLargestDelta(from: Play, to: Play): { slot: Position; rel: { x: number; y: number } } {
  let best: Position = "C";
  let bestMag = -1;
  let bestRel = to.formation.slots.C?.rel ?? from.formation.slots.C?.rel ?? { x: 0, y: 0 };
  for (const slot of POSITIONS) {
    const a = from.formation.slots[slot]?.rel ?? { x: 0, y: 0 };
    const b = to.formation.slots[slot]?.rel ?? a;
    const mag = Math.hypot(b.x - a.x, b.y - a.y);
    if (mag > bestMag) {
      bestMag = mag;
      best = slot;
      bestRel = { x: b.x, y: b.y };
    }
  }
  return { slot: best, rel: bestRel };
}

/** Near-duplicate mint → tweak_slot on the closest existing play (cosine > 0.92). */
export function dedupMint(book: Playbook, op: Extract<PlayMutation, { op: "mint" }>): PlayMutation {
  const base = findPlay(book, op.basedOn);
  if (!base) return op;
  const candidate = applyPatch(clonePlay(base), op.patch);
  candidate.family = op.patch.family ?? candidate.family;
  let best: Play | undefined;
  let bestSim = -1;
  for (const play of book.plays) {
    const s = playSimilarity(candidate, play);
    if (s > bestSim) {
      bestSim = s;
      best = play;
    }
  }
  if (!best || candidate.family !== best.family || !tooSimilar(candidate, best)) return op;
  const { slot, rel } = slotWithLargestDelta(best, candidate);
  return { op: "tweak_slot", playId: best.id, slot, rel, eventIds: op.eventIds };
}

function reject(op: PlayMutation, reason: string, bag: string[]): void {
  const line = describeRejected(op, reason);
  bag.push(line);
  console.warn(AAR_MUTATION_REJECTED, line);
}

function opRank(op: PlayMutation, result: AarResult): number {
  if (result === "win") {
    switch (op.op) {
      case "boost":
        return 0;
      case "nerf":
        return 1;
      case "tweak_slot":
        return 2;
      case "tweak_trigger":
        return 3;
      case "add_counter":
        return 4;
      case "mint":
        return 5;
      case "personnel":
        return 6;
      case "tweak_assignment":
        return 7;
      case "retire":
        return 8;
    }
  }
  switch (op.op) {
    case "add_counter":
      return 0;
    case "tweak_trigger":
      return 1;
    case "boost":
      return 2;
    case "nerf":
      return 3;
    case "tweak_slot":
      return 4;
    case "personnel":
      return 5;
    case "tweak_assignment":
      return 6;
    case "mint":
      return 7;
    case "retire":
      return 8;
  }
}

function pickBoostPlay(
  book: Playbook,
  usage: readonly MutatePlayUsage[] | undefined,
  preferId?: string,
): Play | undefined {
  if (preferId) {
    const hit = findPlay(book, preferId);
    if (hit && hit.status !== "retired") return hit;
  }
  for (const u of usage ?? []) {
    const p = findPlay(book, u.playId);
    if (p && p.status !== "retired") return p;
  }
  return book.plays.find((p) => p.status === "active");
}

function ensureMandatoryBoost(ops: PlayMutation[], book: Playbook, ctx: MutateContext): PlayMutation[] {
  const share = (ctx.playUsage ?? []).find((u) => u.xgShare > TIE_BOOST_XG_SHARE);
  const needWin = ctx.result === "win";
  const needTie = ctx.result === "tie" && share !== undefined;
  if (!needWin && !needTie) return ops;
  if (ops.some((o) => o.op === "boost")) return ops;
  const play = pickBoostPlay(book, ctx.playUsage, share?.playId);
  const eventId = ctx.knownEventIds[0];
  if (!play || !eventId) return ops;
  const boost: PlayMutation = {
    op: "boost",
    playId: play.id,
    reason: needTie ? "tie: play had xG share > 0.4" : "winner: lock what worked",
    eventIds: [eventId],
  };
  return [boost, ...ops];
}

function trimToCap(ops: PlayMutation[], result: AarResult, rejected: string[]): PlayMutation[] {
  if (ops.length <= MAX_MUTATIONS_PER_AAR) return ops;
  const protect =
    result === "win" || result === "tie" ? ops.find((o) => o.op === "boost") : undefined;
  const pool = protect ? ops.filter((o) => o !== protect) : ops;
  const slots = protect ? MAX_MUTATIONS_PER_AAR - 1 : MAX_MUTATIONS_PER_AAR;
  const ranked = [...pool].sort((a, b) => opRank(a, result) - opRank(b, result));
  const chosen = new Set(ranked.slice(0, slots));
  const kept: PlayMutation[] = [];
  for (const op of ops) {
    if (op === protect || chosen.has(op)) {
      if (kept.length < MAX_MUTATIONS_PER_AAR) kept.push(op);
      else reject(op, "max-ops", rejected);
    } else {
      reject(op, "max-ops", rejected);
    }
  }
  return kept;
}

function markStructural(play: Play): void {
  play.version += 1;
  if (play.origin === "seed") play.origin = "mutated";
}

function tweakTriggers(
  triggers: Play["triggers"],
  add?: PlayPredicate[],
  remove?: PlayPredicate[],
): Play["triggers"] {
  let next = structuredClone(triggers);
  const removeKeys = new Set((remove ?? []).map(predKey));
  if (removeKeys.size > 0) {
    next = next
      .map((g) => ({
        all: g.all?.filter((p) => !removeKeys.has(predKey(p))),
        any: g.any?.filter((p) => !removeKeys.has(predKey(p))),
      }))
      .filter((g) => (g.all?.length ?? 0) > 0 || (g.any?.length ?? 0) > 0);
  }
  if (add && add.length > 0) {
    if (next.length === 0) {
      next = [{ all: [...add] }];
    } else {
      const g0 = next[0]!;
      const have = new Set((g0.all ?? []).map(predKey));
      const extra = add.filter((p) => !have.has(predKey(p)));
      g0.all = [...(g0.all ?? []), ...extra];
    }
  }
  return next;
}

function applyOp(book: Playbook, op: PlayMutation): boolean {
  switch (op.op) {
    case "boost": {
      const play = findPlay(book, op.playId);
      if (!play) return false;
      play.stats = { ...play.stats, xgFor: play.stats.xgFor + BOOST_XG };
      play.version += 1;
      return true;
    }
    case "nerf": {
      const play = findPlay(book, op.playId);
      if (!play) return false;
      play.stats = { ...play.stats, xgAgainst: play.stats.xgAgainst + NERF_XG };
      play.version += 1;
      return true;
    }
    case "tweak_trigger": {
      const play = findPlay(book, op.playId);
      if (!play) return false;
      play.triggers = tweakTriggers(play.triggers, op.add, op.remove);
      markStructural(play);
      return true;
    }
    case "tweak_assignment": {
      const play = findPlay(book, op.playId);
      if (!play) return false;
      play.assignments = { ...play.assignments, ...op.patch };
      markStructural(play);
      return true;
    }
    case "tweak_slot": {
      const play = findPlay(book, op.playId);
      if (!play) return false;
      const existing = play.formation.slots[op.slot];
      play.formation.slots[op.slot] = existing
        ? { ...existing, rel: { x: op.rel.x, y: op.rel.y } }
        : { rel: { x: op.rel.x, y: op.rel.y }, landmark: "puck", role: "support" };
      markStructural(play);
      return true;
    }
    case "add_counter": {
      const play = findPlay(book, op.playId);
      if (!play) return false;
      if (!play.counters.includes(op.family)) play.counters = [...play.counters, op.family];
      markStructural(play);
      return true;
    }
    case "mint": {
      const base = findPlay(book, op.basedOn);
      if (!base) return false;
      const minted = applyPatch(clonePlay(base), op.patch);
      minted.id = uniquePlayId(book, slugifyPlayId(op.name));
      minted.name = op.name;
      minted.origin = "minted";
      minted.parentId = base.id;
      minted.status = "experimental";
      minted.version = 1;
      minted.stats = { games: 0, xgFor: 0, xgAgainst: 0 };
      book.plays.push(minted);
      return true;
    }
    case "retire": {
      const play = findPlay(book, op.playId);
      if (!play) return false;
      play.status = "retired";
      play.version += 1;
      return true;
    }
    case "personnel":
      return true;
  }
}

function gateOps(book: Playbook, ops: readonly PlayMutation[], ctx: MutateContext, rejected: string[]): PlayMutation[] {
  const usageMap = new Map((ctx.playUsage ?? []).map((u) => [u.playId, u]));
  const gated: PlayMutation[] = [];
  let mints = 0;
  let retires = 0;
  let loserAssign = 0;

  for (const raw of ops) {
    const op = raw.op === "mint" ? dedupMint(book, raw) : raw;
    if (op.op === "personnel") {
      gated.push(op);
      continue;
    }
    if (op.op === "mint") {
      const base = findPlay(book, op.basedOn);
      if (!base) {
        reject(op, "unknown-play", rejected);
        continue;
      }
      if (!PLAY_NAME_RE.test(op.name)) {
        reject(op, "bad-name", rejected);
        continue;
      }
      if (!mintAllowed(op.basedOn, ctx)) {
        reject(op, "mint-ineligible", rejected);
        continue;
      }
      if (mints >= MAX_MINTS_PER_AAR) {
        reject(op, "max-mints", rejected);
        continue;
      }
      mints += 1;
      gated.push(op);
      continue;
    }

    const rawId = playIdOf(op);
    const playId = rawId ? resolveTargetPlayId(book, rawId) : undefined;
    const play = playId ? findPlay(book, playId) : undefined;
    if (!play || !playId) {
      reject(op, "unknown-play", rejected);
      continue;
    }
    const opOnPlay =
      playId !== rawId && "playId" in op ? ({ ...op, playId } as PlayMutation) : op;

    if (opOnPlay.op === "retire") {
      const usage = usageMap.get(playId) ?? (rawId ? usageMap.get(rawId) : undefined);
      if (!retireAllowed(play, usage, ctx.result)) {
        reject(opOnPlay, ctx.result === "win" && playUsed(usage) ? "winner-retire-used" : "retire-ineligible", rejected);
        continue;
      }
      if (retires >= MAX_RETIRES_PER_AAR) {
        reject(opOnPlay, "max-retires", rejected);
        continue;
      }
      retires += 1;
      gated.push(opOnPlay);
      continue;
    }

    if (opOnPlay.op === "tweak_assignment" && ctx.result !== "win") {
      if (loserAssign >= MAX_LOSER_TWEAK_ASSIGNMENT) {
        reject(opOnPlay, "loser-tweak-assignment-cap", rejected);
        continue;
      }
      loserAssign += 1;
    }

    gated.push(opOnPlay);
  }

  return gated;
}

/**
 * Apply a PlaybookRevision under DESIGN §12 caps. Never mutates `book`.
 * Uncited ops are rejected here even if cite_check already dropped them.
 */
export function applyPlaybookRevision(
  book: Playbook,
  revision: PlaybookRevision,
  ctx: MutateContext,
): MutateResult {
  const cited = filterCited(revision.ops, ctx.knownEventIds);
  const rejected = [...cited.rejectedOps];
  let ops = gateOps(book, cited.kept, ctx, rejected);
  if (ops.length > 0) ops = ensureMandatoryBoost(ops, book, ctx);
  ops = trimToCap(ops, ctx.result, rejected);

  const next = cloneBook(book);
  const applied: PlayMutation[] = [];
  for (const op of ops) {
    if (applyOp(next, op)) applied.push(op);
    else reject(op, "apply-failed", rejected);
  }
  if (applied.length > 0) next.version = book.version + 1;
  return { book: next, applied, rejected, bumped: applied.length > 0 };
}
