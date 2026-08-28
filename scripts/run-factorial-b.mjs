/**
 * Frozen HS/SH × {live, null, seed} factorial (campaign B).
 * Live Head Coach, AAR propose = code digest, books do not bump.
 * Both benches xAI (Glimmer down; removes provider confound).
 *
 *   node scripts/run-factorial-b.mjs
 * Resumable: skips arms whose JSON already exists.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const outDir = join(root, "data", "factorial-b");
const snap = join(root, "data", "playbook-snapshots", "ser-emp-26", "after-game-6.json");
const SEEDS = [7, 11, 19, 23, 29];
const ARMS = [
  { id: "ss", flags: [] },
  {
    id: "hs-live",
    flags: ["--from-snapshot", snap, "--home-from-snapshot", "--away-seed"],
  },
  {
    id: "hs-null",
    flags: ["--from-snapshot", snap, "--home-from-snapshot", "--away-seed", "--null-retrieve"],
  },
  {
    id: "sh-live",
    flags: ["--from-snapshot", snap, "--away-from-snapshot", "--home-seed"],
  },
  {
    id: "sh-null",
    flags: ["--from-snapshot", snap, "--away-from-snapshot", "--home-seed", "--null-retrieve"],
  },
];

function loadDotenv(path) {
  const out = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function jobs() {
  const list = [];
  for (const seed of SEEDS) {
    for (const arm of ARMS) {
      const id = `b-${arm.id}-s${seed}`;
      list.push({
        id,
        seed,
        arm: arm.id,
        jsonPath: join(outDir, `${id}.json`),
        dbPath: join(outDir, `${id}.sqlite`),
        logPath: join(outDir, `${id}.log`),
        flags: arm.flags,
      });
    }
  }
  return list;
}

function runOne(job, env) {
  return new Promise((resolve) => {
    const args = [
      "tsx",
      "src/cli/main.ts",
      "series",
      "--games",
      "7",
      "--period-seconds",
      "20",
      "--seed",
      String(job.seed),
      "--id",
      job.id,
      "--db",
      job.dbPath,
      "--aar-mode",
      "propose",
      "--no-record",
      "--json",
      "--home",
      "original-six",
      "--away",
      "expansion",
      "--home-provider",
      "xai",
      "--away-provider",
      "xai",
      ...job.flags,
    ];
    const chunks = [];
    const child = spawn("npx", args, {
      cwd: root,
      env,
      shell: process.platform === "win32",
    });
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    child.on("close", (code) => {
      const text = Buffer.concat(chunks).toString("utf8");
      writeFileSync(job.logPath, text);
      resolve({ code: code ?? 1, text });
    });
  });
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const envFile = loadDotenv(join(root, ".env"));
const env = { ...process.env, ...envFile };
delete env.GRAPH_HOCKEY_CAPTAIN;
if (!env.GRAPH_HOCKEY_EPOCH_TIMEOUT_MS) env.GRAPH_HOCKEY_EPOCH_TIMEOUT_MS = "8000";

if (!existsSync(snap)) {
  console.error(`missing snapshot ${snap}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const all = jobs();
const todo = all.filter((j) => !existsSync(j.jsonPath));
console.log(`factorial-b  ${all.length} cells  remaining ${todo.length}  snapshot ser-emp-26/after-game-6`);
console.log(`xai=${Boolean(env.XAI_API_KEY)}  timeoutMs=${env.GRAPH_HOCKEY_EPOCH_TIMEOUT_MS}  captain unset`);

let failed = 0;
for (const job of todo) {
  console.log(`START ${job.id}`);
  const t0 = Date.now();
  const { code, text } = await runOne(job, env);
  const payload = extractJson(text);
  if (code !== 0 || !payload) {
    failed += 1;
    console.error(`FAIL ${job.id}  exit=${code}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    continue;
  }
  writeFileSync(job.jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  const books = payload.matches?.map((m) => `v${m.playbookVersions?.home}/${m.playbookVersions?.away}`) ?? [];
  console.log(
    `OK ${job.id}  ${((Date.now() - t0) / 1000).toFixed(0)}s  books ${books[0] ?? "?"}→${books.at(-1) ?? "?"}  combined? see json`,
  );
}

const done = all.filter((j) => existsSync(j.jsonPath)).length;
writeFileSync(
  join(outDir, "manifest.json"),
  `${JSON.stringify({ snapshot: snap, seeds: SEEDS, arms: ARMS.map((a) => a.id), done, total: all.length, failed, at: new Date().toISOString() }, null, 2)}\n`,
);
console.log(`factorial-b done  json=${done}/${all.length}  fail=${failed}`);
process.exit(failed > 0 && done < all.length ? 1 : 0);
