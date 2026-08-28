/** Summarize data/factorial-b/*.json into a cell table. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "data", "factorial-b");
const files = readdirSync(dir).filter((f) => f.startsWith("b-") && f.endsWith(".json"));

function mean(xs) {
  return xs.length === 0 ? NaN : xs.reduce((s, n) => s + n, 0) / xs.length;
}
function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, n) => s + (n - m) ** 2, 0) / (xs.length - 1));
}
function se(xs) {
  return xs.length === 0 ? NaN : sd(xs) / Math.sqrt(xs.length);
}

const rows = [];
for (const f of files) {
  const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const m = p.matches ?? [];
  const homeCh = m.map((g) => g.home?.distinctChances ?? 0);
  const awayCh = m.map((g) => g.away?.distinctChances ?? 0);
  const homeOff = m.map((g) => g.home?.offsides ?? 0);
  const awayOff = m.map((g) => g.away?.offsides ?? 0);
  const v0 = m[0]?.playbookVersions;
  const vN = m.at(-1)?.playbookVersions;
  const freeze =
    v0 && vN && v0.home === vN.home && v0.away === vN.away;
  rows.push({
    id: p.seriesId ?? f.replace(/\.json$/, ""),
    seed: p.seed,
    arm: String(p.seriesId ?? f).replace(/^b-/, "").replace(/-s\d+$/, ""),
    homeMu: mean(homeCh),
    awayMu: mean(awayCh),
    combined: mean(homeCh.map((h, i) => h + awayCh[i])),
    homeOffMax: Math.max(0, ...homeOff),
    awayOffMax: Math.max(0, ...awayOff),
    freeze,
    v0: v0 ? `${v0.home}/${v0.away}` : "?",
    vN: vN ? `${vN.home}/${vN.away}` : "?",
    retrieve: `${m[0]?.home?.retrieveTopId ?? "?"}/${m[0]?.away?.retrieveTopId ?? "?"}`,
    open: `${m[0]?.home?.openingPlayId ?? "?"}/${m[0]?.away?.openingPlayId ?? "?"}`,
  });
}

rows.sort((a, b) => a.arm.localeCompare(b.arm) || a.seed - b.seed);

const byArm = new Map();
for (const r of rows) {
  const list = byArm.get(r.arm) ?? [];
  list.push(r);
  byArm.set(r.arm, list);
}

const lines = [];
lines.push(`# Factorial B — ${rows.length} cells`);
lines.push("");
lines.push("| arm | n | home μ | away μ | combined μ | freeze |");
lines.push("| --- | ---: | ---: | ---: | ---: | --- |");
for (const [arm, list] of [...byArm.entries()].sort()) {
  const h = list.map((r) => r.homeMu);
  const a = list.map((r) => r.awayMu);
  const c = list.map((r) => r.combined);
  const fr = list.every((r) => r.freeze) ? "yes" : "NO";
  lines.push(
    `| ${arm} | ${list.length} | ${mean(h).toFixed(2)}±${se(h).toFixed(2)} | ${mean(a).toFixed(2)}±${se(a).toFixed(2)} | ${mean(c).toFixed(2)}±${se(c).toFixed(2)} | ${fr} |`,
  );
}
lines.push("");
lines.push("| id | seed | home μ | away μ | comb | offs max | v0→vN | retrieve g0 |");
lines.push("| --- | ---: | ---: | ---: | ---: | --- | --- | --- |");
for (const r of rows) {
  lines.push(
    `| ${r.id} | ${r.seed} | ${r.homeMu.toFixed(2)} | ${r.awayMu.toFixed(2)} | ${r.combined.toFixed(2)} | ${r.homeOffMax}/${r.awayOffMax} | ${r.v0}→${r.vN} | ${r.retrieve} |`,
  );
}
const md = lines.join("\n") + "\n";
writeFileSync(join(dir, "SUMMARY.md"), md);
console.log(md);
