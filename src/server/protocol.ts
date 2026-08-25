import type { MatchEvent } from "../types/events.ts";
import {
  ClientHelloSchema,
  ClientInspectSchema,
  type InspectSide,
  type ServerMessage,
} from "../types/ws.ts";
import { toCostTick, type MatchBudget } from "../llm/budgets.ts";
import type { WorldState } from "../engine/world.ts";
import { maybeInspectState, spectatorFrame, type SpectatorOpts } from "./spectator.ts";

/** Keys that must never appear on the WS wire. */
export const DENYLIST_KEYS = [
  "playbooks",
  "XAI_API_KEY",
  "xaiApiKey",
  "rng",
  "checkpoints",
  "checkpoint",
  "specialistMemos",
  "directives",
] as const;

const TICKER_SKIP = new Set(["DirectiveApplied"]);

export function corsOrigins(port: number): readonly string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/** Missing Origin is allowed (curl / same-origin). Any other Origin must be the rink. */
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined || origin === "") return true;
  return corsOrigins(port).includes(origin);
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (value === null || typeof value !== "object") return acc;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(value)) {
    acc.add(k);
    collectKeys(v, acc);
  }
  return acc;
}

export function denylistHits(value: unknown): string[] {
  const keys = collectKeys(value);
  return DENYLIST_KEYS.filter((k) => keys.has(k));
}

/**
 * Opponent (and, when inspect is `none`, both sides') playId strings must not
 * appear in the JSON. Equal home/away ids are only a leak for `none`.
 */
export function opponentPlayLeak(
  value: unknown,
  inspectSide: InspectSide,
  playId: { home: string; away: string },
): string[] {
  const json = JSON.stringify(value);
  const leaked: string[] = [];
  if (playId.home === playId.away) {
    if (inspectSide === "none" && playId.home && json.includes(playId.home)) leaked.push(playId.home);
    return leaked;
  }
  if (inspectSide !== "home" && playId.home && json.includes(playId.home)) leaked.push(playId.home);
  if (inspectSide !== "away" && playId.away && json.includes(playId.away)) leaked.push(playId.away);
  return leaked;
}

export function parseClientMessage(raw: string): { inspectSide: InspectSide } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const hello = ClientHelloSchema.safeParse(data);
  if (hello.success) return { inspectSide: hello.data.inspectSide };
  const inspect = ClientInspectSchema.safeParse(data);
  if (inspect.success) return { inspectSide: inspect.data.side };
  return null;
}

export type TickMessageOpts = SpectatorOpts & { budget?: MatchBudget };

/** Snapshot + optional inspect + public ticker events + cost. DirectiveApplied is omitted. */
export function tickMessages(
  world: WorldState,
  inspectSide: InspectSide,
  newEvents: MatchEvent[],
  opts: TickMessageOpts = {},
): ServerMessage[] {
  const msgs: ServerMessage[] = [spectatorFrame(world, opts)];
  const inspect = maybeInspectState(world, inspectSide);
  if (inspect) msgs.push(inspect);
  for (const e of newEvents) {
    if (TICKER_SKIP.has(e.type)) continue;
    msgs.push({ type: "event", id: e.id, eventType: e.type, liveTick: e.liveTick });
  }
  msgs.push(opts.budget ? toCostTick(opts.budget) : ZERO_COST);
  return msgs;
}

export function encodeMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}

export const ZERO_COST = {
  type: "cost" as const,
  homeCalls: 0,
  awayCalls: 0,
  promptTokens: 0,
  outputTokens: 0,
  usd: 0,
};
