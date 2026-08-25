import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Roster } from "../types/hockey.ts";
import { DEFAULT_PLAY_ID, type Play, type Playbook } from "../types/play.ts";
import { defaultStructurePlay, parsePlaybook, parseTeam } from "./schema.ts";

const DATA_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../data");

export const SEED_TEAM_IDS = ["original-six", "expansion"] as const;
export type SeedTeamId = (typeof SEED_TEAM_IDS)[number];

export function playbookFile(teamId: string): string {
  return join(DATA_ROOT, "playbooks", `seed-${teamId}.json`);
}

export function teamFile(teamId: string): string {
  return join(DATA_ROOT, "teams", `${teamId}.json`);
}

export function loadPlaybook(teamId: string): Playbook {
  const raw: unknown = JSON.parse(readFileSync(playbookFile(teamId), "utf8"));
  return parsePlaybook(raw);
}

export function loadTeam(teamId: string): Roster {
  const raw: unknown = JSON.parse(readFileSync(teamFile(teamId), "utf8"));
  return parseTeam(raw);
}

let booksByTeam: Map<string, Playbook> | undefined;
let playsById: Map<string, Play> | undefined;

export function seedPlaybooks(): Map<string, Playbook> {
  if (!booksByTeam || !playsById) {
    booksByTeam = new Map();
    playsById = new Map();
    for (const id of SEED_TEAM_IDS) {
      const book = loadPlaybook(id);
      booksByTeam.set(id, book);
      for (const play of book.plays) {
        playsById.set(play.id, play);
      }
    }
  }
  return booksByTeam;
}

export function playById(id: string): Play | undefined {
  if (id === DEFAULT_PLAY_ID) return defaultStructurePlay();
  seedPlaybooks();
  return playsById?.get(id);
}

export function resolvePlay(id: string, book?: Playbook): Play {
  const fromBook = book?.plays.find((p) => p.id === id);
  if (fromBook) return fromBook;
  return playById(id) ?? defaultStructurePlay();
}

/** First active 5v5 seed play, else `default-structure`. original-six → 5v5-122; expansion → 5v5-212. */
export function defaultPlayIdForBook(book: Playbook): string {
  const play = book.plays.find((p) => p.status === "active" && p.strength.includes("5v5"));
  return play?.id ?? DEFAULT_PLAY_ID;
}
