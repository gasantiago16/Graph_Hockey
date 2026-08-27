import { DEFAULT_PLAY_ID, type Play, type Playbook } from "../types/play.ts";
import type { Side } from "../types/hockey.ts";

export function isEvenStrengthPlay(play: Pick<Play, "strength">): boolean {
  return play.strength.includes("5v5") || play.strength.includes("3v3");
}

function playById(book: Playbook, playId: string | undefined): Play | undefined {
  if (!playId || playId === DEFAULT_PLAY_ID) return undefined;
  return book.plays.find((p) => p.id === playId);
}

function payloadRecord(payload: unknown): Record<string, unknown> | undefined {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
}

function directivePlayId(event: { type: string; payload?: unknown }): string | undefined {
  if (event.type !== "DirectiveApplied") return undefined;
  const rec = payloadRecord(event.payload);
  const dir = rec?.directive;
  if (!dir || typeof dir !== "object" || !("playId" in dir)) return undefined;
  const playId = (dir as { playId: unknown }).playId;
  return typeof playId === "string" ? playId : undefined;
}

/** 0-second leftover 5v5 still counts. `default-structure` is not aliased to 122. */
export function evenStrengthOnIce(opts: {
  book: Playbook;
  side?: Side;
  playUsage?: readonly { playId: string }[];
  events?: readonly { type: string; payload?: unknown }[];
}): boolean {
  for (const row of opts.playUsage ?? []) {
    const play = playById(opts.book, row.playId);
    if (play && isEvenStrengthPlay(play)) return true;
  }
  if (opts.side === undefined) return false;
  for (const event of opts.events ?? []) {
    const rec = payloadRecord(event.payload);
    if (rec?.side !== opts.side) continue;
    const play = playById(opts.book, directivePlayId(event));
    if (play && isEvenStrengthPlay(play)) return true;
  }
  return false;
}
