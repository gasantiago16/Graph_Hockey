/** Canvas 2D NHL rink (feet). Origin at center ice; +X toward the away net. */

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

function canvasEl(target) {
  return target && target.canvas ? target.canvas : target;
}

export function worldTo(target, x, y) {
  const canvas = canvasEl(target);
  const pad = 18;
  const iceW = canvas.width - pad * 2;
  const iceH = canvas.height - pad * 2;
  return {
    x: pad + ((x + RINK_LENGTH / 2) / RINK_LENGTH) * iceW,
    y: pad + ((RINK_WIDTH / 2 - y) / RINK_WIDTH) * iceH,
  };
}

export function sizeRinkCanvas(cv) {
  const rect = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(320, Math.floor(rect.width * dpr));
  cv.height = Math.floor(cv.width * (RINK_WIDTH / RINK_LENGTH) * 0.92);
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function strokeWorld(ctx, x0, y0, x1, y1, color, w = 1.5) {
  const a = worldTo(ctx, x0, y0);
  const b = worldTo(ctx, x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function pxPerFoot(ctx) {
  const a = worldTo(ctx, 0, 0);
  const b = worldTo(ctx, 1, 0);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function drawIce(ctx) {
  const canvas = canvasEl(ctx);
  const W = canvas.width;
  const H = canvas.height;
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
    ctx.arc(mid.x, mid.y, CREASE_RADIUS * ppf, toward > 0 ? -Math.PI / 2 : Math.PI / 2, toward > 0 ? Math.PI / 2 : -Math.PI / 2);
    ctx.stroke();
    const g0 = worldTo(ctx, gx, 3);
    const g1 = worldTo(ctx, gx + Math.sign(gx) * 2, -3);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.strokeRect(Math.min(g0.x, g1.x), Math.min(g0.y, g1.y), Math.abs(g1.x - g0.x), Math.abs(g1.y - g0.y));
  }

  const dots = [
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

export function drawPlayers(ctx, players) {
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

export function drawPuck(ctx, puck) {
  if (!puck) return;
  const pk = worldTo(ctx, puck.x, puck.y);
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(pk.x, pk.y, Math.max(3, pxPerFoot(ctx) * 0.45), 0, Math.PI * 2);
  ctx.fill();
}

export function drawOverlay(ctx, text) {
  if (!text) return;
  ctx.fillStyle = "rgba(7,11,18,.72)";
  ctx.fillRect(10, 8, Math.min(canvasEl(ctx).width - 20, 320), 22);
  ctx.fillStyle = "#e8eef4";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 16, 23);
}

export function formatClock(seconds) {
  const t = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function drawScoreboard(ctx, frame) {
  if (!frame) return;
  const period = frame.period === "OT" ? "OT" : `P${frame.period}`;
  const clock = formatClock(frame.clockRemaining);
  const line = `${period}  ${clock}    ${frame.score?.home ?? 0} – ${frame.score?.away ?? 0}    ${frame.strength ?? ""}  ${frame.phase ?? ""}`;
  drawOverlay(ctx, line);
}

export function drawSpectatorFrame(ctx, frame) {
  drawIce(ctx);
  if (!frame) return;
  drawScoreboard(ctx, frame);
  drawPlayers(ctx, frame.players ?? []);
  drawPuck(ctx, frame.puck);
}
