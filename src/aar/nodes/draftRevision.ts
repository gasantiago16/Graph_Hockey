import { PlaybookRevisionSchema } from "../../llm/schemas.ts";
import { TIE_BOOST_XG_SHARE } from "../../types/aar.ts";
import { DEFAULT_PLAY_ID, type Play, type PlayMutation, type PlaybookRevision } from "../../types/play.ts";
import { isEmptyNetPlay, isLeadProtectPlay } from "../../playbook/retrieve.ts";
import { defaultPlayIdForBook } from "../../playbook/store.ts";
import type { AarGraphNode, AarGraphStateType } from "../state.ts";
import { invokeAarStructured, type AarLlmOpts } from "../llm.ts";
import { playWithXgShare, themFamilyFromEvents, topPlay, type PlayUsage } from "./actual.ts";

export type DraftOpts = AarLlmOpts;

const SYSTEM =
  "Draft a PlaybookRevision. Max 3 ops. Every op MUST include eventIds copied from the digest " +
  "(format matchId:seq). Do not invent event ids. Winner: at least one boost; no retire of a used play; " +
  "mint only if mintEligible. Loser/tie: prefer add_counter or tweak_trigger. Summary max 1200 chars.";

function prompt(state: AarGraphStateType): string {
  const playIds = (state.playbook.plays ?? []).map((p) => p.id);
  return JSON.stringify({
    matchId: state.matchId,
    side: state.side,
    result: state.result,
    intentSummary: state.intentSummary,
    actualSummary: state.actualSummary,
    lensNotes: state.lensNotes,
    causes: state.causes,
    mintEligible: state.mintEligible === true,
    playUsage: state.playUsage,
    playIds,
    digest: state.eventLogDigest?.events ?? [],
  });
}

function firstCite(state: AarGraphStateType, playId?: string): string | undefined {
  const events = state.eventLogDigest?.events ?? [];
  const hit = playId ? events.find((e) => e.playId === playId) : undefined;
  return hit?.id ?? events[0]?.id ?? state.knownEventIds?.[0];
}

/** `default-structure` is a code fallback, not a seed row. */
function targetPlay(state: AarGraphStateType, playId?: string): Play | undefined {
  const plays = state.playbook.plays ?? [];
  if (playId && playId !== DEFAULT_PLAY_ID) {
    const hit = plays.find((p) => p.id === playId);
    if (hit) return hit;
  }
  return plays.find((p) => p.status === "active") ?? plays[0];
}

function isEvenStrengthPlay(play: Play): boolean {
  return play.strength.includes("5v5") || play.strength.includes("3v3");
}

function evenStrengthOnIce(state: AarGraphStateType): boolean {
  return (state.playUsage ?? []).some((row) => {
    const play = targetPlay(state, row.playId);
    return !!play && isEvenStrengthPlay(play) && (row.seconds > 0 || row.xgFor > 0 || row.xgAgainst > 0);
  });
}

/** Prefer 5v5/3v3 so a 20s PP is not the series lesson. Stay even if 5v5 was on the ice with 0 xG. */
function lessonUsage(state: AarGraphStateType): PlayUsage[] {
  const usage = state.playUsage ?? [];
  const even = usage.filter((row) => {
    const play = targetPlay(state, row.playId);
    return play ? isEvenStrengthPlay(play) : false;
  });
  if (even.some((row) => row.xgFor > 0 || row.seconds > 0 || row.xgAgainst > 0)) return even;
  return [...usage];
}

function makeBoost(playId: string, eventId: string, reason: string): PlayMutation {
  return { op: "boost", playId, reason, eventIds: [eventId] };
}

function emptyRevision(summary: string): PlaybookRevision {
  return { summary: summary.slice(0, 1200), ops: [] };
}

function boostHasMatchXg(state: AarGraphStateType, op: PlayMutation): boolean {
  if (op.op !== "boost") return false;
  const usage =
    (state.playUsage ?? []).find((p) => p.playId === op.playId) ??
    (state.playbook && op.playId === defaultPlayIdForBook(state.playbook)
      ? (state.playUsage ?? []).find((p) => p.playId === DEFAULT_PLAY_ID)
      : undefined);
  return !!usage && usage.xgFor > 0;
}

export function ensureMandatoryBoost(state: AarGraphStateType, revision: PlaybookRevision): PlaybookRevision {
  const evenOnIce = evenStrengthOnIce(state);
  if (evenOnIce) {
    revision = {
      summary: revision.summary,
      ops: revision.ops.filter((op) => {
        if (op.op !== "boost") return true;
        const play = targetPlay(state, op.playId);
        return play ? isEvenStrengthPlay(play) : false;
      }),
    };
  }
  const needWinBoost = state.result === "win";
  const pool = lessonUsage(state);
  const sharePlay = playWithXgShare(pool, TIE_BOOST_XG_SHARE);
  const needTieBoost = state.result === "tie" && sharePlay !== undefined;
  if (!needWinBoost && !needTieBoost) return revision;
  if (revision.ops.some((op) => boostHasMatchXg(state, op))) return revision;

  const usage: PlayUsage | undefined =
    sharePlay ?? pool.find((p) => p.xgFor > 0) ?? topPlay(pool);
  if (!usage || usage.xgFor <= 0) {
    return { summary: revision.summary, ops: revision.ops.filter((op) => op.op !== "boost") };
  }
  const play = targetPlay(state, usage.playId);
  const eventId = firstCite(state, play?.id);
  if (!play || !eventId) {
    return { summary: revision.summary, ops: revision.ops.filter((op) => op.op !== "boost") };
  }

  const boost = makeBoost(
    play.id,
    eventId,
    needTieBoost ? "tie: play had xG share > 0.4" : "winner: lock what worked",
  );
  const rest = revision.ops.filter(
    (op) => op.op !== "boost" && !(state.result === "win" && op.op === "retire"),
  );
  return { summary: revision.summary, ops: [boost, ...rest].slice(0, 3) };
}

