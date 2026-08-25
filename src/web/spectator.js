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
const btnStop = document.getElementById("btnStop");

const state = {
  inspectSide: "none",
  frame: null,
  teams: { home: "HOME", away: "AWAY" },
  ticker: [],
  running: false,
  ws: null,
};

function setErr(msg) {
  errEl.textContent = msg ?? "";
}

function setRunning(on) {
  state.running = on;
  btnStart.disabled = on;
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
  if (state.inspectSide === "none") playEl.textContent = "Play name hidden";
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
    if (state.inspectSide === msg.side) {
      playEl.textContent = `${msg.side} · ${msg.playName} (${msg.pressure})`;
    }
  } else if (msg.type === "event") {
    state.ticker.unshift(`${msg.eventType} @ ${msg.liveTick}`);
    state.ticker = state.ticker.slice(0, 12);
    tickerEl.textContent = state.ticker.join(" · ");
  } else if (msg.type === "match_start") {
    state.teams = { home: msg.home.name, away: msg.away.name };
    setRunning(true);
    costEl.textContent = "no-llm · $0.00";
    tickerEl.textContent = `Match ${msg.matchId} · period ${msg.periodSeconds}s · seed ${msg.seed}`;
  } else if (msg.type === "match_over") {
    setRunning(false);
    tickerEl.textContent = `Final ${msg.score.home}–${msg.score.away} (${msg.result})`;
  } else if (msg.type === "cost") {
    costEl.textContent = `no-llm · $${Number(msg.usd).toFixed(2)} · calls ${msg.homeCalls}/${msg.awayCalls}`;
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

async function startMatch() {
  setErr("");
  const body = {
    home: document.getElementById("home").value,
    away: document.getElementById("away").value,
    seed: Number(document.getElementById("seed").value),
    noLlm: true,
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

async function stopMatch() {
  setErr("");
  const res = await fetch("/api/match/stop", { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) setErr(json.error ?? `stop failed (${res.status})`);
}

btnStart.addEventListener("click", () => {
  void startMatch();
});
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
window.addEventListener("resize", paint);
applyInspectUi();
paint();
connect();
