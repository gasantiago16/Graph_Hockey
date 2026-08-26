import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledOtSeconds } from "../config.ts";
import { loadSeriesImprovement } from "../film/improvement.ts";
import { getRecording } from "../persist/clips.ts";
import { listImprovement } from "../persist/improvement.ts";
import { openMemoryDb } from "../persist/db.ts";
import { getMatch } from "../persist/matches.ts";
import {
  readPlaybookSnapshot,
  restorePlaybookSnapshot,
  snapshotPlaybooksToDir,
} from "../persist/playbookSnapshots.ts";
import {
  ensureSeedPlaybooks,
  insertPlaybook,
  latestPlaybook,
  listPlaybookVersions,
} from "../persist/playbooks.ts";
import { loadPlaybook } from "../playbook/store.ts";
import {
  DEFAULT_SERIES_GAMES,
  gameSeed,
  parseSeriesGames,
  runSeries,
  seriesMatchId,
} from "./series.ts";

const SHORT_PERIOD = 5;

describe("series seeds and defaults", () => {
  it("defaults to 7 games and gameSeed = seed + gameIndex", () => {
    expect(DEFAULT_SERIES_GAMES).toBe(7);
    expect(parseSeriesGames(undefined)).toBe(7);
    expect(gameSeed(100, 0)).toBe(100);
    expect(gameSeed(100, 1)).toBe(101);
    expect(gameSeed(100, 6)).toBe(106);
    expect(gameSeed(0xffff_ffff, 1)).toBe(0);
    expect(() => parseSeriesGames(0)).toThrow(/games/);
    expect(() => parseSeriesGames(22)).toThrow(/games/);
  });
});

