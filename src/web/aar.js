export function watchHref(matchId, eventId) {
  const q = new URLSearchParams();
  if (matchId) q.set("match", matchId);
  if (eventId) q.set("event", eventId);
  const s = q.toString();
  return s ? `/film?${s}` : "/film";
}

export function parseAarQuery(search) {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const q = new URLSearchParams(raw);
  const side = q.get("side");
  return {
    matchId: q.get("match") || undefined,
    side: side === "home" || side === "away" ? side : undefined,
  };
}

export function aarHref(query) {
  const q = new URLSearchParams();
  if (query.matchId) q.set("match", query.matchId);
  if (query.side) q.set("side", query.side);
  const s = q.toString();
  return s ? `/aar?${s}` : "/aar";
}

function describeMutation(op) {
  if (!op || typeof op !== "object") return "op";
  if (op.op === "boost" || op.op === "nerf" || op.op === "retire") {
    return `${op.op} ${op.playId} — ${op.reason ?? ""}`;
  }
  if (op.op === "tweak_trigger") return `tweak_trigger ${op.playId}`;
  if (op.op === "tweak_assignment") return `tweak_assignment ${op.playId}`;
  if (op.op === "tweak_slot") return `tweak_slot ${op.playId} ${op.slot ?? ""}`;
  if (op.op === "add_counter") return `add_counter ${op.playId} vs ${op.family ?? ""}`;
  if (op.op === "mint") return `mint ${op.name} from ${op.basedOn}`;
  if (op.op === "personnel") return `personnel ${op.line} — ${op.note ?? ""}`;
  return String(op.op ?? "op");
}

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") n.className = v;
    else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
    } else n.setAttribute(k, String(v));
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}

function cites(matchId, eventIds) {
  if (!Array.isArray(eventIds) || eventIds.length === 0) return null;
  return h(
    "ul",
    { class: "cites" },
    eventIds.map((id) =>
      h(
        "li",
        {},
        h("code", {}, String(id)),
        " ",
        h("a", { class: "watch", href: watchHref(matchId, String(id)) }, "Watch"),
      ),
    ),
  );
}

export function renderAarInto(host, payload) {
  host.replaceChildren();
  if (!payload || payload.error) {
    host.append(h("p", { class: "err" }, payload?.error ?? "No AAR."));
    return;
  }
  const matchId = payload.matchId ?? "";
  const supposed = payload.intentSummary?.trim() ? payload.intentSummary : "No stored coach intents.";
  const actual = payload.actualSummary?.trim() ? payload.actualSummary : "No actual summary.";
  const causes = Array.isArray(payload.causes) ? payload.causes : [];
  const ops = payload.revision?.ops ?? [];
  const article = h("article", { class: "aar", "data-side": payload.side ?? "", "data-match": matchId });
  article.append(
    h("h2", {}, `${payload.side ?? "side"} AAR · ${payload.result ?? "?"}`),
    h("p", { class: "applied" }, payload.applied ? "applied" : "proposed (not applied)"),
    h("section", { class: "aar-block" }, h("h3", {}, "Supposed"), h("p", { class: "pre" }, supposed)),
    h("section", { class: "aar-block" }, h("h3", {}, "Actual"), h("p", { class: "pre" }, actual)),
  );
  const why = h("section", { class: "aar-block" }, h("h3", {}, "Why"));
  if (causes.length === 0) {
    why.append(
      h("p", { class: "muted" }, payload.noLlm ? "No cited causes (code-only AAR)." : "No cited causes."),
    );
  } else {
    why.append(
      h(
        "ul",
        { class: "causes" },
        causes.map((c) => {
          const plays = Array.isArray(c.playIds) && c.playIds.length ? ` ${c.playIds.join(", ")}` : "";
          return h(
            "li",
            { class: "cause" },
            h("div", { class: "claim" }, `${c.claim ?? ""}${plays}`),
            cites(matchId, c.eventIds),
          );
        }),
      ),
    );
  }
  article.append(why);
  const opsSec = h("section", { class: "aar-block" }, h("h3", {}, "Ops"));
  if (payload.revision?.summary) opsSec.append(h("p", { class: "muted" }, payload.revision.summary));
  if (ops.length === 0) {
    opsSec.append(h("p", { class: "muted" }, "No playbook mutations."));
  } else {
    opsSec.append(
      h(
        "ul",
        { class: "ops" },
        ops.map((op) => h("li", { class: "op" }, h("div", {}, describeMutation(op)), cites(matchId, op.eventIds))),
      ),
    );
  }
  article.append(opsSec);
  if (payload.lensNotes) {
    article.append(h("section", { class: "aar-block" }, h("h3", {}, "Lens"), h("p", { class: "pre" }, payload.lensNotes)));
  }
  if (Array.isArray(payload.rejectedOps) && payload.rejectedOps.length) {
    article.append(
      h(
        "section",
        { class: "aar-block" },
        h("h3", {}, "Rejected"),
        h(
          "ul",
          {},
          payload.rejectedOps.map((r) => h("li", {}, String(r))),
        ),
      ),
    );
  }
  host.append(article);
}

