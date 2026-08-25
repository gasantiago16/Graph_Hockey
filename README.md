# Graph_Hockey

Two **LangGraph.js** teams compete in a realistic hockey game. After every win, loss, or tie, each team runs an **After-Action Review** and patches a structured playbook so the next game is not the same.

This is a **localhost Node.js browser game**. The server owns physics, rules, both team graphs, and xAI calls. The browser is a Canvas 2D spectator — it never scores a goal, never sees the opponent's playbook, and **never receives `XAI_API_KEY`**.

**Status:** private repo + approved design + **watchable `--no-llm` rink** + Film Room demo. Implementation follows the PR plan in [`docs/DESIGN.md`](docs/DESIGN.md).

## What you are looking at

| Layer | Job |
| --- | --- |
| Deterministic engine | 10 Hz NHL-sized 2D rink, 5v5 + goalie, faceoffs, icing, offside, penalties, PP/PK |
| Two team LangGraphs | Head Coach + OC / DC / special teams / goalie / scout / captain |
| Match orchestrator | Ticks the world, hides private state, collects tactical directives |
| AAR graph | Military-style review after **every** result; cited playbook mutations with caps |
| Browser | Watch the rink, scoreboard, event ticker, AAR, playbook diffs, start a 7-game series |
| Film Room | Auto-recorded game film, AAR jump-to-ice, series improvement ledger (before/after clips) |

LLMs do **not** run every physics tick. Coaches act at decision epochs (faceoff, zone change, special teams, …). Between epochs, players skate the current play in code.

## Stack (v1)

- Node.js ≥ 20.11, TypeScript (strict), **npm** (`package-lock.json`)
- LangGraph.js (`@langchain/langgraph`)
- xAI only: `XAI_API_KEY`, `https://api.x.ai/v1`, `grok-4.5` (coach/AAR) + `grok-4.3` (specialists)
- Node HTTP + WebSocket + Canvas 2D on `127.0.0.1:8787` (v1 is localhost only)
- SQLite for matches, events, playbooks (`sql.js` WASM adapter — see Persistence)

LangSmith tracing is **optional**. If `LANGSMITH_API_KEY` or `LANGCHAIN_API_KEY` is set, the app turns on `LANGSMITH_TRACING` itself. Leave those unset for local/CI.

## Repo layout (target)

See the design doc for the full tree. High level:

```
src/engine/         deterministic world + rules
src/agents/         team StateGraphs (home vs away)
src/aar/            post-game AAR graph
src/playbook/       structured plays + capped mutations
src/persist/        SQLite matches/events + replay snapshot
src/sim/            LLM-free replay (resimulation)
src/orchestrator/   match loop
src/server/         Fastify + WS
src/web/            Canvas 2D rink + HUD + Film Room
src/film/           auto-clips, pairing, improvement ledger
src/cli/            `gh` headless CLI
src/config.ts       env defaults (boots without keys)
```

Contributor map (folders → LangGraph concepts): [`AGENTS.md`](AGENTS.md).

## Setup

```bash
npm install
cp .env.example .env   # set XAI_API_KEY for live LLM matches only
npm test               # no API key required
npm run typecheck
npm run web            # live rink — open http://127.0.0.1:8787/
npm run film           # same server; Film Room at /film
npm run gh -- --help
```

`XAI_API_KEY` lives in `.env` on the Node process. **Never** put it in `src/web/`, client JS, or WebSocket payloads. The browser never calls xAI.

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

Stub graphs use the seed-book default 5v5 play (`5v5-122-forecheck` vs `5v5-212-forecheck`) and do not call xAI.

**Short periods for tests/CI:** a full game is 3×20:00 at 10 Hz (36,000 live ticks). Set `GRAPH_HOCKEY_PERIOD_SECONDS=5` so unit tests and CI finish quickly. OT scales as 5:00/20:00 unless `GRAPH_HOCKEY_OT_SECONDS` is set. Golden hash fixtures in this repo were captured with a 5-second period.

```bash
# Windows PowerShell
$env:GRAPH_HOCKEY_PERIOD_SECONDS=5; npm test
```

## Watch a match (available now)

`npm run web` serves the Canvas 2D rink. **Start stays `--no-llm`** (stub graphs, zero xAI) unless you check **Use LLM**.

- `POST /api/match/start` `{ home, away, seed, noLlm, periodSeconds? }` starts `runMatch` in the background (`noLlm` defaults **true**)
- `noLlm: false` is allowed only when `XAI_API_KEY` is set on the server (or tests inject `FakeListChatModel`)
- Optional **Use LLM** checkbox is enabled only when `GET /api/health` reports `llmConfigured`
- HUD: live `$` / prompt+output tokens / calls per side (`CostTick`)
- `POST /api/match/stop` aborts the in-flight match
- `POST /api/series/start` `{ games: 7, home, away, seed, noLlm, periodSeconds? }` runs a self-play series (`gameSeed = seed + gameIndex`)
- `POST /api/series/stop` aborts the in-flight series (same as match stop)
- `GET /api/series` live series/match status
- `GET /api/health` `{ ok, llmConfigured, langsmith }`
- `WS /ws` streams 10 Hz `SpectatorFrame` snapshots plus `cost` and inspect-side `inspect`
- Inspect toggle **none / home / away** — the play **name** is sent only for the inspected side (never the opponent `playId`)
- After `match_over`, **AAR / playbook** opens `/aar?match=` (supposed / actual / why / ops). **Watch** on `eventIds` jumps to `/film?match=&event=`

The start form defaults to **5 second** periods so a demo is watchable. Engine/config default remains **1200 s** (3×20:00) unless you pass `periodSeconds` or set `GRAPH_HOCKEY_PERIOD_SECONDS`.

**Start series (7)** runs seven games in a row. After each game, AAR auto-applies (unless `--no-llm`) so playbooks evolve. Restore-safe JSON snapshots land in `data/playbook-snapshots/<seriesId>/` (`before.json` plus `after-game-0.json` …).

```bash
npm run gh -- series --games 7 --no-llm --seed 100 --home original-six --away expansion
```

`--no-llm` series uses **5 second** periods unless you set `GRAPH_HOCKEY_PERIOD_SECONDS` or `--period-seconds`. Each game’s seed is `seed + gameIndex` (game 0 uses `seed`). Recordings store `series_id` + `game_index` for the later improvement board.

## Review footage (available now)

Every finished match is **auto-recorded** as deterministic game film (resimulation — no MP4). `--no-record` skips the clip index (CI goldens). The Film Room:

- builds clips around goals, chances, turnovers, penalties, and AAR citations
- plays them on the same Canvas rink (scrub, 0.25×–2×)
- `/film` is the scripted demo series; `/film?match=ID` plays real match clips
- `/aar?match=ID` is the post-game AAR + playbook version diff (`GET /api/aar/:matchId/:side`, `GET /api/playbook/:team?diff=1`)
- series pairing / improvement board is a later PR (`recordings.series_id` is stored now)

```bash
npm install
npm test
npm run film
# open http://127.0.0.1:8787/film
# after a match: http://127.0.0.1:8787/film?match=ID
npx tsx src/cli/main.ts footage --match ID
```

## Implementation order

Engine → stub graphs (`--no-llm`) → **watchable browser rink** → Film Room on real matches → LLM coaches → AAR → 7-game series → paired film ledger.

Full PR list: [`docs/DESIGN.md`](docs/DESIGN.md#pr-plan).

## License

MIT. See [`LICENSE`](LICENSE).
