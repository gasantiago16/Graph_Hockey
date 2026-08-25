import type { Db } from "../../persist/db.ts";
import { listEpochInvocations, listEvents } from "../../persist/events.ts";
import type { MatchEvent } from "../../types/events.ts";
import type { AarGraphNode, AarGraphStateType } from "../state.ts";
import { annotateEvents, buildEventDigest } from "./actual.ts";

export type LoadMatchOpts = {
  db?: Db;
};

export function eventsFromState(state: AarGraphStateType, db: Db | undefined): MatchEvent[] {
  if (db) {
    const fromDb = listEvents(db, state.matchId);
    if (fromDb.length > 0) return fromDb;
  }
  return state.events ?? [];
}

/** SQL + JSON digest: last 80 high-value events. Aggregates belong in `actual`. */
export function makeLoadMatch(opts: LoadMatchOpts = {}): AarGraphNode {
  return (state) => {
    const events = eventsFromState(state, opts.db);
    const annotated = annotateEvents(events, state.side);
    const digest = buildEventDigest(state.matchId, annotated);
    const epochs = opts.db
      ? listEpochInvocations(opts.db, state.matchId).filter((e) => e.side === state.side)
      : (state.epochs ?? []);
    return {
      events,
      epochs,
      eventLogDigest: digest,
      knownEventIds: events.map((e) => e.id),
    };
  };
}
