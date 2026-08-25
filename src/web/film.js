import { drawIce, drawOverlay, drawPlayers, drawPuck, drawSpectatorFrame, sizeRinkCanvas } from "/src/web/rink.js";

const HOME = [
  { id: "HG", n: 31, pos: "G" }, { id: "HLD", n: 4, pos: "LD" }, { id: "HRD", n: 5, pos: "RD" },
  { id: "HC", n: 9, pos: "C" }, { id: "HLW", n: 17, pos: "LW" }, { id: "HRW", n: 28, pos: "RW" },
];
const AWAY = [
  { id: "AG", n: 1, pos: "G" }, { id: "ALD", n: 8, pos: "LD" }, { id: "ARD", n: 44, pos: "RD" },
  { id: "AC", n: 13, pos: "C" }, { id: "ALW", n: 19, pos: "LW" }, { id: "ARW", n: 81, pos: "RW" },
];
const FRAME_MS = 100;

function lerp(a, b, t) { return a + (b - a) * t; }
function lerp2(a, b, t) { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }; }
function clamp01(t) { return Math.max(0, Math.min(1, t)); }

function parseQuery(search) {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tRaw = q.get("t");
  const tick = tRaw !== null && tRaw !== "" ? Number.parseInt(tRaw, 10) : Number.NaN;
  return {
    matchId: q.get("match") || undefined,
    clipId: q.get("clip") || undefined,
    eventId: q.get("event") || undefined,
    tick: Number.isFinite(tick) ? tick : undefined,
  };
}

function fullClipId(matchId) {
  return `${matchId}:clip:full`;
}

function frameIndexForTick(frames, tick) {
  if (!frames.length) return 0;
  let best = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].liveTick <= tick) best = i;
    else break;
  }
  return best;
}

function baseIces() {
  return {
    HG: { x: -89, y: 0 }, HLD: { x: -52, y: 16 }, HRD: { x: -52, y: -16 },
    HC: { x: -18, y: 0 }, HLW: { x: -12, y: 24 }, HRW: { x: -12, y: -24 },
    AG: { x: 89, y: 0 }, ALD: { x: 52, y: -16 }, ARD: { x: 52, y: 16 },
    AC: { x: 18, y: 0 }, ALW: { x: 12, y: -24 }, ARW: { x: 12, y: 24 },
    puck: { x: 0, y: 0 },
  };
}

function apply(map, id, p) { map[id] = p; }

