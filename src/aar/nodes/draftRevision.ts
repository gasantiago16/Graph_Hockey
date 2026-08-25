import { PlaybookRevisionSchema } from "../../llm/schemas.ts";
import { TIE_BOOST_XG_SHARE } from "../../types/aar.ts";
import type { PlayMutation, PlaybookRevision } from "../../types/play.ts";
import type { AarGraphNode, AarGraphStateType } from "../state.ts";
import { invokeAarStructured, type AarLlmOpts } from "../llm.ts";
import { playWithXgShare, topPlay, type PlayUsage } from "./actual.ts";

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
  const playId = usage?.playId ?? state.playbook.plays[0]?.id;
  const eventId = firstCite(state, playId);
  if (!playId || !eventId) return revision;

  const boost = makeBoost(
    playId,
    eventId,
    needTieBoost ? "tie: play had xG share > 0.4" : "winner: lock what worked",
  );
  const rest = revision.ops.filter((op) => !(state.result === "win" && op.op === "retire"));
  return { summary: revision.summary, ops: [boost, ...rest].slice(0, 3) };
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
  return ensureMandatoryBoost(state, emptyRevision(summary || "code-only AAR digest"));
}

export function makeDraftRevision(opts: DraftOpts = {}): AarGraphNode {
  return async (state) => {
    if (opts.noLlm) {
      return { revision: codeDraft(state) };
    }
    const out = await invokeAarStructured(PlaybookRevisionSchema, SYSTEM, prompt(state), opts.profile);
    const base = out ?? emptyRevision(state.lensNotes ?? state.actualSummary ?? "draft fallback");
    return { revision: ensureMandatoryBoost(state, stripWinnerRetires(state, base)) };
  };
}
