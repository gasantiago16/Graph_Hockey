/**
 * One-shot: stitch a recorded series into a single MP4 with coach HUD,
 * plus a markdown play-by-play of stored CoachIntent (not hidden CoT).
 *
 *   npx tsx scripts/make-watch-reel.ts --db data/ser-watch-reel.sqlite --series ser-watch-reel
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { openDb } from "../src/persist/db.ts";
import { getAarReport, listMatches } from "../src/persist/matches.ts";
import { listEpochInvocations, listEvents, type EpochInvocationRow } from "../src/persist/events.ts";
import { replaySteps } from "../src/sim/replay.ts";
import { spectatorFrame } from "../src/server/spectator.ts";
import { resolvePlay } from "../src/playbook/store.ts";
import {
  drawSpectatorFrame,
  drawTitleCard,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
  formatClock,
} from "../src/film/drawFrame.ts";
import { encodeRgbaStreamToMp4, EXPORT_FPS, findFfmpeg } from "../src/film/exportMp4.ts";
import type { MatchEvent } from "../src/types/events.ts";
import type { AarReport } from "../src/types/aar.ts";
import type { Side } from "../src/types/hockey.ts";
import type { WorldState } from "../src/engine/world.ts";

const TITLE_FRAMES = 30;
const CARD_FRAMES = 90;
const FALLBACK_THOUGHT = "occupy ice, pass to a teammate in a scoring spot, attack the net";
const ICE_EVENTS = new Set([
  "Goal",
  "Shot",
  "Save",
  "Block",
  "Rebound",
  "Offside",
  "Icing",
  "Penalty",
  "Turnover",
  "ZoneEntry",
  "FaceoffWin",
  "PeriodEnd",
  "GoaliePull",
]);

/** Narrative cards from the series recap — burned onto the reel. */
const SERIES_INTRO = [
  "original-six (xAI grok-4.5)  vs  expansion (Muse Glimmer 30B)",
  "7 games · 3×20s · seed 42 · live benches, not --no-llm",
  "",
  "Comments on this reel are stored CoachIntent, not hidden chain-of-thought.",
  "Glimmer ran with reasoning off. Most Glimmer coach calls timed out inside 8s",
  "and assemble skated a code fallback — that is not Glimmer thinking.",
  "xAI finished ~40 live macros. Those lines are quoted in gold.",
];

const GAME_CARDS: { headline: string; lines: string[] }[] = [
  {
    headline: "Game 0  ·  3–4 OT  ·  away",
    lines: [
      "Opening: xAI skates 1-2-2 dump-and-chase. Glimmer leftover NZ stretch pass.",
      "Away gets a flurry of DZ shots in P1 (one at xG 0.293).",
      "xAI (billed): “support-below-the-puck then pass to the slot/backdoor” → D-to-winger breakout.",
      "xAI (billed): “enter OZ with possession then pass to the slot/backdoor” → 122.",
      "Penalty: xAI goes PP1 umbrella and they score 0.071. Glimmer never bills a new thought.",
      "OT: xAI 3v3 2-1 spread. Away still hunts 212 / stretch and wins OT at t50 (xG 0.091).",
    ],
  },
  {
    headline: "Game 1  ·  1–3  ·  away",
    lines: [
      "Away jumps out on a 0.199 xG DZ goal.",
      "xAI answers with the breakout thought, then a real change of mind:",
      "“cycle low” → OZ low cycle (shotPolicy cycle) after a PP look.",
      "P3 open: “pass to the slot/backdoor” → back to 122.",
      "Glimmer stays on 212 / stretch leftovers. Away takes it 3–1.",
    ],
  },
  {
    headline: "Game 2  ·  3–3  ·  tie",
    lines: [
      "Highest-event game of the series — six goals.",
      "xAI’s live calls get stuck on PK1 box with “support-below-the-puck”:",
      "grok talking even-strength language while the strength is a kill.",
      "After a 0.052 goal: “breakout D-to-winger enter OZ with possession then pass to the slot/backdoor.”",
      "They trade goals through P3 and leave it tied.",
    ],
  },
  {
    headline: "Game 3  ·  1–0  ·  home",
    lines: [
      "Quiet ice, one goal.",
      "xAI’s billed macros are almost all PP1 umbrella:",
      "“pass to the slot/backdoor” / “enter OZ with possession and pass to the slot/backdoor.”",
      "P3 t135, 0.071 xG — that’s the game.",
    ],
  },
  {
    headline: "Game 4  ·  3–1  ·  home",
    lines: [
      "xAI doubles down on the power play.",
      "“controlled NZ-to-OZ entry with possession then pass to the slot/backdoor” → PP1 umbrella.",
      "After the 0.106 OZ goal, still “pass to the slot/backdoor” on the umbrella.",
      "Home 3–1. First game home actually wins a fight.",
    ],
  },
  {
    headline: "Game 5  ·  1–3  ·  away",
    lines: [
      "Away punches a 0.299 xG DZ goal.",
      "xAI after it: “support-below-the-puck then pass to winger and enter OZ with possession",
      "for slot/backdoor feed” → D-to-winger breakout. Not enough. Away 3–1.",
    ],
  },
  {
    headline: "Game 6  ·  0–2  ·  away",
    lines: [
      "Home is blanked.",
      "xAI still bills aggressive pass/cycle thoughts (breakout, cycle, slot/backdoor).",
      "Glimmer leftovers skate 212 / crash-net. Two DZ goals against, 0–2.",
      "Books finish v8 / v8. Combined chance mean for the series: 10.00.",
    ],
  },
];

