import type { Play, Playbook } from "../types/play.ts";

export type PlaybookDiffEntry = {
  id: string;
  name: string;
  kind: "added" | "removed" | "changed";
  fields?: string[];
};

export type PlaybookDiff = {
  teamId: string;
  fromVersion: number;
  toVersion: number;
  added: PlaybookDiffEntry[];
  removed: PlaybookDiffEntry[];
  changed: PlaybookDiffEntry[];
};

const TRACKED_FIELDS = [
  "name",
  "status",
  "family",
  "strength",
  "zoneBias",
  "triggers",
  "assignments",
  "formation",
  "counters",
  "vulnerableTo",
  "stats",
  "origin",
  "parentId",
] as const;

function fieldChanged(a: Play, b: Play, key: (typeof TRACKED_FIELDS)[number]): boolean {
  return JSON.stringify(a[key]) !== JSON.stringify(b[key]);
}

export function diffPlaybooks(from: Playbook, to: Playbook): PlaybookDiff {
  const fromById = new Map(from.plays.map((p) => [p.id, p]));
  const toById = new Map(to.plays.map((p) => [p.id, p]));
  const added: PlaybookDiffEntry[] = [];
  const removed: PlaybookDiffEntry[] = [];
  const changed: PlaybookDiffEntry[] = [];

  for (const play of to.plays) {
    const prev = fromById.get(play.id);
    if (!prev) {
      added.push({ id: play.id, name: play.name, kind: "added" });
      continue;
    }
    const fields = TRACKED_FIELDS.filter((k) => fieldChanged(prev, play, k));
    if (fields.length > 0) {
      changed.push({ id: play.id, name: play.name, kind: "changed", fields: [...fields] });
    }
  }
  for (const play of from.plays) {
    if (!toById.has(play.id)) {
      removed.push({ id: play.id, name: play.name, kind: "removed" });
    }
  }

  return {
    teamId: to.teamId || from.teamId,
    fromVersion: from.version,
    toVersion: to.version,
    added,
    removed,
    changed,
  };
}

export function formatPlaybookDiff(diff: PlaybookDiff): string {
  const lines = [`playbook ${diff.teamId} v${diff.fromVersion} → v${diff.toVersion}`];
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    lines.push("  (no play changes)");
    return lines.join("\n");
  }
  for (const e of diff.added) lines.push(`  + ${e.id}  ${e.name}`);
  for (const e of diff.removed) lines.push(`  - ${e.id}  ${e.name}`);
  for (const e of diff.changed) {
    const fields = e.fields?.length ? `  ${e.fields.join(",")}` : "";
    lines.push(`  ~ ${e.id}${fields}`);
  }
  return lines.join("\n");
}