const scenarios = {
  crashNetGoalAgainst(u) {
    const m = baseIces();
    const t = clamp01(u);
    apply(m, "ARW", lerp2({ x: 8, y: -22 }, { x: -62, y: -12 }, Math.min(1, t / 0.45)));
    apply(m, "AC", lerp2({ x: 12, y: 2 }, { x: -70, y: 2 }, Math.min(1, t / 0.5)));
    apply(m, "ALW", lerp2({ x: 10, y: 20 }, { x: -48, y: 22 }, Math.min(1, t / 0.5)));
    apply(m, "HLD", lerp2({ x: -55, y: 18 }, { x: -72, y: 10 }, Math.max(0, (t - 0.4) / 0.4)));
    apply(m, "HRD", lerp2({ x: -55, y: -18 }, { x: -70, y: -8 }, Math.max(0, (t - 0.55) / 0.3)));
    const puckA = { x: 8, y: -20 };
    const puckB = { x: -62, y: -10 };
    const puckC = { x: -70, y: 1 };
    const puckD = { x: -93, y: 0 };
    if (t < 0.45) m.puck = lerp2(puckA, puckB, t / 0.45);
    else if (t < 0.7) m.puck = lerp2(puckB, puckC, (t - 0.45) / 0.25);
    else m.puck = lerp2(puckC, puckD, (t - 0.7) / 0.3);
    apply(m, "HG", { x: -88, y: lerp(0, m.puck.y * 0.3, t) });
    return m;
  },
  boxOutSave(u) {
    const m = baseIces();
    const t = clamp01(u);
    apply(m, "ARW", lerp2({ x: 8, y: -22 }, { x: -60, y: -12 }, Math.min(1, t / 0.45)));
    apply(m, "AC", lerp2({ x: 12, y: 2 }, { x: -68, y: 2 }, Math.min(1, t / 0.5)));
    apply(m, "HLD", lerp2({ x: -52, y: 16 }, { x: -66, y: 6 }, Math.min(1, t / 0.4)));
    apply(m, "HRD", lerp2({ x: -52, y: -16 }, { x: -64, y: -2 }, Math.min(1, t / 0.35)));
    const puckA = { x: 8, y: -20 };
    const puckB = { x: -58, y: -8 };
    const puckC = { x: -78, y: 2 };
    const puckD = { x: -70, y: 28 };
    const puckE = { x: 10, y: 10 };
    if (t < 0.4) m.puck = lerp2(puckA, puckB, t / 0.4);
    else if (t < 0.62) m.puck = lerp2(puckB, puckC, (t - 0.4) / 0.22);
    else if (t < 0.75) m.puck = lerp2(puckC, puckD, (t - 0.62) / 0.13);
    else m.puck = lerp2(puckD, puckE, (t - 0.75) / 0.25);
    apply(m, "HG", { x: -88, y: lerp(0, 4, Math.min(1, t)) });
    apply(m, "HLD", t > 0.75 ? lerp2(m.HLD, { x: -20, y: 18 }, (t - 0.75) / 0.25) : m.HLD);
    return m;
  },
  cycleTurnover(u) {
    const m = baseIces();
    const t = clamp01(u);
    apply(m, "HRW", lerp2({ x: -10, y: -20 }, { x: 62, y: -28 }, Math.min(1, t / 0.4)));
    apply(m, "HC", lerp2({ x: -8, y: 0 }, { x: 55, y: -8 }, Math.min(1, t / 0.45)));
    apply(m, "HLW", lerp2({ x: -8, y: 22 }, { x: 70, y: 22 }, Math.min(1, t / 0.5)));
    apply(m, "ARD", lerp2({ x: 52, y: 16 }, { x: 58, y: 4 }, t));
    const a = { x: 20, y: -10 }, b = { x: 68, y: -30 }, c = { x: 72, y: 18 }, d = { x: 40, y: 8 }, e = { x: -30, y: 6 };
    if (t < 0.35) m.puck = lerp2(a, b, t / 0.35);
    else if (t < 0.55) m.puck = lerp2(b, c, (t - 0.35) / 0.2);
    else if (t < 0.7) m.puck = lerp2(c, d, (t - 0.55) / 0.15);
    else m.puck = lerp2(d, e, (t - 0.7) / 0.3);
    return m;
  },
  cycleGoal(u) {
    const m = baseIces();
    const t = clamp01(u);
    apply(m, "HRW", lerp2({ x: -10, y: -20 }, { x: 64, y: -26 }, Math.min(1, t / 0.4)));
    apply(m, "HC", lerp2({ x: -8, y: 0 }, { x: 72, y: 2 }, Math.min(1, t / 0.5)));
    apply(m, "HLW", lerp2({ x: -8, y: 22 }, { x: 58, y: 12 }, Math.min(1, t / 0.45)));
    apply(m, "HLD", lerp2({ x: -40, y: 16 }, { x: 35, y: 22 }, t));
    const a = { x: 18, y: -8 }, b = { x: 70, y: -28 }, c = { x: 68, y: 8 }, d = { x: 82, y: 3 }, e = { x: 94, y: 1 };
    if (t < 0.35) m.puck = lerp2(a, b, t / 0.35);
    else if (t < 0.6) m.puck = lerp2(b, c, (t - 0.35) / 0.25);
    else if (t < 0.78) m.puck = lerp2(c, d, (t - 0.6) / 0.18);
    else m.puck = lerp2(d, e, (t - 0.78) / 0.22);
    apply(m, "AG", { x: 88, y: lerp(0, -6, Math.min(1, t * 1.2)) });
    return m;
  },
};

function drawDemoRink(ctx, frame, label) {
  drawIce(ctx);
  if (!frame) return;
  const players = [];
  for (const rec of HOME) {
    const p = frame[rec.id];
    if (p) players.push({ side: "home", number: rec.n, position: rec.pos, x: p.x, y: p.y });
  }
  for (const rec of AWAY) {
    const p = frame[rec.id];
    if (p) players.push({ side: "away", number: rec.n, position: rec.pos, x: p.x, y: p.y });
  }
  drawPlayers(ctx, players);
  if (frame.puck) drawPuck(ctx, frame.puck);
  if (label) drawOverlay(ctx, label);
}

