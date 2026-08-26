# Graph_Hockey

Two **LangGraph.js** teams compete in a realistic hockey game. After every win, loss, or tie, each team runs an **After-Action Review** and patches a structured playbook so the next game is not the same.

This is a **localhost Node.js browser game**. The server owns physics, rules, both team graphs, and LLM calls. The browser is a Canvas 2D spectator — it never scores a goal, never sees the opponent's playbook, and **never receives `*_API_KEY`**.

**Status:** private repo, **`main` is playable**. Ice F1 actually shoots (one shot per possession). NZ dump-policy now dumps as a live `clear`, not a stick-carry. F2 chases a live-OZ dump. Live Head Coach finishes the epoch (HC → assemble). AAR rolls match xG into play stats and applies even if the LLM times out. Retrieve excludes lead-protect unless actually leading. `gh series --json` scores distinct chances, offsides, and retrieveTop. Film Room is resimulation; `gh footage --mp4` is a derivative. Handbook: [`docs/FORgasan.md`](docs/FORgasan.md). Experiment log (bank **2/5** after Evaluate 8): [`docs/better-hockey.md`](docs/better-hockey.md).

## What you are looking at

| Layer | Job |
| --- | --- |
| Deterministic engine | 10 Hz NHL-sized 2D rink, 5v5 + goalie, faceoffs, icing, offside, penalties, PP/PK |
| Two team LangGraphs | Head Coach (live macro) + compiled specialists (opt-in). Captain still runs micro. |
| Match orchestrator | Ticks the world, hides private state, collects tactical directives |
| AAR graph | Military-style review after **every** result; cited playbook mutations with caps |
| Browser | Watch the rink, scoreboard, event ticker, AAR, playbook diffs, start a 7-game series |
| Film Room | Auto-recorded game film, AAR jump-to-ice, series improvement ledger (before/after clips) |

LLMs do **not** run every physics tick. Coaches act at decision epochs (faceoff, zone change, special teams, …). Between epochs, players skate the current play in code.

## Stack (v1)

- Node.js ≥ 20.11, TypeScript (strict), **npm** (`package-lock.json`)
- LangGraph.js (`@langchain/langgraph`)
- Default LLM: xAI `XAI_API_KEY`, `https://api.x.ai/v1`, `grok-4.5` (coach/AAR) + `grok-4.3` (specialists)
- Optional per-side benches: **Muse Glimmer** (local OpenAI-compat at `MUSE_BASE_URL`, default `http://127.0.0.1:8080/v1`, `muse-glimmer-30b`), **OpenAI** (`OPENAI_API_KEY`, `gpt-5.6-sol` / `gpt-5.6-luna`), **Gemini** (`GEMINI_API_KEY` / `GOOGLE_API_KEY`, `gemini-3.1-pro-preview` / `gemini-3.7-flash`)
- Node HTTP + WebSocket + Canvas 2D on `127.0.0.1:8787` (v1 is localhost only)
- SQLite for matches, events, playbooks (`sql.js` WASM adapter — see Persistence)

LangSmith tracing is **optional**. If `LANGSMITH_API_KEY` or `LANGCHAIN_API_KEY` is set, the app turns on `LANGSMITH_TRACING` itself. Leave those unset for local/CI.

## Repo layout (target)

See the design doc for the full tree. High level:

```
src/engine/         deterministic world + rules
src/ice/            F1/F2/F3 roles every tick (code, not a graph)
src/agents/         team StateGraphs (home vs away)
src/aar/            post-game AAR graph
src/playbook/       structured plays + capped mutations
src/persist/        SQLite matches/events + replay snapshot
src/sim/            LLM-free replay (resimulation)
src/orchestrator/   match loop
src/server/         Fastify + WS
src/web/            Canvas 2D rink + HUD + Film Room
src/film/           auto-clips, pairing, improvement ledger, optional MP4 export
src/cli/            `gh` headless CLI
src/config.ts       env defaults (boots without keys)
```

Contributor map (folders → LangGraph concepts): [`AGENTS.md`](AGENTS.md).

