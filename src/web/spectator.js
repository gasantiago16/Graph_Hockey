import { aarHref, loadPostMatchPanels } from "./aar.js";
import { drawSpectatorFrame, formatClock, sizeRinkCanvas } from "./rink.js";

const canvas = document.getElementById("rink");
const ctx = canvas.getContext("2d");
const tickerEl = document.getElementById("ticker");
const scoreEl = document.getElementById("scoreboard");
const playEl = document.getElementById("playName");
const connEl = document.getElementById("conn");
const errEl = document.getElementById("err");
const costEl = document.getElementById("cost");
const btnStart = document.getElementById("btnStart");
const btnSeries = document.getElementById("btnSeries");
const btnStop = document.getElementById("btnStop");
const useLlmEl = document.getElementById("useLlm");

const PLAY_NAME_HIDDEN = "Play name hidden";
const ZERO_COST = { usd: 0, promptTokens: 0, outputTokens: 0, homeCalls: 0, awayCalls: 0 };

function formatHudUsd(usd) {
  const n = Number.isFinite(usd) ? usd : 0;
  if (n === 0) return "$0.00";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatCostHud(tick, noLlm) {
  const line = `${formatHudUsd(tick.usd)} · ${tick.promptTokens}/${tick.outputTokens} tok · home ${tick.homeCalls} · away ${tick.awayCalls} calls`;
  return noLlm ? `no-llm · ${line}` : line;
}

function formatInspectHud(inspectSide, inspect) {
  if (inspectSide === "none" || !inspect || inspect.side !== inspectSide) return PLAY_NAME_HIDDEN;
  return `${inspect.side} · ${inspect.playName} (${inspect.pressure})`;
}

const state = {
  inspectSide: "none",
  frame: null,
  teams: { home: "HOME", away: "AWAY" },
  ticker: [],
  running: false,
  ws: null,
  noLlm: true,
  lastMatchId: null,
  aarSide: "home",
};

function setErr(msg) {
  errEl.textContent = msg ?? "";
}

function setRunning(on) {
  state.running = on;
  btnStart.disabled = on;
  if (btnSeries) btnSeries.disabled = on;
  btnStop.disabled = !on;
}

function paint() {
  sizeRinkCanvas(canvas);
  drawSpectatorFrame(ctx, state.frame);
}

function boardText(frame) {
  if (!frame) return `P1  0:00.0    ${state.teams.home} 0 – 0 ${state.teams.away}`;
  const period = frame.period === "OT" ? "OT" : `P${frame.period}`;
  return `${period}  ${formatClock(frame.clockRemaining)}    ${state.teams.home} ${frame.score.home} – ${frame.score.away} ${state.teams.away}    ${frame.strength}  ${frame.phase}`;
}

function applyInspectUi() {
  document.querySelectorAll("[data-inspect]").forEach((el) => {
    el.classList.toggle("on", el.dataset.inspect === state.inspectSide);
  });
  playEl.textContent = formatInspectHud(state.inspectSide);
}

function sendInspect() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "hello", inspectSide: state.inspectSide }));
  }
}

