import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { Db } from "../persist/db.ts";
import { getFootage } from "../persist/clips.ts";
import { getMatch } from "../persist/matches.ts";
import { CLIP_PRIORITY, type Clip } from "../types/film.ts";
import type { SpectatorFrame } from "../types/ws.ts";
import {
  drawSpectatorFrame,
  drawTitleCard,
  EXPORT_HEIGHT,
  EXPORT_WIDTH,
} from "./drawFrame.ts";
import { framesForClip, framesForFullMatch } from "./frames.ts";

export const EXPORT_FPS = 10;
export const TITLE_FRAMES = 10;

export function defaultExportDir(root = process.cwd()): string {
  return join(root, "data", "film-export");
}

export function defaultExportPath(matchId: string, kind: "highlight" | "full" | "clip", root = process.cwd()): string {
  return join(defaultExportDir(root), `${matchId}-${kind}.mp4`);
}

export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pinned = env.FFMPEG_PATH?.trim();
  if (pinned) return pinned;
  return "ffmpeg";
}

export function sortHighlightClips(clips: readonly Clip[]): Clip[] {
  const rank = new Map(CLIP_PRIORITY.map((k, i) => [k, i]));
  return [...clips].sort((a, b) => {
    const ra = rank.get(a.kind) ?? 99;
    const rb = rank.get(b.kind) ?? 99;
    if (ra !== rb) return ra - rb;
    return a.startLiveTick - b.startLiveTick;
  });
}

function highlightTitle(db: Db, matchId: string): { line1: string; line2: string } {
  const match = getMatch(db, matchId);
  const home = match?.homeTeam ?? "home";
  const away = match?.awayTeam ?? "away";
  const hs = match?.finalHome ?? 0;
  const as = match?.finalAway ?? 0;
  return {
    line1: `${home}  ${hs} – ${as}  ${away}`,
    line2: matchId,
  };
}

export function collectExportFrames(
  db: Db,
  matchId: string,
  opts: { clipId?: string; full?: boolean } = {},
): SpectatorFrame[] {
  const footage = getFootage(db, matchId);
  if (!footage) throw new Error(`no recording for ${matchId}`);
  if (opts.full) return [...framesForFullMatch(matchId, db)];
  if (opts.clipId) {
    const clip = footage.clips.find((c) => c.id === opts.clipId);
    if (!clip) throw new Error(`no clip ${opts.clipId}`);
    return [...framesForClip(clip, db)];
  }
  const ordered = sortHighlightClips(footage.clips);
  const frames: SpectatorFrame[] = [];
  for (const clip of ordered) {
    frames.push(...framesForClip(clip, db));
  }
  if (frames.length === 0) return [...framesForFullMatch(matchId, db)];
  return frames;
}

async function writeRgba(
  stdin: NodeJS.WritableStream,
  data: Uint8Array,
): Promise<void> {
  if (!stdin.write(data)) {
    await new Promise<void>((resolve) => stdin.once("drain", resolve));
  }
}

export async function encodeRgbaStreamToMp4(
  frames: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  outPath: string,
  ffmpegBin: string,
): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const ff = spawn(
      ffmpegBin,
      [
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
        `${EXPORT_WIDTH}x${EXPORT_HEIGHT}`,
        "-r",
        String(EXPORT_FPS),
        "-i",
        "pipe:0",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-an",
        outPath,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let err = "";
    ff.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString("utf8");
    });
    ff.on("error", (e) => reject(e));
    ff.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-400)}`));
    });
    const stdin = ff.stdin;
    if (!stdin) {
      reject(new Error("ffmpeg stdin missing"));
      return;
    }
    (async () => {
      try {
        for await (const buf of frames) {
          await writeRgba(stdin, buf);
        }
        stdin.end();
      } catch (e) {
        reject(e);
      }
    })();
  });
}

export async function exportMatchMp4(opts: {
  db: Db;
  matchId: string;
  outPath: string;
  clipId?: string;
  full?: boolean;
  ffmpegBin?: string;
}): Promise<{ outPath: string; frames: number }> {
  const bin = opts.ffmpegBin ?? findFfmpeg();
  if (!bin) throw new Error("ffmpeg not found (install ffmpeg or set FFMPEG_PATH)");
  const spectator = collectExportFrames(opts.db, opts.matchId, { clipId: opts.clipId, full: opts.full });
  if (spectator.length === 0) throw new Error(`no spectator frames for ${opts.matchId}`);
  const canvas = createCanvas(EXPORT_WIDTH, EXPORT_HEIGHT);
  const ctx = canvas.getContext("2d");
  const title = highlightTitle(opts.db, opts.matchId);
  async function* rgba(): AsyncGenerator<Uint8Array> {
    for (let i = 0; i < TITLE_FRAMES; i++) {
      drawTitleCard(ctx, title.line1, title.line2);
      yield new Uint8Array(ctx.getImageData(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT).data);
    }
    for (const frame of spectator) {
      drawSpectatorFrame(ctx, frame);
      yield new Uint8Array(ctx.getImageData(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT).data);
    }
  }
  await encodeRgbaStreamToMp4(rgba(), opts.outPath, bin);
  return { outPath: opts.outPath, frames: TITLE_FRAMES + spectator.length };
}