describe("playbook snapshots restore", () => {
  it("restores version history after a later playbook write", async () => {
    const db = await openMemoryDb();
    const dir = mkdtempSync(join(tmpdir(), "gh-snap-"));
    try {
      ensureSeedPlaybooks(db);
      const { path } = snapshotPlaybooksToDir(db, {
        seriesId: "ser-restore",
        gameIndex: null,
        teamIds: ["original-six", "expansion"],
        dir,
      });
      const seed = latestPlaybook(db, "original-six")!;
      insertPlaybook(db, {
        teamId: "original-six",
        version: 2,
        body: { ...seed.body, version: 2 },
        parentVersion: 1,
        aarMatchId: "m-mut",
      });
      expect(latestPlaybook(db, "original-six")?.version).toBe(2);

      restorePlaybookSnapshot(db, readPlaybookSnapshot(path));
      const restored = latestPlaybook(db, "original-six");
      expect(restored?.version).toBe(1);
      expect(listPlaybookVersions(db, "original-six")).toHaveLength(1);
      expect(restored?.body.plays.map((p) => p.id)).toEqual(loadPlaybook("original-six").plays.map((p) => p.id));
      expect(latestPlaybook(db, "expansion")?.version).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("runSeries --no-llm", () => {
  it("plays 2 short games with seed+i and restore-safe snapshots", async () => {
    const db = await openMemoryDb();
    const dir = mkdtempSync(join(tmpdir(), "gh-series-"));
    try {
      const result = await runSeries({
        db,
        homeTeamId: "original-six",
        awayTeamId: "expansion",
        seed: 100,
        games: 2,
        seriesId: "ser-test-100",
        noLlm: true,
        periodSeconds: SHORT_PERIOD,
        otSeconds: scaledOtSeconds(SHORT_PERIOD),
        snapshotDir: dir,
        timeoutMs: 2000,
        record: true,
      });

      expect(result.games).toBe(2);
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0]?.gameSeed).toBe(100);
      expect(result.matches[1]?.gameSeed).toBe(101);
      expect(result.matches[0]?.match.seed).toBe(100);
      expect(result.matches[1]?.match.seed).toBe(101);
      expect(result.matches[0]?.match.matchId).toBe(seriesMatchId("ser-test-100", 0));
      expect(result.matches[1]?.match.matchId).toBe(seriesMatchId("ser-test-100", 1));

      const g0 = getMatch(db, "ser-test-100-g0");
      const g1 = getMatch(db, "ser-test-100-g1");
      expect(g0?.seed).toBe(100);
      expect(g1?.seed).toBe(101);
      expect(g0?.snapshot.seriesId).toBe("ser-test-100");
      expect(g0?.snapshot.gameIndex).toBe(0);
      expect(g1?.snapshot.gameIndex).toBe(1);
      expect(getRecording(db, "ser-test-100-g0")?.seriesId).toBe("ser-test-100");
      expect(getRecording(db, "ser-test-100-g1")?.gameIndex).toBe(1);

      expect(listImprovement(db, "ser-test-100")).toHaveLength(4);
      const board = loadSeriesImprovement(db, "ser-test-100");
      expect(board?.games).toHaveLength(2);
      expect(board?.home.id).toBe("original-six");
      expect(board?.away.id).toBe("expansion");
      expect(board?.deltas.home).toBeDefined();

      expect(result.snapshotPaths).toEqual([
        join(dir, "before.json"),
        join(dir, "after-game-0.json"),
        join(dir, "after-game-1.json"),
      ]);
      const before = readPlaybookSnapshot(result.beforeSnapshotPath);
      expect(before.gameIndex).toBeNull();
      expect(readPlaybookSnapshot(join(dir, "after-game-0.json")).gameIndex).toBe(0);

      const seed = latestPlaybook(db, "original-six")!;
      insertPlaybook(db, {
        teamId: "original-six",
        version: seed.version + 1,
        body: { ...seed.body, version: seed.version + 1 },
        parentVersion: seed.version,
        aarMatchId: "post-series",
      });
      expect(latestPlaybook(db, "original-six")?.version).toBe(seed.version + 1);
      restorePlaybookSnapshot(db, before);
      expect(latestPlaybook(db, "original-six")?.version).toBe(1);
    } finally {
      db.close();
    }
  }, 60_000);

  it("fromSnapshot opens game 0 on carried books and --no-llm does not mutate them", async () => {
    const src = await openMemoryDb();
    const dest = await openMemoryDb();
    const srcDir = mkdtempSync(join(tmpdir(), "gh-carry-src-"));
    const destDir = mkdtempSync(join(tmpdir(), "gh-carry-dst-"));
    try {
      ensureSeedPlaybooks(src);
      const seed = latestPlaybook(src, "original-six")!;
      insertPlaybook(src, {
        teamId: "original-six",
        version: 8,
        body: {
          ...seed.body,
          version: 8,
          plays: seed.body.plays.map((p) =>
            p.id === "5v5-122-forecheck"
              ? { ...p, stats: { games: 7, xgFor: 0.9, xgAgainst: 0.4 } }
              : p,
          ),
        },
        parentVersion: 1,
        aarMatchId: "prior-g6",
      });
      const { snapshot } = snapshotPlaybooksToDir(src, {
        seriesId: "ser-prior",
        gameIndex: 6,
        teamIds: ["original-six", "expansion"],
        dir: srcDir,
      });
      expect(latestPlaybook(src, "original-six")?.version).toBe(8);

      const result = await runSeries({
        db: dest,
        homeTeamId: "original-six",
        awayTeamId: "expansion",
        seed: 7,
        games: 1,
        seriesId: "ser-retain-test",
        noLlm: true,
        periodSeconds: SHORT_PERIOD,
        otSeconds: scaledOtSeconds(SHORT_PERIOD),
        snapshotDir: destDir,
        timeoutMs: 2000,
        fromSnapshot: snapshot,
      });

      expect(result.carriedFromSnapshot).toBe(true);
      const before = readPlaybookSnapshot(result.beforeSnapshotPath);
      expect(before.books.find((b) => b.teamId === "original-six" && b.version === 8)?.body.plays.find((p) => p.id === "5v5-122-forecheck")?.stats?.xgFor).toBe(0.9);
      expect(result.matches[0]?.playbookVersions.home).toBe(8);
      expect(result.matches[0]?.playbookVersions.away).toBe(1);
      expect(latestPlaybook(dest, "original-six")?.version).toBe(8);
    } finally {
      src.close();
      dest.close();
    }
  }, 60_000);

  it("fromSnapshot throws when a side is missing from the snapshot", async () => {
    const db = await openMemoryDb();
    try {
      await expect(
        runSeries({
          db,
          homeTeamId: "original-six",
          awayTeamId: "expansion",
          seed: 1,
          games: 1,
          seriesId: "ser-missing-team",
          noLlm: true,
          periodSeconds: SHORT_PERIOD,
          fromSnapshot: {
            seriesId: "empty",
            gameIndex: 6,
            capturedAt: "2026-08-26T00:00:00.000Z",
            books: [],
          },
        }),
      ).rejects.toThrow(/missing team books/);
    } finally {
      db.close();
    }
  });
});