function opIsCited(state: AarGraphStateType, op: PlayMutation): boolean {
  const ids = op.eventIds;
  if (!ids || ids.length === 0) return false;
  const known = new Set(state.knownEventIds ?? []);
  return ids.every((id) => known.has(id));
}

function zoneOverlap(a: Play, b: Play): boolean {
  if (a.zoneBias.includes("any") || b.zoneBias.includes("any")) return true;
  return a.zoneBias.some((z) => b.zoneBias.includes(z));
}

/** Counter the thing that beat us on a *different* even-strength sheet — not the lost-with play. */
function pickLoserCounterPlay(state: AarGraphStateType, lostWith: Play): Play | undefined {
  const even = (state.playbook.plays ?? []).filter(
    (p) =>
      p.status === "active" &&
      isEvenStrengthPlay(p) &&
      p.id !== lostWith.id &&
      !isLeadProtectPlay(p) &&
      !isEmptyNetPlay(p),
  );
  const themFamily = themFamilyFromEvents(state.events ?? [], state.side, state.themPlaybook);
  if (themFamily) {
    const already = even.find((p) => p.counters.includes(themFamily));
    if (already) return already;
  }
  return even.find((p) => zoneOverlap(p, lostWith)) ?? even[0];
}

/** Loser always leaves a cited add_counter when a play + event exist. Not on the lost-with play. */
export function ensureLoserCounter(state: AarGraphStateType, revision: PlaybookRevision): PlaybookRevision {
  if (state.result !== "loss") return revision;

  const usage = topPlay(lessonUsage(state));
  const lostWith = targetPlay(state, usage?.playId);
  if (!lostWith) return revision;

  const citedCounter = revision.ops.find((op) => op.op === "add_counter" && opIsCited(state, op));
  if (citedCounter && citedCounter.op === "add_counter" && citedCounter.playId !== lostWith.id) {
    return revision;
  }
  if (revision.ops.some((op) => op.op === "nerf" && opIsCited(state, op))) {
    return revision;
  }

  const alt = pickLoserCounterPlay(state, lostWith);
  const eventId = firstCite(state, alt?.id) ?? firstCite(state, lostWith.id);
  if (!alt || !eventId) return revision;

  const themFamily = themFamilyFromEvents(state.events ?? [], state.side, state.themPlaybook);
  const family =
    (themFamily && !alt.counters.includes(themFamily) ? themFamily : undefined) ??
    lostWith.vulnerableTo.find((f) => !alt.counters.includes(f)) ??
    alt.vulnerableTo.find((f) => !alt.counters.includes(f)) ??
    state.playbook.plays.map((p) => p.family).find((f) => f !== alt.family && !alt.counters.includes(f));
  if (!family) return revision;

  const op: PlayMutation = {
    op: "add_counter",
    playId: alt.id,
    family,
    eventIds: [eventId],
  };
  const rest = revision.ops.filter((o) => !(o.op === "add_counter" && o.playId === lostWith.id));
  return { summary: revision.summary, ops: [op, ...rest].slice(0, 3) };
}

export function stripWinnerRetires(state: AarGraphStateType, revision: PlaybookRevision): PlaybookRevision {
  if (state.result !== "win") return revision;
  const used = new Set((state.playUsage ?? []).filter((p) => p.seconds > 0 || p.xgFor > 0).map((p) => p.playId));
  return {
    summary: revision.summary,
    ops: revision.ops.filter((op) => op.op !== "retire" || !("playId" in op) || !used.has(op.playId)),
  };
}

export function codeDraft(state: AarGraphStateType): PlaybookRevision {
  const summary = [state.intentSummary, state.actualSummary, state.lensNotes].filter(Boolean).join(" ").slice(0, 1200);
  return ensureLoserCounter(state, ensureMandatoryBoost(state, emptyRevision(summary || "code-only AAR digest")));
}

export function makeDraftRevision(opts: DraftOpts = {}): AarGraphNode {
  return async (state) => {
    if (opts.noLlm) {
      return { revision: codeDraft(state) };
    }
    const out = await invokeAarStructured(PlaybookRevisionSchema, SYSTEM, prompt(state), opts.profile);
    const base = out ?? emptyRevision(state.lensNotes ?? state.actualSummary ?? "draft fallback");
    return {
      revision: ensureLoserCounter(state, ensureMandatoryBoost(state, stripWinnerRetires(state, base))),
    };
  };
}
