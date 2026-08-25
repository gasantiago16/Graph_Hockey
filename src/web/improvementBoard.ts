import type { Clip, MatchAggregates, PairedClip, SeriesGameRow, SeriesImprovement } from "../types/film.ts";

export type CompareGames = { early: number; late: number };

function emptyToUndef(v: string | null): string | undefined {
  if (v === null || v === "") return undefined;
  return v;
}

export function parseCompareParam(raw: string | null | undefined): CompareGames | undefined {
  if (raw === null || raw === undefined || raw.trim() === "") return undefined;
  const m = /^(\d+)\s*,\s*(\d+)$/.exec(raw.trim());
  if (!m) return undefined;
  return { early: Number.parseInt(m[1]!, 10), late: Number.parseInt(m[2]!, 10) };
}

export function parseSeriesFilmLocation(
  pathname: string,
  search: string,
): { seriesId?: string; compare?: CompareGames } {
  const path = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  const seriesPath = /^\/film\/series\/([^/]+)$/.exec(path);
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fromQuery = emptyToUndef(q.get("series"));
  const fromPath = seriesPath ? decodeURIComponent(seriesPath[1] ?? "") : undefined;
  const seriesId = fromPath || fromQuery;
  return {
    seriesId: seriesId || undefined,
    compare: parseCompareParam(q.get("compare")),
  };
}

export function seriesFilmHref(seriesId: string, compare?: CompareGames): string {
  const q = new URLSearchParams();
  q.set("series", seriesId);
  if (compare) q.set("compare", `${compare.early},${compare.late}`);
  return `/film?${q.toString()}`;
}

/** DESIGN §16c: dual-rink labels `G{early} {playName}` vs `G{late} {playName}`. */
export function pairRinkLabels(pair: PairedClip): { early: string; late: string } {
  const play = pair.playId || pair.early.playId || pair.early.title;
  const e = pair.early.gameIndex ?? 0;
  const l = pair.late.gameIndex ?? 0;
  return { early: `G${e} ${play}`, late: `G${l} ${play}` };
}

export function pairButtonLabel(pair: PairedClip): { title: string; hint: string } {
  return {
    title: `${pair.playId} · ${pair.zone}`,
    hint: `G${pair.early.gameIndex ?? 0} ${pair.early.kind} → G${pair.late.gameIndex ?? 0} ${pair.late.kind} · ${pair.metricHint}`,
  };
}

export function defaultCompareGames(gameCount: number): CompareGames | undefined {
  if (gameCount < 2) return undefined;
  return { early: 0, late: gameCount - 1 };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function signedSpan(n: number, invert = false): string {
  const v = invert ? -n : n;
  const cls = v > 0.0001 ? "up" : v < -0.0001 ? "down" : "";
  const s = n > 0 ? `+${n}` : `${n}`;
  return `<span class="${cls}">${escapeHtml(s)}</span>`;
}

export function renderDeltasHtml(
  improvement: SeriesImprovement,
  team: "home" | "away",
  teamName: string,
): string {
  const games = improvement.games;
  const first = games[0];
  const last = games[games.length - 1];
  if (!first || !last) {
    return `<p class="sub">No games in this series yet.</p>`;
  }
  const d = improvement.deltas[team];
  const fromG = first.gameIndex;
  const toG = last.gameIndex;
  const fromPb = first.playbookVersion[team];
  const toPb = last.playbookVersion[team];
  return `
      <p style="margin:0 0 8px"><b>${escapeHtml(teamName)} · G${fromG} → G${toG}</b></p>
      <div>xG for ${signedSpan(d.xgFor ?? 0)}</div>
      <div>xG against ${signedSpan(d.xgAgainst ?? 0, true)}</div>
      <div>Goals ${signedSpan(d.goalsFor ?? 0)} / ${signedSpan(d.goalsAgainst ?? 0, true)}</div>
      <div>CF% ${signedSpan(d.cfPct ?? 0)}</div>
      <div>OZ time ${signedSpan(d.zoneTimeOZ ?? 0)}</div>
      <div>Playbook v${fromPb} → v${toPb}</div>`;
}

export function renderSeriesTableHtml(games: readonly SeriesGameRow[], team: "home" | "away"): string {
  const rows = games
    .map((g) => {
      const h = g.aggregates[team];
      return `<tr>
            <td>G${g.gameIndex}</td>
            <td>${g.score.home}–${g.score.away}</td>
            <td>${h.xgFor.toFixed(1)}</td>
            <td>${h.xgAgainst.toFixed(1)}</td>
            <td>${h.cfPct.toFixed(1)}</td>
            <td>${h.goalsFor}</td>
            <td>v${g.playbookVersion[team]}</td>
            <td>${escapeHtml(g.result[team])}</td>
          </tr>`;
    })
    .join("");
  return `
      <table>
        <tr><th>G</th><th>Score</th><th>xGF</th><th>xGA</th><th>CF%</th><th>Gls</th><th>PB</th><th></th></tr>
        ${rows}
      </table>`;
}

export function renderPairsHtml(pairs: readonly PairedClip[]): string {
  if (pairs.length === 0) {
    return `<p class="sub">No paired clips yet (need the same play + zone, Jaccard ≥ 0.3).</p>`;
  }
  return pairs
    .map((p, i) => {
      const lab = pairButtonLabel(p);
      return `<button class="chip pair" type="button" data-pair="${i}">${escapeHtml(lab.title)}<br><small>${escapeHtml(lab.hint)}</small></button>`;
    })
    .join("");
}

export type BoardChartKey = keyof Pick<
  MatchAggregates,
  "xgFor" | "xgAgainst" | "cfPct" | "zoneTimeOZ" | "goalsFor"
>;

export function chartSeries(
  games: readonly SeriesGameRow[],
  team: "home" | "away",
  key: BoardChartKey,
): number[] {
  return games.map((g) => g.aggregates[team][key]);
}

export function playbookSeries(games: readonly SeriesGameRow[], team: "home" | "away"): number[] {
  return games.map((g) => g.playbookVersion[team]);
}

export function fullGameClipStub(
  matchId: string,
  gameIndex: number,
  durationLiveTicks: number,
): Pick<Clip, "id" | "matchId" | "gameIndex" | "startLiveTick" | "endLiveTick" | "kind" | "title" | "source"> {
  return {
    id: `${matchId}:clip:full`,
    matchId,
    gameIndex,
    startLiveTick: 0,
    endLiveTick: durationLiveTicks,
    kind: "user",
    title: "Full recording",
    source: "user",
  };
}
