# Graph_Hockey

Two **LangGraph.js** teams compete in a realistic hockey game. After every win, loss, or tie, each team runs an **After-Action Review** and patches a structured playbook so the next game is not the same.

This is a **localhost Node.js browser game**. The server owns physics, rules, both team graphs, and xAI calls. The browser is a Canvas 2D spectator — it never scores a goal and never sees the opponent's playbook.

**Status:** private repo + approved design. Implementation follows the PR plan in [`docs/DESIGN.md`](docs/DESIGN.md).

## What you are looking at

| Layer | Job |
| --- | --- |
| Deterministic engine | 10 Hz NHL-sized 2D rink, 5v5 + goalie, faceoffs, icing, offside, penalties, PP/PK |
| Two team LangGraphs | Head Coach + OC / DC / special teams / goalie / scout / captain |
| Match orchestrator | Ticks the world, hides private state, collects tactical directives |
| AAR graph | Military-style review after **every** result; cited playbook mutations with caps |
| Browser | Watch the rink, scoreboard, event ticker, AAR, playbook diffs, start a 7-game series |

LLMs do **not** run every physics tick. Coaches act at decision epochs (faceoff, zone change, special teams, …). Between epochs, players skate the current play in code.

## Stack (v1)

- Node.js ≥ 20.11, TypeScript (strict), **pnpm**
- LangGraph.js (`@langchain/langgraph`)
- xAI only: `XAI_API_KEY`, `https://api.x.ai/v1`, `grok-4.5` (coach/AAR) + `grok-4.3` (specialists)
- Fastify + WebSocket + Canvas 2D on `127.0.0.1:8787`
- SQLite for matches, events, playbooks

## Repo layout (target)

See the design doc for the full tree. High level:

```
src/engine/         deterministic world + rules
src/agents/         team StateGraphs (home vs away)
src/aar/            post-game AAR graph
src/playbook/       structured plays + capped mutations
src/orchestrator/   match loop
src/server/         Fastify + WS
src/web/            Canvas 2D rink + HUD
```

## Implementation order

Engine → stub graphs (`--no-llm`) → **watchable browser rink** → LLM coaches → AAR → 7-game series.

Full PR list: [`docs/DESIGN.md`](docs/DESIGN.md#pr-plan).

## Setup (once code exists)

```bash
pnpm install
cp .env.example .env   # set XAI_API_KEY; LangSmith optional
pnpm test              # no API key required
pnpm web               # http://127.0.0.1:8787
```

Headless CI path: `gh simulate --no-llm` (the `gh` here is this project's CLI, not GitHub's).

## License

Private repository. All rights reserved until a license is added.
