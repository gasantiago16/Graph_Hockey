import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.GRAPH_HOCKEY_HTTP_PORT ?? 8787);
const host = process.env.GRAPH_HOCKEY_HTTP_HOST ?? "127.0.0.1";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

function resolveUrl(urlPath) {
  const u = decodeURIComponent(urlPath.split("?")[0]);
  if (u === "/" || u === "") return path.join(root, "src/web/index.html");
  if (u === "/film" || u === "/film/") return path.join(root, "src/web/film.html");
  const rel = u.replace(/^\/+/, "");
  return path.join(root, rel);
}

const server = http.createServer((req, res) => {
  const origin = `http://${host}:${port}`;
  res.setHeader("Access-Control-Allow-Origin", origin);
  const file = resolveUrl(req.url ?? "/");
  const normalized = path.normalize(file);
  if (!normalized.startsWith(root)) {
    res.writeHead(403); res.end("forbidden"); return;
  }
  fs.readFile(normalized, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(normalized)] ?? "application/octet-stream" });
    res.end(buf);
  });
});

server.listen(port, host, () => {
  console.log(`Graph_Hockey Film Room  http://${host}:${port}/film`);
});