type CoachThought = {
  playId: string;
  playName: string;
  supposed?: string;
  pressure?: string;
  shotPolicy?: string;
  ok: boolean;
  billed: boolean;
  live: boolean;
  reason: string;
  kind: string;
  model: string;
  tokens: string;
  promptTokens: number;
};

type FeaturedCaption = {
  kicker: string;
  body: string;
  color: string;
  hold: number;
};

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function wrap(text: string, width: number, maxLines = 3): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function isLiveThought(t: CoachThought): boolean {
  if (!t.ok || t.promptTokens <= 0) return false;
  if (!t.supposed) return false;
  return t.supposed.trim() !== FALLBACK_THOUGHT;
}

function commentForThought(side: Side, t: CoachThought): FeaturedCaption {
  const who = side === "home" ? "xAI" : "Glimmer";
  const color = side === "home" ? "#f0c040" : "#7eb6e0";
  if (isLiveThought(t)) {
    return {
      kicker: `${who} thought`,
      body: `“${t.supposed}”  →  ${t.playName}`,
      color,
      hold: 50,
    };
  }
  if (t.kind === "micro") {
    return {
      kicker: `${who} micro · no coach`,
      body: `Assemble only. Skating ${t.playName}. Micros do not think.`,
      color: "#8aa0b5",
      hold: 25,
    };
  }
  return {
    kicker: `${who} fallback · not a new thought`,
    body: `Coach did not finish a billed CoachIntent. Ice skates leftover ${t.playName}.`,
    color: "#8aa0b5",
    hold: 35,
  };
}

function parseIntent(raw: string | null | undefined): {
  supposedToHappen?: string;
  playId?: string;
  pressure?: string;
  shotPolicy?: string;
} {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      supposedToHappen: typeof parsed.supposedToHappen === "string" ? parsed.supposedToHappen : undefined,
      playId: typeof parsed.playId === "string" ? parsed.playId : undefined,
      pressure: typeof parsed.pressure === "string" ? parsed.pressure : undefined,
      shotPolicy: typeof parsed.shotPolicy === "string" ? parsed.shotPolicy : undefined,
    };
  } catch {
    return { supposedToHappen: raw };
  }
}

function thoughtFromEpoch(row: EpochInvocationRow, world?: WorldState): CoachThought {
  const intent = parseIntent(row.coachIntent);
  const playId = row.directive?.playId ?? intent.playId ?? "?";
  const book = world?.playbooks?.[row.side];
  const playName = resolvePlay(playId, book).name;
  const promptTokens = row.promptTokens ?? 0;
  const tok =
    row.promptTokens != null
      ? `${row.promptTokens}+${row.completionTokens ?? 0} tok${row.reasoningTokens ? ` r${row.reasoningTokens}` : ""}`
      : "no tokens";
  const t: CoachThought = {
    playId,
    playName,
    supposed: intent.supposedToHappen,
    pressure: (row.directive?.pressure ?? intent.pressure) as string | undefined,
    shotPolicy: intent.shotPolicy,
    ok: row.ok,
    billed: row.billed,
    live: false,
    reason: row.reason,
    kind: row.epochKind ?? "macro",
    model: row.model ?? "?",
    tokens: tok,
    promptTokens,
  };
  t.live = isLiveThought(t);
  return t;
}

function aarOf(body: unknown): AarReport | undefined {
  if (!body || typeof body !== "object") return undefined;
  return body as AarReport;
}

type DrawCtx = ReturnType<ReturnType<typeof createCanvas>["getContext"]>;

