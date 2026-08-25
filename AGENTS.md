# Graph_Hockey — folder map

Single TypeScript package. The learning goal is to make LangGraph concepts visible in the tree. The engine is not a graph; the graphs cannot score goals.

## Folders → LangGraph concepts

| Folder | Role | LangGraph analog |
| --- | --- | --- |
| `src/engine/` | Deterministic 10 Hz physics + rules. Sole authority for puck, players, scoring. | Environment / tools. Not a `StateGraph`. |
| `src/agents/` | Two compiled team graphs (`homeTeamGraph`, `awayTeamGraph`). Head Coach + specialist subgraphs. | `StateGraph` / `compile`, `StateSchema` + reducers, `Send` fan-out, `Command` routing, subgraphs. |
| `src/aar/` | Post-game After-Action Review graph (runs after every result). | A **third** compiled `StateGraph`. Conditional edges (`winner_lens` / `loser_lens`), `cite_check`. |
| `src/playbook/` | Structured plays (data, not prompts). AAR emits capped patches. | Long-term store vs short-term checkpointer threads. |
| `src/orchestrator/` | Match host: ticks world, hides private state, collects directives. | Not an LLM. Invokes each team graph with a per-epoch `thread_id`. |
| `src/llm/` | xAI-only `ChatXAI` factories, Zod schemas, circuit breaker. | Structured output; `createChatModel` inject so tests use `FakeListChatModel`. |
| `src/persist/` | SQLite matches/events + checkpointer. | `MemorySaver` (tests) vs `SqliteSaver` (CLI). |
| `src/film/` | Auto-clips, pairing, series improvement ledger. | Downstream of the event log — resimulation, not video. |
| `src/web/` | Canvas 2D spectator + Film Room. **Never** calls xAI, **never** gets `XAI_API_KEY`. | Renderer of server snapshots. |
| `src/cli/` | Headless `gh` for CI (`simulate --no-llm`, replay, aar, playbook, series, footage). | Invokes graphs without a browser. |
| `src/config.ts` | Env defaults. LangSmith ON iff a key is present. | No secrets required to boot. |

## Rules of the road

- Provider is **xAI only** (`XAI_API_KEY`, `https://api.x.ai/v1`). Do not add OpenAI/Anthropic clients.
- Tests and CI must pass **without** `XAI_API_KEY`. LLM calls must stay mockable.
- Browser binds `127.0.0.1` only. Do not put keys in `src/web/` or WS payloads.
- Never commit `.env` or keys.
