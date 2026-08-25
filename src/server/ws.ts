import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { WorldState } from "../engine/world.ts";
import type { MatchBudget } from "../llm/budgets.ts";
import type { MatchEvent } from "../types/events.ts";
import type { Roster } from "../types/hockey.ts";
import type { InspectSide, MatchOver, MatchStart, ServerMessage } from "../types/ws.ts";
import { encodeMessage, originAllowed, parseClientMessage, tickMessages, ZERO_COST } from "./protocol.ts";

type Client = {
  ws: WebSocket;
  inspectSide: InspectSide;
};

export type WsHub = {
  attach: (server: HttpServer) => void;
  setRosters: (rosters: { home: Roster; away: Roster } | null) => void;
  broadcastTick: (world: WorldState, events: MatchEvent[], budget?: MatchBudget) => void;
  broadcastStart: (msg: Omit<MatchStart, "type">) => void;
  broadcastOver: (msg: Omit<MatchOver, "type">) => void;
};

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(encodeMessage(msg));
}

function asText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

export function createWsHub(opts: { port: number }): WsHub {
  const clients = new Set<Client>();
  let latest: WorldState | null = null;
  let latestBudget: MatchBudget | undefined;
  let rosters: { home: Roster; away: Roster } | null = null;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64_000 });

  function pushTick(client: Client, world: WorldState, events: MatchEvent[], budget?: MatchBudget): void {
    for (const msg of tickMessages(world, client.inspectSide, events, {
      ...(rosters ? { rosters } : {}),
      budget,
    })) {
      send(client.ws, msg);
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    const client: Client = { ws, inspectSide: "none" };
    clients.add(client);
    if (latest) pushTick(client, latest, [], latestBudget);

    ws.on("message", (data: RawData) => {
      const parsed = parseClientMessage(asText(data));
      if (!parsed) return;
      client.inspectSide = parsed.inspectSide;
      if (latest) pushTick(client, latest, [], latestBudget);
    });

    ws.on("close", () => {
      clients.delete(client);
    });

    ws.on("error", () => {
      clients.delete(client);
    });
  });

  return {
    attach(server) {
      server.on("upgrade", (req: IncomingMessage, socket, head) => {
        if (!originAllowed(req.headers.origin, opts.port)) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        const host = req.headers.host ?? `127.0.0.1:${opts.port}`;
        const url = new URL(req.url ?? "/", `http://${host}`);
        if (url.pathname !== "/ws") {
          socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
      });
    },
    setRosters(next) {
      rosters = next;
    },
    broadcastTick(world, events, budget) {
      latest = world;
      latestBudget = budget;
      for (const client of clients) pushTick(client, world, events, budget);
    },
    broadcastStart(msg) {
      const full: MatchStart = { type: "match_start", ...msg };
      for (const client of clients) {
        send(client.ws, full);
        send(client.ws, ZERO_COST);
      }
    },
    broadcastOver(msg) {
      const full: MatchOver = { type: "match_over", ...msg };
      for (const client of clients) send(client.ws, full);
      latest = null;
      latestBudget = undefined;
    },
  };
}