## Setup

```bash
npm install
cp .env.example .env   # set vendor keys only for live LLM matches
npm test               # no API key required
npm run typecheck
npm run web            # live rink — open http://127.0.0.1:8787/
npm run film           # same server; Film Room at /film
npm run gh -- --help
```

Vendor keys live in `.env` on the Node process. **Never** put them in `src/web/`, client JS, or WebSocket payloads. The browser never calls xAI / Muse / OpenAI / Gemini.

If port **8787** is already taken:

```bash
# Windows PowerShell
$env:GRAPH_HOCKEY_HTTP_PORT=8788; npm run web
```

CORS and WebSocket origin are locked to `http://127.0.0.1:$PORT` and `http://localhost:$PORT`. The server binds loopback only (`GRAPH_HOCKEY_HTTP_HOST`, default `127.0.0.1`).

## Persistence

Match events live in `data/graph-hockey.sqlite` (`matches.config_json` holds the `OpeningSnapshot`). Replay is **LLM-free resimulation**: `advanceWorld` with the match seed plus stored `DirectiveApplied` events. Sparse `applyEvent` kinematics are not used.

This repo uses **sql.js** (SQLite compiled to WASM) in `src/persist/db.ts` instead of `better-sqlite3`. Native `better-sqlite3` needs Visual Studio Build Tools on Windows, and CI has no native addons. The `Db` adapter is the swap point if a native driver is added later. LangGraph checkpoints (later PR) use a **separate** `data/checkpoints.sqlite`.

LangSmith keys in `.env.example` stay commented. CI does not set secrets.

Headless CI path: `gh simulate --no-llm` (`gh` here is this project's CLI, not GitHub's).

```bash
npm run gh -- simulate --no-llm --seed 42 --home original-six --away expansion
npm run gh -- replay --match <id>
npm run gh -- series --games 7 --no-llm --seed 100
```

## Company vs company (lab matches)

Same seed playbooks (`original-six` vs `expansion`). The company is the variable, not the book. Default both sides xAI. See [`docs/PROVIDER-PLAN.md`](docs/PROVIDER-PLAN.md).

```bash
npm run gh -- simulate --home-provider xai --away-provider muse
npm run gh -- simulate --home-provider xai --away-provider openai
npm run gh -- simulate --home-provider openai --away-provider gemini \
  --home-model gpt-5.6-sol --away-model gemini-3.1-pro-preview
```

`--no-llm` ignores provider flags. Muse is local Glimmer (no Meta token bill). Never use `muse-spark-1.2-contributor` (prompts used for training).

Stub graphs use the seed-book default 5v5 play (`5v5-122-forecheck` vs `5v5-212-forecheck`) and do not call any vendor.

**Short periods for tests/CI:** a full game is 3×20:00 at 10 Hz (36,000 live ticks). Set `GRAPH_HOCKEY_PERIOD_SECONDS=5` so unit tests and CI finish quickly. OT scales as 5:00/20:00 unless `GRAPH_HOCKEY_OT_SECONDS` is set. Golden hash fixtures in this repo were captured with a 5-second period.

```bash
# Windows PowerShell
$env:GRAPH_HOCKEY_PERIOD_SECONDS=5; npm test
```

## Watch a match (available now)

`npm run web` serves the Canvas 2D rink. **Start stays `--no-llm`** (stub graphs, zero vendor calls) unless you check **Use LLM**.

