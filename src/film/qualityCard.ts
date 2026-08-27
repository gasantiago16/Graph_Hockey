import { isEvenStrengthPlay } from "../playbook/evenStrength.ts";
import { isEmptyNetPlay, isLeadProtectPlay } from "../playbook/retrieve.ts";
import { defaultPlayIdForBook } from "../playbook/store.ts";
import type { Playbook } from "../types/play.ts";
import type { PlayMixRow } from "./chances.ts";

export type CoadaptFlag = "both-up" | "both-down" | "home-up" | "away-up" | "coadapt";

export type MixShare = {
  even: number;
  total: number;
  pct: number;
};

export type EvenNonDefault = {
  nonDefault: number;
  even: number;
};

export type QualityGameInput = {
  homeChances: number;
  awayChances: number;
  homeOffsides: number;
  awayOffsides: number;
  homeXg: number;
  awayXg: number;
  homeMix: readonly PlayMixRow[];
  awayMix: readonly PlayMixRow[];
};

export type SeriesQualityCard = {
  combinedChanceMean: number;
  homeChanceMean: number;
  awayChanceMean: number;
  offsMax: { home: number; away: number };
  evenShare: { home: MixShare; away: MixShare };
  evenNonDefault: { home: EvenNonDefault; away: EvenNonDefault };
  arms: { homeDxg: number; awayDxg: number };
  flag: CoadaptFlag;
  pairs?: number;
};

function playFromMix(book: Playbook | undefined, playId: string) {
  return book?.plays.find((p) => p.id === playId);
}

export function combinedChanceMean(games: readonly { homeChances: number; awayChances: number }[]): number {
  if (games.length === 0) return 0;
  const sum = games.reduce((s, g) => s + g.homeChances + g.awayChances, 0);
  return sum / games.length;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

export function evenShare(mix: readonly PlayMixRow[], book: Playbook | undefined): MixShare {
  let even = 0;
  let total = 0;
  for (const row of mix) {
    total += row.directives;
    const play = playFromMix(book, row.playId);
    if (play && isEvenStrengthPlay(play)) even += row.directives;
  }
  return { even, total, pct: total === 0 ? 0 : (even / total) * 100 };
}

export function evenNonDefault(mix: readonly PlayMixRow[], book: Playbook | undefined): EvenNonDefault {
  const seed = book ? defaultPlayIdForBook(book) : undefined;
  let even = 0;
  let nonDefault = 0;
  for (const row of mix) {
    const play = playFromMix(book, row.playId);
    if (!play || !isEvenStrengthPlay(play)) continue;
    even += row.directives;
    if (play.id === seed || isLeadProtectPlay(play) || isEmptyNetPlay(play)) continue;
    nonDefault += row.directives;
  }
  return { nonDefault, even };
}

export function offsMax(games: readonly { homeOffsides: number; awayOffsides: number }[]): {
  home: number;
  away: number;
} {
  let home = 0;
  let away = 0;
  for (const g of games) {
    if (g.homeOffsides > home) home = g.homeOffsides;
    if (g.awayOffsides > away) away = g.awayOffsides;
  }
  return { home, away };
}

/** Mutually exclusive. Opposing signs are coadapt (arms race), not a quality fail. */
export function coadaptFlag(homeDxg: number, awayDxg: number): CoadaptFlag {
  if (homeDxg > 0 && awayDxg > 0) return "both-up";
  if (homeDxg < 0 && awayDxg < 0) return "both-down";
  if (homeDxg > 0 && awayDxg < 0) return "coadapt";
  if (awayDxg > 0 && homeDxg < 0) return "coadapt";
  if (homeDxg > 0) return "home-up";
  if (awayDxg > 0) return "away-up";
  return "both-down";
}

export function seriesQualityCard(
  games: readonly QualityGameInput[],
  homeBook: Playbook | undefined,
  awayBook: Playbook | undefined,
  pairs?: number,
): SeriesQualityCard {
  const homeDxg = games.length === 0 ? 0 : games[games.length - 1]!.homeXg - games[0]!.homeXg;
  const awayDxg = games.length === 0 ? 0 : games[games.length - 1]!.awayXg - games[0]!.awayXg;
  const homeMix = games.flatMap((g) => g.homeMix);
  const awayMix = games.flatMap((g) => g.awayMix);
  const card: SeriesQualityCard = {
    combinedChanceMean: combinedChanceMean(games),
    homeChanceMean: mean(games.map((g) => g.homeChances)),
    awayChanceMean: mean(games.map((g) => g.awayChances)),
    offsMax: offsMax(games),
    evenShare: { home: evenShare(homeMix, homeBook), away: evenShare(awayMix, awayBook) },
    evenNonDefault: { home: evenNonDefault(homeMix, homeBook), away: evenNonDefault(awayMix, awayBook) },
    arms: { homeDxg, awayDxg },
    flag: coadaptFlag(homeDxg, awayDxg),
  };
  if (pairs !== undefined) card.pairs = pairs;
  return card;
}

function pct(n: number): string {
  return `${n.toFixed(0)}%`;
}

function dxg(n: number): string {
  const v = n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3);
  return v;
}

export function formatQualityCard(card: SeriesQualityCard): string[] {
  const lines = [
    `quality  combinedChanceMean  ${card.combinedChanceMean.toFixed(2)}  (home μ ${card.homeChanceMean.toFixed(2)}  away μ ${card.awayChanceMean.toFixed(2)})`,
    `         pairs g0,g6  ${card.pairs ?? "?"}`,
    `         evenShare  home ${pct(card.evenShare.home.pct)}  away ${pct(card.evenShare.away.pct)}`,
    `         offs max  home ${card.offsMax.home}  away ${card.offsMax.away}`,
    `arms     homeΔxG  ${dxg(card.arms.homeDxg)}  awayΔxG  ${dxg(card.arms.awayDxg)}`,
    `flag     ${card.flag}`,
    `memory   evenNonDefault  home ${card.evenNonDefault.home.nonDefault}/${card.evenNonDefault.home.even}  away ${card.evenNonDefault.away.nonDefault}/${card.evenNonDefault.away.even}`,
  ];
  return lines;
}
