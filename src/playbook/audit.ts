import { isEvenStrengthPlay } from "./evenStrength.ts";
import { UNUSED_PLAY_BONUS, isEmptyNetPlay, isLeadProtectPlay, retrieveFallbackId, retrievePlays } from "./retrieve.ts";
import { defaultPlayIdForBook } from "./store.ts";
import type { Playbook } from "../types/play.ts";

export type MemoryAudit = {
  teamId: string;
  version: number;
  seedDefault: string;
  retrieve: { OZ: string[]; NZ: string[]; DZ: string[] };
  leftoverOz: string | undefined;
  unusedEvenNonDefault: string[];
  menuDiffersFromSeed: boolean;
};

function topIds(book: Playbook, zone: "OZ" | "NZ" | "DZ"): string[] {
  return retrievePlays(book, { strength: "5v5", zone }).map((p) => p.id);
}

export function auditPlaybook(book: Playbook): MemoryAudit {
  const seedDefault = defaultPlayIdForBook(book);
  const retrieve = {
    OZ: topIds(book, "OZ"),
    NZ: topIds(book, "NZ"),
    DZ: topIds(book, "DZ"),
  };
  const unusedEvenNonDefault = book.plays
    .filter(
      (p) =>
        p.status === "active" &&
        (p.stats?.games ?? 0) === 0 &&
        isEvenStrengthPlay(p) &&
        p.id !== seedDefault &&
        !isLeadProtectPlay(p) &&
        !isEmptyNetPlay(p),
    )
    .map((p) => p.id)
    .sort();
  return {
    teamId: book.teamId,
    version: book.version,
    seedDefault,
    retrieve,
    leftoverOz: retrieveFallbackId(book, { strength: "5v5", zone: "OZ" }),
    unusedEvenNonDefault,
    menuDiffersFromSeed: retrieve.OZ[0] !== seedDefault,
  };
}

export function formatMemoryAudit(audit: MemoryAudit): string[] {
  return [
    `audit  ${audit.teamId} v${audit.version}  seedDefault ${audit.seedDefault}`,
    `       retrieve OZ ${audit.retrieve.OZ.join(" ") || "(none)"}`,
    `       retrieve NZ ${audit.retrieve.NZ.join(" ") || "(none)"}`,
    `       retrieve DZ ${audit.retrieve.DZ.join(" ") || "(none)"}`,
    `       leftoverOz ${audit.leftoverOz ?? "?"}`,
    `       unusedEvenNonDefault (${UNUSED_PLAY_BONUS} bonus) ${audit.unusedEvenNonDefault.join(" ") || "(none)"}`,
    `       menuDiffersFromSeed ${audit.menuDiffersFromSeed}`,
  ];
}
