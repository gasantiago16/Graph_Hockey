import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.ts";
import { EMPTY_AGGREGATES, recordGameImprovement } from "../film/improvement.ts";
import { insertClip, insertRecording } from "../persist/clips.ts";
import { openMemoryDb } from "../persist/db.ts";
import { insertAarReport, insertMatch } from "../persist/matches.ts";
import { ensureSeedPlaybooks } from "../persist/playbooks.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
import type { AarReport } from "../types/aar.ts";
import type { Clip } from "../types/film.ts";
import { handleHockeyRequest, resolveStatic } from "./http.ts";
import { StartSeriesBodySchema } from "../types/ws.ts";
import { createMatchControl } from "./matchControl.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function serve(db: Awaited<ReturnType<typeof openMemoryDb>>, extra: { paceMs?: number } = {}) {
  const config = loadConfig({ GRAPH_HOCKEY_HTTP_PORT: "0" });
  const control = createMatchControl({
    db,
    config,
    paceMs: extra.paceMs ?? 0,
    snapshotDir: mkdtempSync(path.join(tmpdir(), "gh-series-http-")),
  });
  const server = createServer((req, res) => {
    void handleHockeyRequest(req, res, { config, control, port: 9, root: ROOT, db });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const close = async () => {
    await control.stop();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };
  return { port: addr.port, base: `http://127.0.0.1:${addr.port}`, close };
}

describe("GET /api/health", () => {
  it("exposes provider booleans and never secrets", async () => {
    const db = await openMemoryDb();
    try {
      const { base, close } = await serve(db);
      try {
        const res = await fetch(`${base}/api/health`);
        expect(res.status).toBe(200);
        const json = (await res.json()) as {
          ok: boolean;
          llmConfigured: boolean;
          providers: { xai: boolean; muse: boolean; openai: boolean; gemini: boolean };
        };
        expect(json.ok).toBe(true);
        expect(json.llmConfigured).toBe(false);
        expect(json.providers).toEqual({ xai: false, muse: false, openai: false, gemini: false });
        const raw = JSON.stringify(json);
        expect(raw).not.toContain("API_KEY");
        expect(raw).not.toMatch(/sk-/);
      } finally {
        await close();
      }
    } finally {
      db.close();
    }
  });
});

describe("static AAR + Film Room routes", () => {
  it("serves /aar and still serves /film", () => {
    expect(resolveStatic("/aar", ROOT)?.replace(/\\/g, "/")).toMatch(/src\/web\/aar.html$/);
    expect(resolveStatic("/film", ROOT)?.replace(/\\/g, "/")).toMatch(/src\/web\/film.html$/);
    expect(resolveStatic("/film/series/ser-1", ROOT)?.replace(/\\/g, "/")).toMatch(/src\/web\/film.html$/);
    expect(resolveStatic("/film/series/ser-1/", ROOT)?.replace(/\\/g, "/")).toMatch(/src\/web\/film.html$/);
    expect(resolveStatic("/", ROOT)?.replace(/\\/g, "/")).toMatch(/src\/web\/index.html$/);
  });
});

describe("REST /api/aar and /api/playbook", () => {
  it("GET stored AAR and playbook diff without live xAI", async () => {
    const db = await openMemoryDb();
    try {
      ensureSeedPlaybooks(db);
      insertMatch(db, makeOpeningSnapshot({ matchId: "m1", seed: 1 }));
      insertAarReport(
        db,
        "m1",
        "home",
        {
          matchId: "m1",
          side: "home",
          result: "win",
          intentSummary: "Hold structure",
          actualSummary: "xG 1-0",
          causes: [{ claim: "goal", eventIds: ["m1:0"], playIds: [] }],
          revision: { summary: "lock", ops: [] },
        },
        false,
      );
      const { base, close } = await serve(db);
      try {
        const aar = await fetch(`${base}/api/aar/m1/home`);
        expect(aar.status).toBe(200);
        const aarJson = (await aar.json()) as { intentSummary: string; applied: boolean };
        expect(aarJson.intentSummary).toBe("Hold structure");
        expect(aarJson.applied).toBe(false);

        const pb = await fetch(`${base}/api/playbook/original-six?diff=1`);
        expect(pb.status).toBe(200);
        const pbJson = (await pb.json()) as { teamId: string; diff: { toVersion: number } };
        expect(pbJson.teamId).toBe("original-six");
        expect(pbJson.diff.toVersion).toBe(1);

        const page = await fetch(`${base}/aar?match=m1`);
        expect(page.status).toBe(200);
        const html = await page.text();
        expect(html).toContain("AAR");
        expect(html).toContain("/src/web/aar.js");

        const film = await fetch(`${base}/film`);
        expect(film.status).toBe(200);
        expect(await film.text()).toContain("FILM ROOM");

        const seriesPage = await fetch(`${base}/film/series/ser-1`);
        expect(seriesPage.status).toBe(200);
        expect(await seriesPage.text()).toContain("FILM ROOM");

        const rink = await fetch(`${base}/`);
        expect(rink.status).toBe(200);
        expect(await rink.text()).toContain("Start series (7)");
      } finally {
        await close();
      }
    } finally {
      db.close();
    }
  });
});

describe("REST /api/series/:id/improvement", () => {
  it("returns 404 then ledger + paired clips without live xAI", async () => {
    const db = await openMemoryDb();
    try {
      ensureSeedPlaybooks(db);
      const { base, close } = await serve(db);
      try {
        const missing = await fetch(`${base}/api/series/nope/improvement`);
        expect(missing.status).toBe(404);

        for (const gameIndex of [0, 1] as const) {
          const matchId = `ser-http-g${gameIndex}`;
          insertMatch(
            db,
            makeOpeningSnapshot({ matchId, seed: 4 + gameIndex, seriesId: "ser-http", gameIndex }),
          );
          insertRecording(db, {
            matchId,
            seriesId: "ser-http",
            gameIndex,
            recordedAt: "2026-08-24T00:00:00.000Z",
            durationLiveTicks: 50,
          });
          const clip: Clip = {
            id: `${matchId}:clip:0`,
            matchId,
            seriesId: "ser-http",
            gameIndex,
            startLiveTick: 1,
            endLiveTick: 40,
            anchorEventId: `${matchId}:1`,
            relatedEventIds: [`${matchId}:1`],
            kind: gameIndex === 0 ? "goal" : "save",
            title: gameIndex === 0 ? "GOAL" : "Save",
            source: "auto",
            playId: "dz-collapse",
            signature: gameIndex === 0 ? "dz-collapse|DZ|Goal,Shot" : "dz-collapse|DZ|Save,Shot",
            xG: 0.2,
          };
          insertClip(db, clip);
          const home: AarReport = {
            matchId,
            side: "home",
            result: "tie",
            aggregates: { ...EMPTY_AGGREGATES, xgFor: gameIndex, goalsFor: gameIndex },
            revision: { summary: "ok", ops: [] },
          };
          recordGameImprovement({
            db,
            seriesId: "ser-http",
            gameIndex,
            matchId,
            homeTeamId: "original-six",
            awayTeamId: "expansion",
            matchResult: "tie",
            playbookVersionBefore: { home: 1, away: 1 },
            aar: { home, away: { ...home, side: "away" } },
          });
        }

        const res = await fetch(`${base}/api/series/ser-http/improvement`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          seriesId: string;
          games: unknown[];
          pairs: { playId: string }[];
          ledger: unknown[];
        };
        expect(body.seriesId).toBe("ser-http");
        expect(body.games).toHaveLength(2);
        expect(body.ledger).toHaveLength(4);
        expect(body.pairs[0]?.playId).toBe("dz-collapse");

        const pairs = await fetch(`${base}/api/series/ser-http/pairs?compare=0,1`);
        expect(pairs.status).toBe(200);
        const pairList = (await pairs.json()) as { playId: string }[];
        expect(pairList[0]?.playId).toBe("dz-collapse");
      } finally {
        await close();
      }
    } finally {
      db.close();
    }
  });
});

describe("REST /api/series", () => {
  it("starts and stops a --no-llm series without live xAI", async () => {
    const db = await openMemoryDb();
    try {
      ensureSeedPlaybooks(db);
      const { base, close } = await serve(db, { paceMs: 50 });
      try {
        const started = await fetch(`${base}/api/series/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            home: "original-six",
            away: "expansion",
            seed: 100,
            noLlm: true,
            periodSeconds: 5,
            games: 2,
          }),
        });
        expect(started.status).toBe(200);
        const body = (await started.json()) as { seriesId: string; games: number; status: string };
        expect(body.games).toBe(2);
        expect(body.status).toBe("running");
        expect(body.seriesId).toBeTruthy();

        const status = await fetch(`${base}/api/series`);
        expect(status.status).toBe(200);
        const st = (await status.json()) as { running: boolean; seriesId?: string; games?: number };
        expect(st.running).toBe(true);
        expect(st.seriesId).toBe(body.seriesId);
        expect(st.games).toBe(2);

        const stopped = await fetch(`${base}/api/series/stop`, { method: "POST" });
        expect(stopped.status).toBe(200);
        const empty = StartSeriesBodySchema.parse({});
        expect(empty.games).toBe(7);
      } finally {
        await close();
      }
    } finally {
      db.close();
    }
  });
});
