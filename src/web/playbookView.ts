import type { PlaybookDiff, PlaybookDiffEntry } from "../playbook/diff.ts";

export type PlaybookQuery = {
  teamId?: string;
  matchId?: string;
  version?: number;
  diff: boolean;
};

function emptyToUndef(v: string | null): string | undefined {
  if (v === null || v === "") return undefined;
  return v;
}

/** `?diff=1` (also true/yes). */
export function wantDiffParam(raw: string | null | undefined): boolean {
  if (raw == null || raw === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function parsePlaybookQuery(search: string): Omit<PlaybookQuery, "teamId"> {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const q = new URLSearchParams(raw);
  const versionRaw = q.get("version");
  const version = versionRaw !== null && versionRaw !== "" ? Number.parseInt(versionRaw, 10) : Number.NaN;
  return {
    matchId: emptyToUndef(q.get("match")),
    version: Number.isFinite(version) ? version : undefined,
    diff: wantDiffParam(q.get("diff")),
  };
}

export function playbookApiHref(
  teamId: string,
  opts: { diff?: boolean; version?: number; matchId?: string } = {},
): string {
  const q = new URLSearchParams();
  if (opts.diff) q.set("diff", "1");
  if (opts.version !== undefined) q.set("version", String(opts.version));
  if (opts.matchId) q.set("match", opts.matchId);
  const s = q.toString();
  const path = `/api/playbook/${encodeURIComponent(teamId)}`;
  return s ? `${path}?${s}` : path;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const KIND_MARK: Record<PlaybookDiffEntry["kind"], string> = {
  added: "+",
  removed: "-",
  changed: "~",
};

export function formatDiffEntry(entry: PlaybookDiffEntry): string {
  const mark = KIND_MARK[entry.kind];
  const fields = entry.kind === "changed" && entry.fields?.length ? `  ${entry.fields.join(",")}` : "";
  return `${mark} ${entry.id}  ${entry.name}${fields}`;
}

export function renderPlaybookDiffHtml(diff: PlaybookDiff, opts: { applied?: boolean } = {}): string {
  const rows = [...diff.added, ...diff.removed, ...diff.changed];
  const body =
    rows.length === 0
      ? `<p class="muted">(no play changes)</p>`
      : `<ul class="diff">${rows
          .map((e) => `<li class="${escapeHtml(e.kind)}">${escapeHtml(formatDiffEntry(e))}</li>`)
          .join("")}</ul>`;
  const applied =
    opts.applied === true ? `<p class="applied">applied</p>` : opts.applied === false ? `<p class="applied">not applied</p>` : "";
  return `<article class="playbook-diff" data-team="${escapeHtml(diff.teamId)}">
  <h2>Playbook ${escapeHtml(diff.teamId)} v${diff.fromVersion} → v${diff.toVersion}</h2>
  ${applied}
  ${body}
</article>`;
}