function clipDuration(clip) {
  return Math.max(0.5, (clip.endLiveTick - clip.startLiveTick) * 0.1);
}

async function bootDemo() {
  const data = await fetch("/fixtures/film/demo-series.json").then((r) => r.json());
  const state = {
    mode: "single",
    clip: data.clips[0],
    compare: null,
    playing: false,
    u: 0,
    last: performance.now(),
  };
  const canvases = [];

  function renderRinkSlots() {
    const el = document.getElementById("rinks");
    el.innerHTML = "";
    canvases.length = 0;
    const slots = state.mode === "compare"
      ? [
          { clip: state.compare.early, label: "Game 1 · before AAR" },
          { clip: state.compare.late, label: "Game 7 · after AAR" },
        ]
      : [{ clip: state.clip, label: state.clip.title }];
    for (const s of slots) {
      const wrap = document.createElement("div");
      wrap.className = "rink-wrap";
      wrap.innerHTML = `<h2>${s.label}</h2>`;
      const cv = document.createElement("canvas");
      cv.className = "rink";
      wrap.appendChild(cv);
      el.appendChild(wrap);
      canvases.push({ cv, clip: s.clip, label: s.label });
    }
    requestAnimationFrame(() => {
      for (const { cv, clip } of canvases) {
        sizeRinkCanvas(cv);
        const fn = scenarios[clip.scenario];
        drawDemoRink(cv.getContext("2d"), fn(state.u), clip.title);
      }
    });
  }

  function tick(now) {
    const dt = (now - state.last) / 1000;
    state.last = now;
    if (state.playing) {
      const spd = Number(document.getElementById("speed").value);
      const dur = clipDuration(state.mode === "compare" ? state.compare.early : state.clip);
      state.u = Math.min(1, state.u + (dt * spd) / dur);
      if (state.u >= 1) state.playing = false;
    }
    document.getElementById("btnPlay").textContent = state.playing ? "Pause" : "Play";
    document.getElementById("scrub").value = String(Math.round(state.u * 1000));
    const dur = clipDuration(state.mode === "compare" ? state.compare.early : state.clip);
    document.getElementById("clock").textContent = `${(state.u * dur).toFixed(1)}s`;
    for (const { cv, clip } of canvases) {
      const fn = scenarios[clip.scenario];
      if (!fn) continue;
      drawDemoRink(cv.getContext("2d"), fn(state.u), clip.title);
    }
    requestAnimationFrame(tick);
  }

  function selectClip(clip, extraNote) {
    state.mode = "single";
    state.clip = clip;
    state.compare = null;
    state.u = 0;
    state.playing = true;
    document.getElementById("note").textContent = extraNote || clip.note || "";
    renderRinkSlots();
    [...document.querySelectorAll(".clip")].forEach((n) => n.classList.toggle("on", n.dataset.id === clip.id));
  }

  function playPair(earlyId, lateId) {
    const early = data.clips.find((c) => c.id === earlyId);
    const late = data.clips.find((c) => c.id === lateId);
    state.mode = "compare";
    state.compare = { early, late };
    state.clip = late;
    state.u = 0;
    state.playing = true;
    document.getElementById("note").textContent =
      `Same signature. ${early.title} vs ${late.title}. ${late.note}`;
    renderRinkSlots();
  }

  function renderClips() {
    const host = document.getElementById("clipList");
    host.innerHTML = data.clips.map((c) => `
      <div class="clip ${c.id === state.clip.id ? "on" : ""}" data-id="${c.id}">
        <div class="k">${c.kind} · ${c.playId} · ${c.source}</div>
        <div class="t">${c.title}</div>
        <div class="n">${c.note}</div>
      </div>`).join("");
    host.querySelectorAll(".clip").forEach((n) => {
      n.onclick = () => selectClip(data.clips.find((c) => c.id === n.dataset.id));
    });
  }

  function renderToolbar() {
    const tb = document.getElementById("toolbar");
    tb.innerHTML = `<span class="sub">${data.home.name} vs ${data.away.name} · 7-game series (demo)</span>`;
    for (const g of data.games) {
      const b = document.createElement("button");
      b.className = "chip";
      b.textContent = `G${g.gameIndex + 1} ${g.score.home}–${g.score.away}`;
      b.onclick = () => {
        const clip = data.clips.find((c) => c.gameIndex === g.gameIndex) || data.clips[0];
        selectClip(clip, g.aarSummary ? g.aarSummary.home : clip.note);
      };
      tb.appendChild(b);
    }
    const cmp = document.createElement("button");
    cmp.className = "chip pair";
    cmp.textContent = "Compare G1 vs G7 (DZ crash)";
    cmp.onclick = () => playPair("demo-g0:clip:0", "demo-g6:clip:0");
    tb.appendChild(cmp);
    const cmp2 = document.createElement("button");
    cmp2.className = "chip pair";
    cmp2.textContent = "Compare G1 vs G7 (OZ cycle)";
    cmp2.onclick = () => playPair("demo-g0:clip:1", "demo-g6:clip:1");
    tb.appendChild(cmp2);
  }

  function sign(n, invert = false) {
    const v = invert ? -n : n;
    const cls = v > 0.0001 ? "up" : v < -0.0001 ? "down" : "";
    const s = n > 0 ? `+${n}` : `${n}`;
    return `<span class="${cls}">${s}</span>`;
  }

  function renderBoard() {
    const g0 = data.games[0], g6 = data.games[6];
    const h0 = g0.aggregates.home, h6 = g6.aggregates.home;
    document.getElementById("deltas").innerHTML = `
      <p style="margin:0 0 8px"><b>Original Six · game 1 → 7</b></p>
      <div>xG for ${sign(+(h6.xgFor - h0.xgFor).toFixed(1))}</div>
      <div>xG against ${sign(+(h6.xgAgainst - h0.xgAgainst).toFixed(1), true)}</div>
      <div>Goals ${sign(h6.goalsFor - h0.goalsFor)} / ${sign(h6.goalsAgainst - h0.goalsAgainst, true)}</div>
      <div>CF% ${sign(h6.cfPct - h0.cfPct)}</div>
      <div>Playbook v${g0.playbookVersion.home} → v${g6.playbookVersion.home}</div>
    `;
    document.getElementById("table").innerHTML = `
      <table>
        <tr><th>G</th><th>Score</th><th>xGF</th><th>xGA</th><th>CF%</th><th>PB</th><th></th></tr>
        ${data.games.map((g) => {
          const h = g.aggregates.home;
          return `<tr>
            <td>${g.gameIndex + 1}</td>
            <td>${g.score.home}–${g.score.away}</td>
            <td>${h.xgFor.toFixed(1)}</td>
            <td>${h.xgAgainst.toFixed(1)}</td>
            <td>${h.cfPct}</td>
            <td>v${g.playbookVersion.home}</td>
            <td>${g.result.home}</td>
          </tr>`;
        }).join("")}
      </table>`;
    document.getElementById("pairs").innerHTML = `
      <button class="chip pair" type="button" id="p1">dz-collapse · DZ<br><small>G1 Goal against → G7 Save</small></button>
      <button class="chip pair" type="button" id="p2">oz-cycle-low · OZ<br><small>G1 Turnover → G7 Goal</small></button>
      <p class="sub">${data.story}</p>`;
    document.getElementById("p1").onclick = () => playPair("demo-g0:clip:0", "demo-g6:clip:0");
    document.getElementById("p2").onclick = () => playPair("demo-g0:clip:1", "demo-g6:clip:1");

    const cv = document.getElementById("chart");
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    const xs = data.games.map((_, i) => 20 + i * 38);
    const plot = (key, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      data.games.forEach((g, i) => {
        const y = 100 - g.aggregates.home[key] * 18;
        if (i === 0) ctx.moveTo(xs[i], y); else ctx.lineTo(xs[i], y);
      });
      ctx.stroke();
    };
    plot("xgFor", "#3ecf8e");
    plot("xgAgainst", "#e85d5d");
    ctx.fillStyle = "#8aa0b5"; ctx.font = "10px sans-serif";
    ctx.fillText("xGF", 8, 14); ctx.fillStyle = "#e85d5d"; ctx.fillText("xGA", 40, 14);
  }

  document.getElementById("btnPlay").onclick = () => {
    state.playing = !state.playing;
    if (state.u >= 1) { state.u = 0; state.playing = true; }
  };
  document.getElementById("btnBack").onclick = () => { state.u = Math.max(0, state.u - 0.15); };
  document.getElementById("btnFwd").onclick = () => { state.u = Math.min(1, state.u + 0.15); };
  document.getElementById("scrub").oninput = (e) => { state.u = Number(e.target.value) / 1000; };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); document.getElementById("btnPlay").click(); }
    if (e.key === "j" || e.key === "J") document.getElementById("btnBack").click();
    if (e.key === "k" || e.key === "K") document.getElementById("btnFwd").click();
    if (["1", "2", "3", "4"].includes(e.key)) {
      document.getElementById("speed").value = { 1: "0.25", 2: "0.5", 3: "1", 4: "2" }[e.key];
    }
  });

  renderToolbar();
  renderClips();
  renderBoard();
  renderRinkSlots();
  requestAnimationFrame(tick);
}