function drawCommentCard(ctx: DrawCtx, headline: string, lines: string[]): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#d4a017";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(headline, 64, 88);
  ctx.fillStyle = "#e8eef4";
  ctx.font = "22px sans-serif";
  let y = 140;
  for (const raw of lines) {
    if (raw === "") {
      y += 16;
      continue;
    }
    const wrapped = wrap(raw, 88, 4);
    for (const line of wrapped) {
      ctx.fillText(line, 64, y);
      y += 32;
    }
    y += 8;
  }
}

function drawHud(
  ctx: DrawCtx,
  args: {
    gameLabel: string;
    home: CoachThought | undefined;
    away: CoachThought | undefined;
    ticker: string;
    featured: FeaturedCaption | undefined;
  },
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const barH = 220;
  ctx.fillStyle = "rgba(7,11,18,0.92)";
  ctx.fillRect(0, H - barH, W, barH);

  ctx.fillStyle = "#d4a017";
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("COMMENTARY", 20, H - barH + 22);
  ctx.fillStyle = "#8aa0b5";
  ctx.font = "15px sans-serif";
  ctx.fillText(args.gameLabel, 160, H - barH + 22);
  ctx.fillStyle = "#c5d4e0";
  ctx.fillText(args.ticker, 20, H - barH + 44);

  if (args.featured) {
    ctx.fillStyle = "rgba(20, 18, 8, 0.95)";
    ctx.fillRect(16, H - barH + 54, W - 32, 64);
    ctx.fillStyle = args.featured.color;
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(args.featured.kicker, 28, H - barH + 76);
    ctx.fillStyle = "#f4f7fa";
    ctx.font = "20px sans-serif";
    const bodyLines = wrap(args.featured.body, 92, 2);
    let y = H - barH + 100;
    for (const line of bodyLines) {
      ctx.fillText(line, 28, y);
      y += 22;
    }
  }

  const col = (x: number, label: string, color: string, t: CoachThought | undefined) => {
    ctx.fillStyle = color;
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(label, x, H - 52);
    if (!t) {
      ctx.fillStyle = "#8aa0b5";
      ctx.font = "14px sans-serif";
      ctx.fillText("waiting for first epoch", x, H - 30);
      return;
    }
    const tag = t.live ? "LIVE THOUGHT" : t.kind === "micro" ? "micro assemble" : "fallback";
    ctx.fillStyle = "#e8eef4";
    ctx.font = "14px sans-serif";
    ctx.fillText(`${tag}  ·  ${t.playName}`, x, H - 30);
  };
  col(20, "HOME  xAI grok-4.5", "#c8102e", args.home);
  col(W / 2 + 10, "AWAY  Muse Glimmer 30B", "#2e6da4", args.away);
}

function clockLabel(ev: MatchEvent): string {
  const p = ev.period === "OT" ? "OT" : `P${ev.period}`;
  return `${p} t${ev.liveTick}`;
}

function iceLine(ev: MatchEvent): string | undefined {
  if (!ICE_EVENTS.has(ev.type)) return undefined;
  const xg = ev.xG != null ? `  xG ${ev.xG.toFixed(3)}` : "";
  const zone = ev.zone ? ` ${ev.zone}` : "";
  const play = ev.playId ? `  play ${ev.playId}` : "";
  return `${clockLabel(ev)}  ${ev.type}${zone}${xg}${play}`;
}

