import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.ts";
import { openMemoryDb } from "../persist/db.ts";
import { insertAarReport, insertMatch } from "../persist/matches.ts";
import { ensureSeedPlaybooks } from "../persist/playbooks.ts";
import { makeOpeningSnapshot } from "../persist/snapshot.ts";
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

describe("static AAR + Film Room routes", () => {
  it("serves /aar and still serves /film", () => {
    expect(resolveStatic("/aar", ROOT)?.replace(/\\/g, "/")).toMatch(/src\/web\/aar.html$/);
    expect(resolveStatic("/film", ROOT)?.replace(/\\/g, "/")).toMatch(/src\/web\/film.html$/);
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
