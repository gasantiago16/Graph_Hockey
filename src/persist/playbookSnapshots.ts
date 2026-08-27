import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PlaybookSchema } from "../types/play.ts";
import type { Db } from "./db.ts";
import {
  listPlaybookVersions,
  replaceTeamPlaybooks,
  type PlaybookRow,
} from "./playbooks.ts";

/** Filesystem snapshots under `data/playbook-snapshots/` (not SQLite). */
export const PLAYBOOK_SNAPSHOT_DIRNAME = "playbook-snapshots";

export const PlaybookRowSnapshotSchema = z.object({
  teamId: z.string().min(1),
  version: z.number().int(),
  body: PlaybookSchema,
  parentVersion: z.number().int().nullable(),
  aarMatchId: z.string().nullable(),
});

export const PlaybookSnapshotSchema = z.object({
  seriesId: z.string().min(1),
  /** `null` = captured before game 0. */
  gameIndex: z.number().int().nullable(),
  capturedAt: z.string().min(1),
  books: z.array(PlaybookRowSnapshotSchema),
});
export type PlaybookSnapshot = z.infer<typeof PlaybookSnapshotSchema>;

export function defaultSnapshotDir(root = process.cwd()): string {
  return join(root, "data", PLAYBOOK_SNAPSHOT_DIRNAME);
}

export function snapshotFileName(gameIndex: number | null): string {
  return gameIndex === null ? "before.json" : `after-game-${gameIndex}.json`;
}

export function capturePlaybookSnapshot(
  db: Db,
  opts: { seriesId: string; gameIndex: number | null; teamIds: readonly string[] },
): PlaybookSnapshot {
  const books: PlaybookRow[] = [];
  for (const teamId of opts.teamIds) {
    books.push(...listPlaybookVersions(db, teamId));
  }
  return PlaybookSnapshotSchema.parse({
    seriesId: opts.seriesId,
    gameIndex: opts.gameIndex,
    capturedAt: new Date().toISOString(),
    books,
  });
}

export function writePlaybookSnapshot(dir: string, snapshot: PlaybookSnapshot): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, snapshotFileName(snapshot.gameIndex));
  writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return file;
}

export function readPlaybookSnapshot(path: string): PlaybookSnapshot {
  return PlaybookSnapshotSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Keep only these teams' rows. Seed books for omitted teams stay in the dest db. */
export function filterSnapshotTeams(snapshot: PlaybookSnapshot, teamIds: readonly string[]): PlaybookSnapshot {
  const keep = new Set(teamIds);
  return PlaybookSnapshotSchema.parse({
    ...snapshot,
    books: snapshot.books.filter((row) => keep.has(row.teamId)),
  });
}

/** Restore exact version history for teams present in the snapshot. */
export function restorePlaybookSnapshot(db: Db, snapshot: PlaybookSnapshot): void {
  const parsed = PlaybookSnapshotSchema.parse(snapshot);
  const byTeam = new Map<string, PlaybookRow[]>();
  for (const row of parsed.books) {
    const list = byTeam.get(row.teamId) ?? [];
    list.push(row);
    byTeam.set(row.teamId, list);
  }
  db.transaction(() => {
    for (const [teamId, rows] of byTeam) {
      replaceTeamPlaybooks(db, teamId, rows);
    }
  });
}

export function snapshotPlaybooksToDir(
  db: Db,
  opts: { seriesId: string; gameIndex: number | null; teamIds: readonly string[]; dir: string },
): { snapshot: PlaybookSnapshot; path: string } {
  const snapshot = capturePlaybookSnapshot(db, opts);
  return { snapshot, path: writePlaybookSnapshot(opts.dir, snapshot) };
}
