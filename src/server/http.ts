import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type AppConfig, type EnvMap } from "../config.ts";
import { DT } from "../engine/rink.ts";
import {
  framesToJsonl,
  materializeClipFrames,
  resolveClip,
  resolveEventFootage,
} from "../film/frames.ts";
import { getFootage, getRecording } from "../persist/clips.ts";
import type { Clip } from "../types/film.ts";
import { defaultDbPath, openDb, type Db } from "../persist/db.ts";
import { getMatch, listMatches } from "../persist/matches.ts";
import { ensureSeedPlaybooks } from "../persist/playbooks.ts";
import { StartMatchBodySchema } from "../types/ws.ts";
import { createMatchControl, MatchBusyError, MatchStartError, type MatchControl } from "./matchControl.ts";
import { corsOrigins, isLoopbackHost, originAllowed } from "./protocol.ts";
import { createWsHub } from "./ws.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
};

const MAX_BODY = 64_000;

type Ctx = {
  config: AppConfig;
  control: MatchControl;
  port: number;
  root: string;
  db: Db;
};

function applyCors(req: IncomingMessage, res: ServerResponse, port: number): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== "") {
    if (!originAllowed(origin, port)) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "origin not allowed" }));
      return false;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function wantJsonl(req: IncomingMessage, url: URL): boolean {
  const format = (url.searchParams.get("format") ?? "").toLowerCase();
  const accept = req.headers.accept ?? "";
  return format === "jsonl" || format === "ndjson" || accept.includes("application/x-ndjson");
}

