import { TeamDirectiveSchema, type TeamDirective } from "../types/directive.ts";
import type { MatchEvent } from "../types/events.ts";
import { makeEventId } from "../types/ids.ts";
import type { Period, Side, Vec2, Zone } from "../types/hockey.ts";
import type { Db } from "./db.ts";

/** period INTEGER in schema.sql: 1|2|3, OT stored as 4. */
export const OT_PERIOD_SQL = 4;

export function periodToSql(period: Period): number {
  return period === "OT" ? OT_PERIOD_SQL : period;
}

export function periodFromSql(n: number): Period {
  if (n === OT_PERIOD_SQL) return "OT";
  if (n === 1 || n === 2 || n === 3) return n;
  throw new Error(`invalid period ${n}`);
}

type EventSqlRow = {
  id: string;
  match_id: string;
  seq: number;
  live_tick: number;
  stoppage_seq: number;
  t_period: number;
  period: number;
  type: string;
  payload_json: string;
};

type EventPayloadBlob = {
  zone?: Zone;
  pos?: Vec2;
  possessor?: string | null;
  actor?: string;
  xG?: number;
  playId?: string;
  payload?: unknown;
};

function asInt(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") return Number.parseInt(v, 10);
  throw new Error(`expected integer, got ${typeof v}`);
}

function blobOf(event: MatchEvent): EventPayloadBlob {
  return {
    zone: event.zone,
    pos: event.pos,
    possessor: event.possessor,
    actor: event.actor,
    xG: event.xG,
    playId: event.playId,
    payload: event.payload,
  };
}

function rowToEvent(row: EventSqlRow): MatchEvent {
  const extra = JSON.parse(String(row.payload_json)) as EventPayloadBlob;
  return {
    id: String(row.id),
    seq: asInt(row.seq),
    liveTick: asInt(row.live_tick),
    stoppageSeq: asInt(row.stoppage_seq),
    period: periodFromSql(asInt(row.period)),
    type: String(row.type),
    zone: extra.zone,
    pos: extra.pos,
    possessor: extra.possessor,
    actor: extra.actor,
    xG: extra.xG,
    playId: extra.playId,
    payload: extra.payload,
  };
}

export function insertEvents(
  db: Db,
  matchId: string,
  events: readonly MatchEvent[],
  tPeriod: number = 0,
): void {
  if (events.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO events (
      id, match_id, seq, live_tick, stoppage_seq, t_period, period, type, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const event of events) {
      const expected = makeEventId(matchId, event.seq);
      if (event.id !== expected) {
        throw new Error(`event id ${event.id} !== ${expected}`);
      }
      stmt.run(
        event.id,
        matchId,
        event.seq,
        event.liveTick,
        event.stoppageSeq,
        tPeriod,
        periodToSql(event.period),
        event.type,
        JSON.stringify(blobOf(event)),
      );
    }
  });
}

export function listEvents(db: Db, matchId: string): MatchEvent[] {
  return db
    .prepare("SELECT * FROM events WHERE match_id = ? ORDER BY seq ASC")
    .all<EventSqlRow>(matchId)
    .map(rowToEvent);
}

export function getEvent(db: Db, eventId: string): MatchEvent | undefined {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get<EventSqlRow>(eventId);
  return row ? rowToEvent(row) : undefined;
}

export type DirectivesAtTick = { home?: TeamDirective; away?: TeamDirective };

function directiveFromPayload(payload: unknown): { side: Side; directive: TeamDirective } | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const rec = payload as { side?: unknown; directive?: unknown };
  if (rec.side !== "home" && rec.side !== "away") return undefined;
  const parsed = TeamDirectiveSchema.safeParse(rec.directive);
  if (!parsed.success) return undefined;
  return { side: rec.side, directive: parsed.data };
}

/** Map key `${liveTick}:${stoppageSeq}` → last stored DirectiveApplied per side. */
export function loadDirectivesByTick(db: Db, matchId: string): Map<string, DirectivesAtTick> {
  const map = new Map<string, DirectivesAtTick>();
  for (const event of listEvents(db, matchId)) {
    if (event.type !== "DirectiveApplied") continue;
    const parsed = directiveFromPayload(event.payload);
    if (!parsed) continue;
    const key = `${event.liveTick}:${event.stoppageSeq}`;
    const cur = map.get(key) ?? {};
    cur[parsed.side] = parsed.directive;
    map.set(key, cur);
  }
  return map;
}

export type EpochInvocationRow = {
  matchId: string;
  seq: number;
  side: Side;
  reason: string;
  epochKind?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reasoningTokens?: number | null;
  latencyMs?: number | null;
  ok: boolean;
  billed: boolean;
  directive?: TeamDirective | null;
  coachIntent?: string | null;
};

export function persistEpoch(db: Db, row: EpochInvocationRow): void {
  db.prepare(
    `INSERT INTO epoch_invocations (
      match_id, seq, side, reason, epoch_kind, model,
      prompt_tokens, completion_tokens, reasoning_tokens, latency_ms,
      ok, billed, directive_json, coach_intent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.matchId,
    row.seq,
    row.side,
    row.reason,
    row.epochKind ?? null,
    row.model ?? null,
    row.promptTokens ?? null,
    row.completionTokens ?? null,
    row.reasoningTokens ?? null,
    row.latencyMs ?? null,
    row.ok ? 1 : 0,
    row.billed ? 1 : 0,
    row.directive ? JSON.stringify(row.directive) : null,
    row.coachIntent ?? null,
  );
}

export function listEpochInvocations(db: Db, matchId: string): EpochInvocationRow[] {
  const rows = db
    .prepare("SELECT * FROM epoch_invocations WHERE match_id = ? ORDER BY seq ASC, side ASC")
    .all<Record<string, unknown>>(matchId);
  return rows.map((r) => ({
    matchId: String(r.match_id),
    seq: asInt(r.seq),
    side: r.side === "away" ? "away" : "home",
    reason: String(r.reason),
    epochKind: r.epoch_kind === null || r.epoch_kind === undefined ? null : String(r.epoch_kind),
    model: r.model === null || r.model === undefined ? null : String(r.model),
    promptTokens: r.prompt_tokens === null || r.prompt_tokens === undefined ? null : asInt(r.prompt_tokens),
    completionTokens:
      r.completion_tokens === null || r.completion_tokens === undefined ? null : asInt(r.completion_tokens),
    reasoningTokens:
      r.reasoning_tokens === null || r.reasoning_tokens === undefined ? null : asInt(r.reasoning_tokens),
    latencyMs: r.latency_ms === null || r.latency_ms === undefined ? null : asInt(r.latency_ms),
    ok: asInt(r.ok) === 1,
    billed: asInt(r.billed) === 1,
    directive: r.directive_json ? TeamDirectiveSchema.parse(JSON.parse(String(r.directive_json))) : null,
    coachIntent: r.coach_intent === null || r.coach_intent === undefined ? null : String(r.coach_intent),
  }));
}