function buildPlayByPlay(opts: {
  seriesId: string;
  matches: { id: string; homeTeam: string; awayTeam: string; finalHome: number | null; finalAway: number | null; result: string | null }[];
  games: {
    matchId: string;
    events: MatchEvent[];
    epochs: EpochInvocationRow[];
    homeAar?: AarReport;
    awayAar?: AarReport;
  }[];
}): string {
  const lines: string[] = [];
  lines.push(`# ${opts.seriesId} — play-by-play`);
  lines.push("");
  lines.push("Home **original-six** is xAI `grok-4.5`. Away **expansion** is local Muse Glimmer 30B.");
  lines.push("What the models *think* here is the stored **CoachIntent** (`supposedToHappen`, play, pressure, shot policy).");
  lines.push("Glimmer was served with reasoning off; xAI reasoning tokens are counted, not stored as text.");
  lines.push("If an epoch is **timeout leftover**, the bench did not finish in 8s and the ice skated retrieve leftover — that is not a new thought.");
  lines.push("");
  for (let i = 0; i < opts.games.length; i++) {
    const g = opts.games[i]!;
    const meta = opts.matches[i];
    const score = `${meta?.finalHome ?? "?"}–${meta?.finalAway ?? "?"}`;
    lines.push(`## Game ${i}  ${score}  (${meta?.result ?? "?"})  \`${g.matchId}\``);
    lines.push("");
    const homeXg = g.homeAar?.aggregates?.xgFor;
    const awayXg = g.awayAar?.aggregates?.xgFor;
    if (homeXg != null || awayXg != null) {
      lines.push(`xG  home ${homeXg?.toFixed(3) ?? "?"}  away ${awayXg?.toFixed(3) ?? "?"}`);
      lines.push("");
    }
    const bySide: Record<Side, EpochInvocationRow[]> = { home: [], away: [] };
    for (const e of g.epochs) bySide[e.side].push(e);
    const cursor: Record<Side, number> = { home: 0, away: 0 };
    for (const ev of g.events) {
      if (ev.type === "DirectiveApplied") {
        const rec = ev.payload as { side?: Side } | undefined;
        const side: Side = rec?.side === "away" ? "away" : "home";
        const row = bySide[side][cursor[side]++];
        if (!row) continue;
        const t = thoughtFromEpoch(row);
        const who = side === "home" ? "HOME xAI" : "AWAY Glimmer";
        const status = t.ok ? "called" : t.billed ? "TIMEOUT leftover" : "no-call leftover";
        lines.push(`- **${clockLabel(ev)} ${who}** ${t.kind}/${t.reason} · ${status} · \`${t.playId}\` ${t.playName}`);
        if (t.ok && t.supposed) lines.push(`  - thought: ${t.supposed}`);
        else if (!t.ok) lines.push(`  - thought: none (8s epoch timeout). Ice keeps leftover \`${t.playId}\`.`);
        if (t.pressure || t.shotPolicy) {
          lines.push(`  - pressure ${t.pressure ?? "—"} · shotPolicy ${t.shotPolicy ?? "—"} · ${t.tokens}`);
        }
        continue;
      }
      const ice = iceLine(ev);
      if (ice) lines.push(`- ${ice}`);
    }
    lines.push("");
    if (g.homeAar?.intentSummary) {
      lines.push("**Home AAR (code digest of stored intents)**");
      lines.push("");
      lines.push("```");
      lines.push(g.homeAar.intentSummary);
      lines.push("```");
      lines.push("");
    }
    if (g.awayAar?.intentSummary) {
      lines.push("**Away AAR (code digest of stored intents)**");
      lines.push("");
      lines.push("```");
      lines.push(g.awayAar.intentSummary);
      lines.push("```");
      lines.push("");
    }
    const homeRev = g.homeAar?.revision?.summary;
    const awayRev = g.awayAar?.revision?.summary;
    if (homeRev) lines.push(`Home book write: ${homeRev}`);
    if (awayRev) lines.push(`Away book write: ${awayRev}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const dbPath = arg("--db", "data/ser-watch-reel.sqlite")!;
  const seriesId = arg("--series", "ser-watch-reel")!;
  const outMp4 = arg("--out", join("data", "film-export", `${seriesId}.mp4`))!;
  const outMd = arg("--md", join("data", "film-export", `${seriesId}-playbyplay.md`))!;
  const ffmpegBin =
    arg("--ffmpeg") ??
    process.env.FFMPEG_PATH ??
    findFfmpeg() ??
    "ffmpeg";

  const db = await openDb(dbPath);
  try {
    const matches = listMatches(db).filter((m) => m.id.startsWith(`${seriesId}-g`));
    if (matches.length === 0) throw new Error(`no matches for ${seriesId} in ${dbPath}`);
    const unfinished = matches.filter((m) => m.result == null);
    if (unfinished.length > 0) {
      throw new Error(`series not finished (${unfinished.map((m) => m.id).join(", ")} still open)`);
    }

    const games = matches.map((m) => ({
      matchId: m.id,
      events: listEvents(db, m.id),
      epochs: listEpochInvocations(db, m.id),
      homeAar: aarOf(getAarReport(db, m.id, "home")?.body),
      awayAar: aarOf(getAarReport(db, m.id, "away")?.body),
    }));

    mkdirSync(dirname(outMd), { recursive: true });
    const md = buildPlayByPlay({ seriesId, matches, games });
    writeFileSync(outMd, md, "utf8");
    console.log(`playbyplay ${outMd}`);

    const canvas = createCanvas(EXPORT_WIDTH, EXPORT_HEIGHT);
    const ctx = canvas.getContext("2d");

    async function* rgba() {
      const holdCard = function* (headline: string, lines: string[], frames: number) {
        drawCommentCard(ctx, headline, lines);
        for (let i = 0; i < frames; i++) {
          yield new Uint8Array(ctx.getImageData(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT).data);
        }
      };

      yield* holdCard("ser-watch-reel  ·  commentary on the ice", SERIES_INTRO, CARD_FRAMES);

      for (let gi = 0; gi < matches.length; gi++) {
        const match = matches[gi]!;
        const game = games[gi]!;
        const card = GAME_CARDS[gi] ?? {
          headline: `Game ${gi}  ·  ${match.finalHome ?? 0}–${match.finalAway ?? 0}`,
          lines: [`${match.homeTeam} vs ${match.awayTeam}`],
        };
        yield* holdCard(card.headline, card.lines, CARD_FRAMES);
        drawTitleCard(ctx, "Drop the puck", `${match.homeTeam} vs ${match.awayTeam}`);
        for (let i = 0; i < TITLE_FRAMES; i++) {
          yield new Uint8Array(ctx.getImageData(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT).data);
        }

        const bySide: Record<Side, EpochInvocationRow[]> = { home: [], away: [] };
        for (const e of game.epochs) bySide[e.side].push(e);
        const cursor: Record<Side, number> = { home: 0, away: 0 };
        let homeT: CoachThought | undefined;
        let awayT: CoachThought | undefined;
        let ticker = "opening faceoff";
        let featured: FeaturedCaption | undefined;

        for (const step of replaySteps(match.id, db)) {
          const world = step.world;
          for (const ev of step.events) {
            if (ev.type === "DirectiveApplied") {
              const rec = ev.payload as { side?: Side } | undefined;
              const side: Side = rec?.side === "away" ? "away" : "home";
              const row = bySide[side][cursor[side]++];
              if (row) {
                const t = thoughtFromEpoch(row, world);
                if (side === "home") homeT = t;
                else awayT = t;
                ticker = `${side === "home" ? "xAI" : "Glimmer"} ${t.live ? "thought" : t.kind}  ${t.playName}`;
                const next = commentForThought(side, t);
                if (t.live || !featured || featured.hold <= 0) featured = next;
              }
            } else if (ev.type === "Goal") {
              const xg = ev.xG != null ? `xG ${ev.xG.toFixed(3)}` : "goal";
              ticker = iceLine(ev) ?? "Goal";
              featured = {
                kicker: `GOAL  ${world.score.home} – ${world.score.away}`,
                body: `${clockLabel(ev)}  ${xg}  ${ev.zone ?? ""}  while xAI skates ${homeT?.playName ?? "?"} and Glimmer skates ${awayT?.playName ?? "?"}`,
                color: "#f4f7fa",
                hold: 60,
              };
            } else if (ev.type === "Penalty" || ev.type === "Offside") {
              ticker = iceLine(ev) ?? ev.type;
              if (!featured || featured.hold <= 0) {
                featured = {
                  kicker: ev.type,
                  body: `${clockLabel(ev)}  ${ev.zone ?? ""}  home ${homeT?.playName ?? "?"} · away ${awayT?.playName ?? "?"}`,
                  color: "#e85d5d",
                  hold: 40,
                };
              }
            } else if (ICE_EVENTS.has(ev.type)) {
              ticker = iceLine(ev) ?? ev.type;
            }
          }
          const frame = spectatorFrame(world);
          const period = frame.period === "OT" ? "OT" : `P${frame.period}`;
          const title = `G${gi}/${matches.length - 1}  ${period}  ${formatClock(frame.clockRemaining)}    ${frame.score.home} – ${frame.score.away}    ${frame.strength}  ${frame.phase}`;
          drawSpectatorFrame(ctx, frame, title);
          drawHud(ctx, {
            gameLabel: `${match.homeTeam} vs ${match.awayTeam}  ·  ${match.id}`,
            home: homeT,
            away: awayT,
            ticker,
            featured,
          });
          if (featured) {
            featured.hold -= 1;
            if (featured.hold < 0) featured.hold = 0;
          }
          yield new Uint8Array(ctx.getImageData(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT).data);
        }
      }

      yield* holdCard("Series  ·  original-six vs expansion", [
        "Away 4  ·  home 2  ·  1 tie. Combined chance mean 10.00. Books v1 → v8.",
        "Gold captions = billed xAI CoachIntent. Grey = leftover / micro / Glimmer fallback.",
        "Glimmer almost never finished a new thought in 8s. The ice still skated 212 and stretch-pass.",
        "Full log: data/film-export/ser-watch-reel-playbyplay.md",
      ], CARD_FRAMES);
    }

    await encodeRgbaStreamToMp4(rgba(), outMp4, ffmpegBin);
    console.log(`mp4 ${outMp4}  fps=${EXPORT_FPS}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
