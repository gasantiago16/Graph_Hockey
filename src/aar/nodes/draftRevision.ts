import { PlaybookRevisionSchema } from "../../llm/schemas.ts";
import { TIE_BOOST_XG_SHARE } from "../../types/aar.ts";
import { DEFAULT_PLAY_ID, type Play, type PlayMutation, type PlaybookRevision } from "../../types/play.ts";
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

function makeBoost(playId: string, eventId: string, reason: string): PlayMutation {
  return { op: "boost", playId, reason, eventIds: [eventId] };
}

function emptyRevision(summary: string): PlaybookRevision {
  return { summary: summary.slice(0, 1200), ops: [] };
}

export function ensureMandatoryBoost(state: AarGraphStateType, revision: PlaybookRevision): PlaybookRevision {
  const needWinBoost = state.result === "win";
  const sharePlay = playWithXgShare(state.playUsage ?? [], TIE_BOOST_XG_SHARE);
  const needTieBoost = state.result === "tie" && sharePlay !== undefined;
  if (!needWinBoost && !needTieBoost) return revision;
  if (revision.ops.some((op) => op.op === "boost")) return revision;

  const usage: PlayUsage | undefined = sharePlay ?? topPlay(state.playUsage ?? []);
  const play = targetPlay(state, usage?.playId);
  const eventId = firstCite(state, play?.id);
  if (!play || !eventId) return revision;

  const boost = makeBoost(
    play.id,
    eventId,
    needTieBoost ? "tie: play had xG share > 0.4" : "winner: lock what worked",
  );
  const rest = revision.ops.filter((op) => !(state.result === "win" && op.op === "retire"));
  return { summary: revision.summary, ops: [boost, ...rest].slice(0, 3) };
}

function opIsCited(state: AarGraphStateType, op: PlayMutation): boolean {
  const ids = op.eventIds;
  if (!ids || ids.length === 0) return false;
  const known = new Set(state.knownEventIds ?? []);
  return ids.every((id) => known.has(id));
}

/** Loser always leaves a cited add_counter when a play + event exist. */
export function ensureLoserCounter(state: AarGraphStateType, revision: PlaybookRevision): PlaybookRevision {
  if (state.result !== "loss") return revision;
  if (revision.ops.some((op) => (op.op === "add_counter" || op.op === "nerf") && opIsCited(state, op))) {
    return revision;
  }

  const usage = topPlay(state.playUsage ?? []);
  const play = targetPlay(state, usage?.playId);
  const eventId = firstCite(state, play?.id);
  if (!play || !eventId) return revision;

  const themFamily = themFamilyFromEvents(state.events ?? [], state.side, state.themPlaybook);
  const family =
    (themFamily && !play.counters.includes(themFamily) ? themFamily : undefined) ??
    play.vulnerableTo.find((f) => !play.counters.includes(f)) ??
    state.playbook.plays.map((p) => p.family).find((f) => f !== play.family && !play.counters.includes(f));
  if (!family) return revision;

  const op: PlayMutation = {
    op: "add_counter",
    playId: play.id,
    family,
    eventIds: [eventId],
  };
  return { summary: revision.summary, ops: [op, ...revision.ops].slice(0, 3) };
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