function onMessage(msg) {
  if (msg.type === "snapshot") {
    state.frame = msg;
    scoreEl.innerHTML = boardText(msg)
      .replace(state.teams.home, `<span class="home">${state.teams.home}</span>`)
      .replace(state.teams.away, `<span class="away">${state.teams.away}</span>`);
    paint();
  } else if (msg.type === "inspect") {
    playEl.textContent = formatInspectHud(state.inspectSide, msg);
  } else if (msg.type === "event") {
    state.ticker.unshift(`${msg.eventType} @ ${msg.liveTick}`);
    state.ticker = state.ticker.slice(0, 12);
    tickerEl.textContent = state.ticker.join(" · ");
  } else if (msg.type === "match_start") {
    state.teams = { home: msg.home.name, away: msg.away.name };
    state.noLlm = msg.noLlm !== false;
    setRunning(true);
    costEl.textContent = formatCostHud(ZERO_COST, state.noLlm);
    const series =
      msg.seriesId && msg.games != null && msg.gameIndex != null
        ? `Series ${msg.seriesId} game ${msg.gameIndex + 1}/${msg.games} · `
        : "";
    tickerEl.textContent = `${series}Match ${msg.matchId} · period ${msg.periodSeconds}s · seed ${msg.seed}`;
    const post = document.getElementById("postMatch");
    if (post) post.hidden = true;
  } else if (msg.type === "match_over") {
    const seriesOngoing = Boolean(msg.seriesId) && msg.seriesComplete === false;
    setRunning(seriesOngoing);
    state.lastMatchId = msg.matchId;
    const href = `/film?match=${encodeURIComponent(msg.matchId)}`;
    const seriesHref = msg.seriesId ? `/film?series=${encodeURIComponent(msg.seriesId)}` : "";
    const aar = aarHref({ matchId: msg.matchId });
    const seriesLink = seriesHref ? ` · <a href="${seriesHref}">Series board</a>` : "";
    tickerEl.innerHTML = `Final ${msg.score.home}–${msg.score.away} (${msg.result}) · <a href="${href}">Review footage</a>${seriesLink} · <a href="${aar}">AAR / playbook</a>`;
    const review = document.getElementById("reviewFootage");
    if (review) review.setAttribute("href", msg.seriesComplete && seriesHref ? seriesHref : href);
    const openAar = document.getElementById("openAar");
    if (openAar) openAar.setAttribute("href", aar);
    const post = document.getElementById("postMatch");
    if (post) {
      post.hidden = false;
      void loadPostMatchPanels({
        matchId: msg.matchId,
        side: state.aarSide,
        aarEl: document.getElementById("aarPanel"),
        playbookEl: document.getElementById("playbookPanel"),
        filmLink: document.getElementById("postFilm"),
        aarLink: document.getElementById("postAar"),
        titleEl: document.getElementById("postMatchTitle"),
      });
    }
  } else if (msg.type === "cost") {
    costEl.textContent = formatCostHud(msg, state.noLlm);
  }
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    connEl.textContent = "ws connected";
    sendInspect();
  };
  ws.onclose = () => {
    connEl.textContent = "ws disconnected";
    setTimeout(connect, 1000);
  };
  ws.onerror = () => {
    connEl.textContent = "ws error";
  };
  ws.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
}

async function refreshLlmGate() {
  if (!useLlmEl) return;
  try {
    const res = await fetch("/api/health");
    const json = await res.json().catch(() => ({}));
    const on = Boolean(json.llmConfigured);
    useLlmEl.disabled = !on;
    if (!on) useLlmEl.checked = false;
  } catch {
    useLlmEl.disabled = true;
    useLlmEl.checked = false;
  }
}

function wantLlm() {
  return Boolean(useLlmEl && useLlmEl.checked && !useLlmEl.disabled);
}

async function startMatch() {
  setErr("");
  const body = {
    home: document.getElementById("home").value,
    away: document.getElementById("away").value,
    seed: Number(document.getElementById("seed").value),
    noLlm: !wantLlm(),
    periodSeconds: Number(document.getElementById("periodSeconds").value),
  };
  const res = await fetch("/api/match/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    setErr(json.error ?? `start failed (${res.status})`);
    return;
  }
  setRunning(true);
}

async function startSeries() {
  setErr("");
  const body = {
    home: document.getElementById("home").value,
    away: document.getElementById("away").value,
    seed: Number(document.getElementById("seed").value),
    noLlm: !wantLlm(),
    periodSeconds: Number(document.getElementById("periodSeconds").value),
    games: 7,
  };
  const res = await fetch("/api/series/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    setErr(json.error ?? `series start failed (${res.status})`);
    return;
  }
  setRunning(true);
}

async function stopMatch() {
  setErr("");
  const res = await fetch("/api/match/stop", { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) setErr(json.error ?? `stop failed (${res.status})`);
}

btnStart.addEventListener("click", () => {
  void startMatch();
});
if (btnSeries) {
  btnSeries.addEventListener("click", () => {
    void startSeries();
  });
}
btnStop.addEventListener("click", () => {
  void stopMatch();
});
document.querySelectorAll("[data-inspect]").forEach((el) => {
  el.addEventListener("click", () => {
    state.inspectSide = el.dataset.inspect;
    applyInspectUi();
    sendInspect();
  });
});
document.querySelectorAll("[data-aar-side]").forEach((el) => {
  el.addEventListener("click", () => {
    state.aarSide = el.dataset.aarSide === "away" ? "away" : "home";
    document.querySelectorAll("[data-aar-side]").forEach((b) => {
      b.classList.toggle("on", b.dataset.aarSide === state.aarSide);
    });
    if (state.lastMatchId) {
      void loadPostMatchPanels({
        matchId: state.lastMatchId,
        side: state.aarSide,
        aarEl: document.getElementById("aarPanel"),
        playbookEl: document.getElementById("playbookPanel"),
        filmLink: document.getElementById("postFilm"),
        aarLink: document.getElementById("postAar"),
        titleEl: document.getElementById("postMatchTitle"),
      });
    }
  });
});
window.addEventListener("resize", paint);
applyInspectUi();
paint();
void refreshLlmGate();
connect();
