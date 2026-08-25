import type { AarCause, AarReport } from "../types/aar.ts";
import type { Side } from "../types/hockey.ts";
import type { PlayMutation } from "../types/play.ts";
import { filmHref } from "./filmRoom.ts";

export type AarQuery = {
  matchId?: string;
  side?: Side;
};

function emptyToUndef(v: string | null): string | undefined {
  if (v === null || v === "") return undefined;
  return v;
}

export function parseAarSide(raw: string | null | undefined): Side | undefined {
  if (raw === "home" || raw === "away") return raw;
  return undefined;
}

/** Parse `/aar?match=&side=`. Invalid `side` is ignored (show both). */
export function parseAarQuery(search: string): AarQuery {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const q = new URLSearchParams(raw);
  return {
    matchId: emptyToUndef(q.get("match")),
    side: parseAarSide(q.get("side")),
  };
}

export function aarHref(query: AarQuery): string {
  const q = new URLSearchParams();
  if (query.matchId) q.set("match", query.matchId);
  if (query.side) q.set("side", query.side);
  const s = q.toString();
  return s ? `/aar?${s}` : "/aar";
}

/** Film Room jump: `/film?match=&event=` (DESIGN §16c). */
export function watchHref(matchId: string, eventId: string): string {
  return filmHref({
    matchId: matchId || undefined,
    eventId: eventId || undefined,
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function describeMutation(op: PlayMutation): string {
  switch (op.op) {
    case "boost":
    case "nerf":
    case "retire":
      return `${op.op} ${op.playId} — ${op.reason}`;
    case "tweak_trigger":
      return `tweak_trigger ${op.playId}`;
    case "tweak_assignment":
      return `tweak_assignment ${op.playId}`;
    case "tweak_slot":
      return `tweak_slot ${op.playId} ${op.slot}`;
    case "add_counter":
      return `add_counter ${op.playId} vs ${op.family}`;
    case "mint":
      return `mint ${op.name} from ${op.basedOn}`;
    case "personnel":
      return `personnel ${op.line} — ${op.note}`;
    default: {
      const _never: never = op;
      return String(_never);
    }
  }
}

export function renderWatchLink(matchId: string, eventId: string): string {
  const href = escapeHtml(watchHref(matchId, eventId));
  return `<a class="watch" href="${href}">Watch</a>`;
}

function renderEventCitations(matchId: string, eventIds: readonly string[]): string {
  if (eventIds.length === 0) return "";
  const links = eventIds
    .map((id) => `<li><code>${escapeHtml(id)}</code> ${renderWatchLink(matchId, id)}</li>`)
    .join("");
  return `<ul class="cites">${links}</ul>`;
}

function renderCause(matchId: string, cause: AarCause): string {
  const plays = cause.playIds.length > 0 ? ` <span class="muted">${escapeHtml(cause.playIds.join(", "))}</span>` : "";
  return `<li class="cause"><div class="claim">${escapeHtml(cause.claim)}${plays}</div>${renderEventCitations(matchId, cause.eventIds)}</li>`;
}

export function collectWatchEventIds(report: Pick<AarReport, "causes" | "revision">): string[] {
  const ids = new Set<string>();
  for (const c of report.causes ?? []) {
    for (const id of c.eventIds) ids.add(id);
  }
  for (const op of report.revision?.ops ?? []) {
    for (const id of op.eventIds) ids.add(id);
  }
  return [...ids];
}

export type AarViewOpts = {
  applied?: boolean;
};

/** HTML for supposed / actual / why / ops. Watch links open Film Room. */
export function renderAarReportHtml(report: AarReport, opts: AarViewOpts = {}): string {
  const matchId = report.matchId;
  const applied =
    opts.applied === true ? "applied" : opts.applied === false ? "proposed (not applied)" : "";
  const supposed = report.intentSummary?.trim() ? report.intentSummary : "No stored coach intents.";
  const actual = report.actualSummary?.trim() ? report.actualSummary : "No actual summary.";
  const causes = report.causes ?? [];
  const why =
    causes.length > 0
      ? `<ul class="causes">${causes.map((c) => renderCause(matchId, c)).join("")}</ul>`
      : `<p class="muted">${report.noLlm ? "No cited causes (code-only AAR)." : "No cited causes."}</p>`;
  const ops = report.revision?.ops ?? [];
  const opsHtml =
    ops.length > 0
      ? `<ul class="ops">${ops
          .map(
            (op) =>
              `<li class="op"><div>${escapeHtml(describeMutation(op))}</div>${renderEventCitations(matchId, op.eventIds)}</li>`,
          )
          .join("")}</ul>`
      : `<p class="muted">No playbook mutations.</p>`;
  const rejected = report.rejectedOps ?? [];
  const rejectedHtml =
    rejected.length > 0
      ? `<section class="aar-block"><h3>Rejected</h3><ul>${rejected.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></section>`
      : "";
  const lens = report.lensNotes?.trim()
    ? `<section class="aar-block"><h3>Lens</h3><p class="pre">${escapeHtml(report.lensNotes)}</p></section>`
    : "";
  const revSummary = report.revision?.summary?.trim()
    ? `<p class="muted">${escapeHtml(report.revision.summary)}</p>`
    : "";
  const appliedHtml = applied ? `<p class="applied">${escapeHtml(applied)}</p>` : "";

  return `<article class="aar" data-side="${escapeHtml(report.side)}" data-match="${escapeHtml(matchId)}">
  <h2>${escapeHtml(report.side)} AAR · ${escapeHtml(report.result)}</h2>
  ${appliedHtml}
  <section class="aar-block">
    <h3>Supposed</h3>
    <p class="pre">${escapeHtml(supposed)}</p>
  </section>
  <section class="aar-block">
    <h3>Actual</h3>
    <p class="pre">${escapeHtml(actual)}</p>
  </section>
  <section class="aar-block">
    <h3>Why</h3>
    ${why}
  </section>
  <section class="aar-block">
    <h3>Ops</h3>
    ${revSummary}
    ${opsHtml}
  </section>
  ${lens}
  ${rejectedHtml}
</article>`;
}