- `POST /api/match/start` `{ home, away, seed, noLlm, periodSeconds?, homeProvider?, awayProvider?, homeCoach?, awayCoach? }` starts `runMatch` in the background (`noLlm` defaults **true**; omit providers → both xAI)
- `noLlm: false` is allowed only when **both** chosen providers have keys (or tests inject `FakeListChatModel`)
- Optional **Use LLM** checkbox is enabled only when `GET /api/health.providers` is true for the selected pair
- HUD: live `$` / prompt+output tokens / calls per side (`CostTick`)
- `POST /api/match/stop` aborts the in-flight match
- `POST /api/series/start` `{ games: 7, home, away, seed, noLlm, periodSeconds? }` runs a self-play series (`gameSeed = seed + gameIndex`)
- `POST /api/series/stop` aborts the in-flight series (same as match stop)
- `GET /api/series` live series/match status
- `GET /api/health` `{ ok, llmConfigured, langsmith, providers: { xai, muse, openai, gemini } }` (booleans, never secrets)
- HUD benches: `home: xai/grok-4.5 vs away: muse/muse-glimmer-30b` (names only)
- `WS /ws` streams 10 Hz `SpectatorFrame` snapshots plus `cost` and inspect-side `inspect`
- Inspect toggle **none / home / away** — the play **name** is sent only for the inspected side (never the opponent `playId`)
- After `match_over`, **AAR / playbook** opens `/aar?match=` (supposed / actual / why / ops). **Watch** on `eventIds` jumps to `/film?match=&event=`

The start form defaults to **5 second** periods so a demo is watchable. Engine/config default remains **1200 s** (3×20:00) unless you pass `periodSeconds` or set `GRAPH_HOCKEY_PERIOD_SECONDS`.

**Start series (7)** runs seven games in a row. After each game, AAR auto-applies (unless `--no-llm`) so playbooks evolve. Restore-safe JSON snapshots land in `data/playbook-snapshots/<seriesId>/` (`before.json` plus `after-game-0.json` …).

```bash
npm run gh -- series --games 7 --no-llm --seed 100 --home original-six --away expansion
```

`--no-llm` series uses **5 second** periods unless you set `GRAPH_HOCKEY_PERIOD_SECONDS` or `--period-seconds`. Each game’s seed is `seed + gameIndex` (game 0 uses `seed`). After each game’s AAR, both teams get an `improvement_ledger` row. Open `/film?series=ID` (or `/film/series/ID`) for the dual-rink board.

## Review footage (available now)

Every finished match is **auto-recorded** as deterministic game film (**resimulation** is canonical). `--no-record` skips the clip index (CI goldens). Optional derivative: `gh footage --match ID --mp4` writes `data/film-export/` (gitignored; needs `ffmpeg`). The Film Room:

- builds clips around goals, chances, turnovers, penalties, and AAR citations
- plays them on the same Canvas rink (scrub, 0.25×–2×)
- `/film` is the scripted demo series; `/film?match=ID` plays real match clips
- `/film?series=ID` and `/film/series/ID` are the series improvement board (dual-rink G0 vs last)
- `/aar?match=ID` is the post-game AAR + playbook version diff (`GET /api/aar/:matchId/:side`, `GET /api/playbook/:team?diff=1`)
- `GET /api/series/:id/improvement` returns ledger + deltas + paired clips (same play + zone, Jaccard ≥ 0.3 fallback)

```bash
npm install
npm test
npm run film
# open http://127.0.0.1:8787/film
# after a match: http://127.0.0.1:8787/film?match=ID
# after a series: http://127.0.0.1:8787/film?series=ID
npx tsx src/cli/main.ts footage --match ID
npx tsx src/cli/main.ts footage --match ID --mp4
npx tsx src/cli/main.ts footage --series ID --compare 0,6
```

## Way forward

Live-52 (Grok vs Muse, 3×60s): **Expansion 3–1**, opening plays `5v5-122-forecheck` vs `stretch-pass-nz`, **211/212 epochs ok**, AAR applied (books v3/v5). Next: shot cooldown, captain-micro timeouts, offside rate, goalie-as-scorer audit, then a 7-game LLM series. Details: [`docs/FORgasan.md`](docs/FORgasan.md#where-to-go-next).

## Implementation order

Engine → stub graphs (`--no-llm`) → **watchable browser rink** → Film Room on real matches → LLM coaches → AAR → 7-game series → paired film ledger.

Full PR list: [`docs/DESIGN.md`](docs/DESIGN.md#pr-plan).

## License

MIT. See [`LICENSE`](LICENSE).