async function bootMatch(query) {
  document.querySelector(".layout")?.classList.add("match-mode");
  const matchId = query.matchId;
  const res = await fetch(`/api/footage/${encodeURIComponent(matchId)}`);
  if (!res.ok) {
    const tb = document.getElementById("toolbar");
    tb.innerHTML = `<span class="sub">No recording for ${matchId}.</span>
      <a class="chip" href="/film">Demo series</a>`;
    document.getElementById("note").textContent = "Simulate a match (without --no-record), then open /film?match=ID.";
    return;
  }
  const footage = await res.json();
  const duration = footage.recording.durationLiveTicks;
  const full = {
    id: fullClipId(matchId),
    matchId,
    startLiveTick: 0,
    endLiveTick: duration,
    kind: "user",
    title: "Full recording",
    source: "user",
    note: "Entire match window",
    relatedEventIds: [],
  };
  const clips = [full, ...(footage.clips ?? [])];
  if (query.ephemeral) clips.splice(1, 0, query.ephemeral);

  const state = {
    clips,
    clip: clips[0],
    frames: [],
    index: 0,
    playing: false,
    acc: 0,
    last: performance.now(),
    canvas: null,
  };

  function activeFrame() {
    return state.frames[state.index] ?? null;
  }

  function renderRink() {
    const el = document.getElementById("rinks");
    if (!state.canvas) {
      el.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "rink-wrap";
      wrap.innerHTML = `<h2 id="rinkLabel">${state.clip.title}</h2>`;
      const cv = document.createElement("canvas");
      cv.className = "rink";
      wrap.appendChild(cv);
      el.appendChild(wrap);
      state.canvas = cv;
    }
    const label = document.getElementById("rinkLabel");
    if (label) label.textContent = state.clip.title;
    sizeRinkCanvas(state.canvas);
    drawSpectatorFrame(state.canvas.getContext("2d"), activeFrame());
  }

  function syncHud() {
    const n = state.frames.length;
    document.getElementById("btnPlay").textContent = state.playing ? "Pause" : "Play";
    const u = n <= 1 ? 0 : state.index / (n - 1);
    document.getElementById("scrub").value = String(Math.round(u * 1000));
    const frame = activeFrame();
    const tick = frame ? frame.liveTick : state.clip.startLiveTick;
    const rel = (tick - state.clip.startLiveTick) * 0.1;
    document.getElementById("clock").textContent = `${Math.max(0, rel).toFixed(1)}s · t${tick}`;
  }

  async function loadClip(clip, seekTick) {
    state.clip = clip;
    state.frames = [];
    state.index = 0;
    state.playing = false;
    state.acc = 0;
    document.getElementById("note").textContent = "Resimulating clip window…";
    renderClips();
    const isFull = clip.id === fullClipId(matchId) || clip.id === "full";
    const url = clip._window
      ? `/api/footage/${encodeURIComponent(matchId)}/frames?from=${clip.startLiveTick}&to=${clip.endLiveTick}`
      : `/api/footage/${encodeURIComponent(matchId)}/clips/${encodeURIComponent(isFull ? "full" : clip.id)}/frames`;
    const out = await fetch(url).then((r) => r.json()).catch(() => ({ frames: [] }));
    state.frames = Array.isArray(out.frames) ? out.frames : [];
    if (seekTick !== undefined) state.index = frameIndexForTick(state.frames, seekTick);
    state.playing = state.frames.length > 0;
    const extra = clip.note || `${clip.kind} · ticks ${clip.startLiveTick}–${clip.endLiveTick}`;
    document.getElementById("note").textContent = state.frames.length
      ? extra
      : "No frames in this window.";
    renderRink();
    syncHud();
  }

  function renderClips() {
    const host = document.getElementById("clipList");
    host.innerHTML = state.clips.map((c) => `
      <div class="clip ${c.id === state.clip.id ? "on" : ""}" data-id="${c.id}">
        <div class="k">${c.kind} · ${c.source ?? "auto"} · ${c.startLiveTick}–${c.endLiveTick}</div>
        <div class="t">${c.title}</div>
        <div class="n">${c.playId ? c.playId : (c.note ?? "")}</div>
      </div>`).join("");
    host.querySelectorAll(".clip").forEach((n) => {
      n.onclick = () => {
        const clip = state.clips.find((c) => c.id === n.dataset.id);
        if (clip) void loadClip(clip);
      };
    });
  }

  function renderToolbar() {
    const tb = document.getElementById("toolbar");
    const m = footage.match;
    const score = m?.score ? `${m.score.home ?? "–"}–${m.score.away ?? "–"}` : "";
    tb.innerHTML = `
      <span class="sub">${m?.home ?? "home"} vs ${m?.away ?? "away"} · ${score} · ${matchId}</span>
      <a class="chip" href="/film">Demo series</a>
      <a class="chip" href="/aar?match=${encodeURIComponent(matchId)}">AAR / playbook</a>
      <a class="chip" href="/">Live rink</a>`;
  }

  function loop(now) {
    const dt = now - state.last;
    state.last = now;
    if (state.playing && state.frames.length) {
      const spd = Number(document.getElementById("speed").value);
      state.acc += dt * spd;
      while (state.acc >= FRAME_MS) {
        state.acc -= FRAME_MS;
        if (state.index < state.frames.length - 1) state.index += 1;
        else state.playing = false;
      }
    }
    renderRink();
    syncHud();
    requestAnimationFrame(loop);
  }

  document.getElementById("btnPlay").onclick = () => {
    if (state.index >= state.frames.length - 1) {
      state.index = 0;
      state.playing = true;
      state.acc = 0;
      return;
    }
    state.playing = !state.playing;
  };
  document.getElementById("btnBack").onclick = () => {
    state.index = Math.max(0, state.index - 10);
    state.playing = false;
  };
  document.getElementById("btnFwd").onclick = () => {
    state.index = Math.min(Math.max(0, state.frames.length - 1), state.index + 10);
    state.playing = false;
  };
  document.getElementById("scrub").oninput = (e) => {
    const u = Number(e.target.value) / 1000;
    const n = state.frames.length;
    state.index = n <= 1 ? 0 : Math.round(u * (n - 1));
    state.playing = false;
  };
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") { e.preventDefault(); document.getElementById("btnPlay").click(); }
    if (e.key === "j" || e.key === "J") document.getElementById("btnBack").click();
    if (e.key === "k" || e.key === "K") document.getElementById("btnFwd").click();
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      state.index = Math.max(0, state.index - 1);
      state.playing = false;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      state.index = Math.min(Math.max(0, state.frames.length - 1), state.index + 1);
      state.playing = false;
    }
    if (["1", "2", "3", "4"].includes(e.key)) {
      document.getElementById("speed").value = { 1: "0.25", 2: "0.5", 3: "1", 4: "2" }[e.key];
    }
  });
  window.addEventListener("resize", renderRink);

  renderToolbar();
  renderClips();
  renderRink();
  requestAnimationFrame(loop);

  let start = clips.find((c) => c.id === query.clipId) ?? clips[1] ?? clips[0];
  if (query.ephemeral) {
    start = { ...query.ephemeral, _window: true };
    if (!state.clips.some((c) => c.id === start.id)) state.clips.splice(1, 0, start);
  }
  await loadClip(start, query.tick);
}

export async function bootFilmRoom() {
  const q = parseQuery(location.search);
  if (q.eventId && !q.matchId) {
    try {
      const evRes = await fetch(`/api/footage/event/${encodeURIComponent(q.eventId)}`);
      if (evRes.ok) {
        const ev = await evRes.json();
        q.matchId = ev.matchId;
        if (!q.clipId) q.clipId = ev.clipId;
        if (q.tick === undefined) q.tick = ev.liveTick;
        if (ev.ephemeral) q.ephemeral = ev.ephemeral;
      }
    } catch {
      /* fall through to demo */
    }
  }
  if (q.matchId) await bootMatch(q);
  else await bootDemo();
}

void bootFilmRoom();
