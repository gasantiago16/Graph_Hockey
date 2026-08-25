import type { SKRSContext2D } from "@napi-rs/canvas";
import type { SpectatorFrame, SpectatorPlayer } from "../types/ws.ts";

export const RINK_LENGTH = 200;
export const RINK_WIDTH = 85;
export const CORNER_RADIUS = 28;
export const GOAL_LINE_X = 89;
export const BLUE_LINE_X = 25;
export const CREASE_RADIUS = 6;
export const FACEOFF_CIRCLE_R = 15;
export const HASH_OFFSET_Y = 22;
export const END_ZONE_FACEOFF_X = 69;
export const NZ_FACEOFF_X = 20;

export const EXPORT_WIDTH = 1280;
export const EXPORT_HEIGHT = 720;
const PAD = 36;

type Ctx = SKRSContext2D;

function iceBox(ctx: Ctx) {
  const iceW = ctx.canvas.width - PAD * 2;
  const iceH = iceW * (RINK_WIDTH / RINK_LENGTH);
  const x = PAD;
  const y = (ctx.canvas.height - iceH) / 2;
  return { x, y, w: iceW, h: iceH };
}

export function worldTo(ctx: Ctx, x: number, y: number): { x: number; y: number } {
  const box = iceBox(ctx);
  return {
    x: box.x + ((x + RINK_LENGTH / 2) / RINK_LENGTH) * box.w,
    y: box.y + ((RINK_WIDTH / 2 - y) / RINK_WIDTH) * box.h,
  };
}

function pxPerFoot(ctx: Ctx): number {
  const a = worldTo(ctx, 0, 0);
  const b = worldTo(ctx, 1, 0);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function strokeWorld(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, color: string, w = 1.5): void {
  const a = worldTo(ctx, x0, y0);
  const b = worldTo(ctx, x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawIce(ctx: Ctx): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#123044";
  ctx.fillRect(0, 0, W, H);

  const tl = worldTo(ctx, -RINK_LENGTH / 2, RINK_WIDTH / 2);
  const br = worldTo(ctx, RINK_LENGTH / 2, -RINK_WIDTH / 2);
  const rw = br.x - tl.x;
  const rh = br.y - tl.y;
  const scale = rw / RINK_LENGTH;

  ctx.fillStyle = "#d9e7f0";
  roundRect(ctx, tl.x, tl.y, rw, rh, CORNER_RADIUS * scale);
  ctx.fill();
  ctx.strokeStyle = "#8aa4b8";
  ctx.lineWidth = 2;
  ctx.stroke();

  strokeWorld(ctx, 0, RINK_WIDTH / 2, 0, -RINK_WIDTH / 2, "#c8102e", 2);
  strokeWorld(ctx, -BLUE_LINE_X, RINK_WIDTH / 2, -BLUE_LINE_X, -RINK_WIDTH / 2, "#2e6da4", 2);
  strokeWorld(ctx, BLUE_LINE_X, RINK_WIDTH / 2, BLUE_LINE_X, -RINK_WIDTH / 2, "#2e6da4", 2);
  strokeWorld(ctx, -GOAL_LINE_X, 22, -GOAL_LINE_X, -22, "#c8102e", 1);
  strokeWorld(ctx, GOAL_LINE_X, 22, GOAL_LINE_X, -22, "#c8102e", 1);

  const ppf = pxPerFoot(ctx);
  const center = worldTo(ctx, 0, 0);
  ctx.strokeStyle = "#c8102e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center.x, center.y, FACEOFF_CIRCLE_R * ppf, 0, Math.PI * 2);
  ctx.stroke();

  for (const gx of [-GOAL_LINE_X, GOAL_LINE_X]) {
    const toward = gx < 0 ? 1 : -1;
    const mid = worldTo(ctx, gx, 0);
    ctx.strokeStyle = "#c8102e";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(
      mid.x,
      mid.y,
      CREASE_RADIUS * ppf,
      toward > 0 ? -Math.PI / 2 : Math.PI / 2,
      toward > 0 ? Math.PI / 2 : -Math.PI / 2,
    );
    ctx.stroke();
    const g0 = worldTo(ctx, gx, 3);
    const g1 = worldTo(ctx, gx + Math.sign(gx) * 2, -3);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.strokeRect(Math.min(g0.x, g1.x), Math.min(g0.y, g1.y), Math.abs(g1.x - g0.x), Math.abs(g1.y - g0.y));
  }

  const dots: [number, number][] = [
    [0, 0],
    [-END_ZONE_FACEOFF_X, HASH_OFFSET_Y],
    [-END_ZONE_FACEOFF_X, -HASH_OFFSET_Y],
    [END_ZONE_FACEOFF_X, HASH_OFFSET_Y],
    [END_ZONE_FACEOFF_X, -HASH_OFFSET_Y],
    [-NZ_FACEOFF_X, HASH_OFFSET_Y],
    [-NZ_FACEOFF_X, -HASH_OFFSET_Y],
    [NZ_FACEOFF_X, HASH_OFFSET_Y],
    [NZ_FACEOFF_X, -HASH_OFFSET_Y],
  ];
  ctx.fillStyle = "#c8102e";
  for (const [x, y] of dots) {
    const p = worldTo(ctx, x, y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawPlayers(ctx: Ctx, players: readonly SpectatorPlayer[]): void {
  const ppf = pxPerFoot(ctx);
  for (const p of players) {
    const c = worldTo(ctx, p.x, p.y);
    const r = (p.position === "G" ? 1.8 : 1.6) * ppf;
    ctx.fillStyle = p.side === "home" ? "#c8102e" : "#1d4e89";
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (typeof p.heading === "number") {
      const tip = worldTo(ctx, p.x + Math.cos(p.heading) * 2.2, p.y + Math.sin(p.heading) * 2.2);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(8, Math.round(r))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(p.number ?? ""), c.x, c.y);
  }
}

export function drawPuck(ctx: Ctx, puck: SpectatorFrame["puck"] | undefined): void {
  if (!puck) return;
  const pk = worldTo(ctx, puck.x, puck.y);
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(pk.x, pk.y, Math.max(3, pxPerFoot(ctx) * 0.45), 0, Math.PI * 2);
  ctx.fill();
}

export function formatClock(seconds: number): string {
  const t = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function drawScoreboard(ctx: Ctx, frame: SpectatorFrame, title?: string): void {
  const period = frame.period === "OT" ? "OT" : `P${frame.period}`;
  const clock = formatClock(frame.clockRemaining);
  const line = title
    ? title
    : `${period}  ${clock}    ${frame.score?.home ?? 0} – ${frame.score?.away ?? 0}    ${frame.strength ?? ""}  ${frame.phase ?? ""}`;
  ctx.fillStyle = "rgba(7,11,18,0.78)";
  ctx.fillRect(16, 12, Math.min(ctx.canvas.width - 32, 720), 28);
  ctx.fillStyle = "#e8eef4";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(line, 24, 32);
}

export function drawSpectatorFrame(ctx: Ctx, frame: SpectatorFrame, title?: string): void {
  drawIce(ctx);
  drawScoreboard(ctx, frame, title);
  drawPlayers(ctx, frame.players ?? []);
  drawPuck(ctx, frame.puck);
}

export function drawTitleCard(ctx: Ctx, line1: string, line2: string): void {
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = "#e8eef4";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "36px sans-serif";
  ctx.fillText(line1, ctx.canvas.width / 2, ctx.canvas.height / 2 - 24);
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#8aa4b8";
  ctx.fillText(line2, ctx.canvas.width / 2, ctx.canvas.height / 2 + 20);
}