function sendClipFrames(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  clip: Clip,
  db: Db,
): void {
  const frames = materializeClipFrames(clip, db);
  if (wantJsonl(req, url)) {
    res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
    if (method !== "HEAD") res.write(framesToJsonl(frames));
    res.end();
    return;
  }
  sendJson(res, 200, { frames, clip });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on("data", (c: Buffer) => {
      n += c.length;
      if (n > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function forbiddenRel(rel: string): boolean {
  const n = rel.replace(/\\/g, "/").toLowerCase();
  if (n.includes("node_modules") || n.includes(".git/")) return true;
  const parts = n.split("/");
  if (parts.some((p) => p === ".env" || p.startsWith(".env."))) return true;
  if (n.endsWith(".sqlite") || n.endsWith(".sqlite-journal")) return true;
  return false;
}

function resolveStatic(urlPath: string, root: string): string | null {
  let u = urlPath.split("?")[0] ?? "/";
  try {
    u = decodeURIComponent(u);
  } catch {
    return null;
  }
  if (u === "/" || u === "") return path.join(root, "src/web/index.html");
  if (u === "/film" || u === "/film/") return path.join(root, "src/web/film.html");
  const rel = u.replace(/^\/+/, "");
  if (forbiddenRel(rel)) return null;
  const file = path.resolve(root, rel);
  const base = path.resolve(root);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: Ctx): Promise<void> {
  if (!applyCors(req, res, ctx.port)) return;
  const method = req.method ?? "GET";
  const host = req.headers.host ?? `127.0.0.1:${ctx.port}`;
  const url = new URL(req.url ?? "/", `http://${host}`);

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      llmConfigured: Boolean(ctx.config.xaiApiKey),
      langsmith: ctx.config.langsmithTracing,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/match") {
    sendJson(res, 200, ctx.control.status());
    return;
  }

  if (method === "POST" && url.pathname === "/api/match/start") {
    let raw = "";
    try {
      raw = await readBody(req);
    } catch {
      sendJson(res, 413, { error: "payload too large" });
      return;
    }
    let json: unknown = {};
    if (raw.trim() !== "") {
      try {
        json = JSON.parse(raw);
      } catch {
        sendJson(res, 400, { error: "invalid json" });
        return;
      }
    }
    const parsed = StartMatchBodySchema.safeParse(json);
    if (!parsed.success) {
      sendJson(res, 400, { error: "invalid body", details: parsed.error.flatten() });
      return;
    }
    try {
      const started = ctx.control.start(parsed.data);
      sendJson(res, 200, started);
    } catch (err) {
      if (err instanceof MatchBusyError) {
        sendJson(res, 409, { error: err.message, matchId: err.matchId });
        return;
      }
      if (err instanceof MatchStartError) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      throw err;
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/match/stop") {
    const out = await ctx.control.stop();
    sendJson(res, 200, { ok: true, ...out });
    return;
  }

  if (method === "GET" && url.pathname === "/api/matches") {
    const matches = listMatches(ctx.db).map((row) => {
      const footage = getFootage(ctx.db, row.id);
      return {
        id: row.id,
        home: row.homeTeam,
        away: row.awayTeam,
        seed: row.seed,
        result: row.result,
        score: { home: row.finalHome, away: row.finalAway },
        recorded: Boolean(footage),
        clipCount: footage?.clips.length ?? 0,
      };
    });
    sendJson(res, 200, { matches });
    return;
  }

  if (method === "GET") {
    const eventHit = /^\/api\/footage\/event\/(.+)$/.exec(url.pathname);
    if (eventHit) {
      const eventId = decodeURIComponent(eventHit[1] ?? "");
      const resolved = resolveEventFootage(ctx.db, eventId);
      if (!resolved) {
        sendJson(res, 404, { error: `no event ${eventId}` });
        return;
      }
      sendJson(res, 200, resolved);
      return;
    }

    const framesHit = /^\/api\/footage\/([^/]+)\/clips\/(.+)\/frames$/.exec(url.pathname);
    if (framesHit) {
      const matchId = decodeURIComponent(framesHit[1] ?? "");
      const clipId = decodeURIComponent(framesHit[2] ?? "");
      const clip = resolveClip(ctx.db, matchId, clipId);
      if (!clip) {
        sendJson(res, 404, { error: `no clip ${clipId} for ${matchId}` });
        return;
      }
      sendClipFrames(req, res, url, method, clip, ctx.db);
      return;
    }

    const windowHit = /^\/api\/footage\/([^/]+)\/frames$/.exec(url.pathname);
    if (windowHit) {
      const matchId = decodeURIComponent(windowHit[1] ?? "");
      const recording = getRecording(ctx.db, matchId);
      if (!recording) {
        sendJson(res, 404, { error: `no recording for ${matchId}` });
        return;
      }
      const fromRaw = Number.parseInt(url.searchParams.get("from") ?? "0", 10);
      const toRaw = Number.parseInt(url.searchParams.get("to") ?? String(recording.durationLiveTicks), 10);
      const start = Number.isFinite(fromRaw) ? Math.max(0, fromRaw) : 0;
      const end = Number.isFinite(toRaw) ? Math.min(recording.durationLiveTicks, toRaw) : recording.durationLiveTicks;
      const clip: Clip = {
        id: `${matchId}:clip:window:${start}-${end}`,
        matchId,
        startLiveTick: start,
        endLiveTick: end,
        anchorEventId: `${matchId}:0`,
        relatedEventIds: [],
        kind: "user",
        title: `Ticks ${start}–${end}`,
        source: "user",
      };
      sendClipFrames(req, res, url, method, clip, ctx.db);
      return;
    }

    const footageHit = /^\/api\/footage\/([^/]+)$/.exec(url.pathname);
    if (footageHit) {
      const matchId = decodeURIComponent(footageHit[1] ?? "");
      const footage = getFootage(ctx.db, matchId);
      if (!footage) {
        sendJson(res, 404, { error: `no recording for ${matchId}` });
        return;
      }
      const match = getMatch(ctx.db, matchId);
      sendJson(res, 200, {
        recording: footage.recording,
        clips: footage.clips,
        match: match
          ? {
              id: match.id,
              home: match.homeTeam,
              away: match.awayTeam,
              seed: match.seed,
              result: match.result,
              score: { home: match.finalHome, away: match.finalAway },
            }
          : undefined,
      });
      return;
    }
  }

  if (method !== "GET" && method !== "HEAD") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }

  const file = resolveStatic(url.pathname, ctx.root);
  if (!file) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }
  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": path.extname(file) === ".html" ? "no-store" : "public, max-age=0",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  res.end(buf);
}

export type ListenOpts = {
  env?: EnvMap;
  root?: string;
  db?: Db;
};

export async function listenAndServe(opts: ListenOpts = {}): Promise<Server> {
  const config = loadConfig(opts.env ?? process.env);
  const host = config.httpHost;
  const port = config.httpPort;
  if (!isLoopbackHost(host)) {
    throw new Error(`v1 binds loopback only (got ${host}). Set GRAPH_HOCKEY_HTTP_HOST=127.0.0.1`);
  }
  const root = opts.root ?? REPO_ROOT;
  const db = opts.db ?? (await openDb(defaultDbPath()));
  ensureSeedPlaybooks(db);
  const control = createMatchControl({ db, config, paceMs: DT * 1000 });
  const hub = createWsHub({ port });
  control.subscribe((event) => {
    if (event.type === "start") {
      hub.setRosters(event.rosters);
      hub.broadcastStart({
        matchId: event.matchId,
        home: event.home,
        away: event.away,
        seed: event.seed,
        periodSeconds: event.periodSeconds,
        noLlm: event.noLlm,
      });
    } else if (event.type === "tick") {
      hub.broadcastTick(event.world, event.events, event.budget);
    } else if (event.type === "over") {
      hub.broadcastOver({
        matchId: event.matchId,
        score: event.score,
        result: event.result,
      });
      hub.setRosters(null);
    }
  });

  const server = createServer((req, res) => {
    void handleRequest(req, res, { config, control, port, root, db }).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: "internal" });
    });
  });
  hub.attach(server);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is in use. Set GRAPH_HOCKEY_HTTP_PORT to another free port (default 8787).`,
          ),
        );
        return;
      }
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  const shutdown = () => {
    void control.stop().finally(() => {
      server.close();
      db.close();
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  const origins = corsOrigins(port).join(", ");
  console.log(`Graph_Hockey  http://${host}:${port}/`);
  console.log(`Film Room     http://${host}:${port}/film`);
  console.log(`WebSocket     ws://${host}:${port}/ws`);
  console.log(`CORS/WS origin allowlist: ${origins}`);
  if (config.periodSeconds !== 1200) {
    console.log(`GRAPH_HOCKEY_PERIOD_SECONDS=${config.periodSeconds} (engine default is 1200)`);
  }
  return server;
}

function launchedAsMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const self = path.normalize(fileURLToPath(import.meta.url)).toLowerCase();
  const launched = path.normalize(path.resolve(argv1)).toLowerCase();
  return self === launched;
}

if (launchedAsMain()) {
  listenAndServe().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