export function renderDiffInto(host, payload) {
  host.replaceChildren();
  if (!payload || payload.error) {
    host.append(h("p", { class: "err" }, payload?.error ?? "No playbook."));
    return;
  }
  const diff = payload.diff ?? {
    teamId: payload.teamId ?? "",
    fromVersion: payload.version ?? 1,
    toVersion: payload.version ?? 1,
    added: [],
    removed: [],
    changed: [],
  };
  const rows = [...(diff.added ?? []), ...(diff.removed ?? []), ...(diff.changed ?? [])];
  const article = h("article", { class: "playbook-diff", "data-team": diff.teamId ?? payload.teamId ?? "" });
  article.append(
    h("h2", {}, `Playbook ${diff.teamId ?? payload.teamId ?? "team"} v${diff.fromVersion} → v${diff.toVersion}`),
  );
  if (rows.length === 0) {
    article.append(h("p", { class: "muted" }, "(no play changes)"));
  } else {
    article.append(
      h(
        "ul",
        { class: "diff" },
        rows.map((e) => {
          const mark = e.kind === "added" ? "+" : e.kind === "removed" ? "-" : "~";
          const fields = e.kind === "changed" && e.fields?.length ? `  ${e.fields.join(",")}` : "";
          return h("li", { class: e.kind ?? "changed" }, `${mark} ${e.id}  ${e.name ?? ""}${fields}`);
        }),
      ),
    );
  }
  host.append(article);
}

export async function fetchAar(matchId, side) {
  const res = await fetch(`/api/aar/${encodeURIComponent(matchId)}/${encodeURIComponent(side)}`);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export async function fetchPlaybook(teamId, matchId) {
  const q = new URLSearchParams({ diff: "1" });
  if (matchId) q.set("match", matchId);
  const res = await fetch(`/api/playbook/${encodeURIComponent(teamId)}?${q.toString()}`);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export async function loadPostMatchPanels(opts) {
  const matchId = opts.matchId;
  const side = opts.side === "away" ? "away" : "home";
  if (opts.filmLink) opts.filmLink.setAttribute("href", `/film?match=${encodeURIComponent(matchId)}`);
  if (opts.aarLink) opts.aarLink.setAttribute("href", aarHref({ matchId }));
  if (opts.titleEl) opts.titleEl.textContent = `Match over · ${matchId}`;
  if (!opts.aarEl) return;
  const aar = await fetchAar(matchId, side);
  renderAarInto(opts.aarEl, aar.json);
  if (opts.playbookEl) {
    const teamId = aar.json?.teamId;
    if (teamId) {
      const pb = await fetchPlaybook(teamId, matchId);
      renderDiffInto(opts.playbookEl, pb.json);
    } else {
      opts.playbookEl.replaceChildren();
    }
  }
}

async function bootAarPage() {
  const q = parseAarQuery(location.search);
  const toolbar = document.getElementById("toolbar");
  const list = document.getElementById("list");
  const reports = document.getElementById("reports");
  const diffs = document.getElementById("diffs");

  if (!q.matchId) {
    toolbar.replaceChildren(h("span", { class: "sub" }, "Pick a finished match."));
    const res = await fetch("/api/matches");
    const json = await res.json().catch(() => ({ matches: [] }));
    const matches = Array.isArray(json.matches) ? json.matches.slice().reverse() : [];
    if (matches.length === 0) {
      list.append(h("p", { class: "muted" }, "No matches yet. Start one from the live rink."));
      return;
    }
    for (const m of matches) {
      const score = m.score ? `${m.score.home ?? "–"}–${m.score.away ?? "–"}` : "";
      const aar = m.aar ? `aar home ${m.aar.home ? "yes" : "no"} · away ${m.aar.away ? "yes" : "no"}` : "";
      list.append(
        h(
          "div",
          { class: "match-row" },
          h("a", { href: aarHref({ matchId: m.id }) }, m.id),
          `  ${m.home ?? ""} vs ${m.away ?? ""}  ${score}  ${m.result ?? ""}  `,
          h("a", { class: "chip", href: `/film?match=${encodeURIComponent(m.id)}` }, "Film"),
          aar ? h("span", { class: "muted" }, `  ${aar}`) : null,
        ),
      );
    }
    return;
  }

  const sides = q.side ? [q.side] : ["home", "away"];
  toolbar.replaceChildren(
    h("span", { class: "sub" }, `Match ${q.matchId}`),
    h("a", { class: "chip", href: `/film?match=${encodeURIComponent(q.matchId)}` }, "Review footage"),
    h("a", { class: "chip", href: "/" }, "Live rink"),
    ...["home", "away"].map((s) =>
      h("a", { class: `chip${q.side === s ? " on" : ""}`, href: aarHref({ matchId: q.matchId, side: s }) }, s),
    ),
    q.side ? h("a", { class: "chip", href: aarHref({ matchId: q.matchId }) }, "both") : null,
  );

  reports.replaceChildren();
  diffs.replaceChildren();
  for (const side of sides) {
    const col = h("div", {});
    reports.append(col);
    const aar = await fetchAar(q.matchId, side);
    renderAarInto(col, aar.json);
    const teamId = aar.json?.teamId;
    if (teamId) {
      const pb = await fetchPlaybook(teamId, q.matchId);
      const slot = h("div", {});
      diffs.append(slot);
      renderDiffInto(slot, pb.json);
    }
  }
}

if (document.documentElement.dataset.page === "aar") {
  void bootAarPage();
}
