# Provider-agnostic benches — Muse, OpenAI, Gemini

**Date:** 2026-08-25  
**Scope:** one working day on `main`  
**Default stays xAI.** The lab is *company vs company* on the **same** LangGraph topology and the **same** engine.

Muse = **Meta Muse Spark** (chat/completions over `https://api.meta.ai/v1`). Not Microsoft Muse (WHAM / Bleeding Edge world model — that cannot call plays).

## Why these three

| Bench | Company | Surface | Key | Default coach / fast (pin at implement; re-fetch docs) |
| --- | --- | --- | --- | --- |
| **xai** (default both sides) | xAI / SpaceXAI | `@langchain/xai` `ChatXAI` Completions | `XAI_API_KEY` | `grok-4.5` / `grok-4.3` |
| **muse** | Meta | OpenAI-compatible `ChatOpenAI` | `MODEL_API_KEY` (alias `MUSE_API_KEY`) | `muse-spark-1.2` / `muse-spark-1.2` (or 1.1 if 1.2 400s) |
| **openai** | OpenAI | `@langchain/openai` `ChatOpenAI` | `OPENAI_API_KEY` | `gpt-5.6-sol` / `gpt-5.6-luna` (alias `gpt-5.6` → Sol) |
| **gemini** | Google | `@langchain/google-genai` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `gemini-3.1-pro-preview` / `gemini-3.7-flash` |

Sources (fetched 2026-08-25): [Meta Model API](https://ai.developer.meta.com/docs/overview/), [OpenAI GPT-5.6 changelog](https://developers.openai.com/api/docs/changelog) (`gpt-5.6-sol` / `terra` / `luna`), [Gemini models](https://ai.google.dev/gemini-api/docs/models).

**Out of today:** Anthropic, Azure-as-first-class, Microsoft Muse WHAM, local Muse Glimmer, contributor-tier Muse (`muse-spark-1.2-contributor` trains on your prompts — do not default).

## Architecture (unchanged ice)

`createChatModel` today always does `new ChatXAI`. Graphs already take `BaseChatModel`. We add a **profile per side**:

```ts
type ProviderId = "xai" | "muse" | "openai" | "gemini";

type TeamLlmProfile = {
  provider: ProviderId;
  coach: string;
  fast: string;
  aar: string; // that company's post-game AAR
};
```

Adapters return `BaseChatModel`. Muse is **not** a fourth SDK: it is `ChatOpenAI` with `baseURL: "https://api.meta.ai/v1"` and `apiKey` from `MODEL_API_KEY`. OpenAI is the same class, official base. Gemini is the Google GenAI chat class. xAI stays `ChatXAI` (do not silently point ChatOpenAI at `api.x.ai` — reasoning_effort binding is already proven on ChatXAI).

AAR uses **that side’s** profile (Muse reviews Muse’s game). Engine, `Send` fan-out, `cite_check`, Film Room: untouched.

Reasoning: xAI `modelKwargs.reasoning_effort`; Muse/OpenAI map if the Completions field exists else omit; Gemini thinking level if the LangChain binding supports it, else omit. Epoch timeout still 8s; fail → last directive.

Cost: extend `MODEL_PRICES` for the default slugs above; unknown slug → `$` = 0 + log, **call** circuit still applies.

Health (never keys): `{ xai, muse, openai, gemini }`. `llmConfigured` for a match = every **required** provider for that start body has a key.

Denylist on WS/HTML: `XAI_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `MODEL_API_KEY`, `MUSE_API_KEY`.

## CLI / start body

```text
gh simulate --no-llm                         # unchanged
gh simulate --home-provider xai --away-provider muse
gh simulate --home-provider openai --away-provider gemini \
            --home-model gpt-5.6-sol --away-model gemini-3.1-pro-preview
```

POST `/api/match/start` and `/api/series/start` grow optional:

```json
{
  "home": "original-six",
  "away": "expansion",
  "noLlm": false,
  "homeProvider": "xai",
  "awayProvider": "openai",
  "homeCoach": "grok-4.5",
  "awayCoach": "gpt-5.6-sol"
}
```

Omit providers → both xAI. Spectator: **Use LLM** enabled only if the chosen pair has keys. HUD labels `home: xai/grok-4.5` vs `away: muse/muse-spark-1.2` (names only).

`.env.example`:

```
XAI_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
# GOOGLE_API_KEY=   # accepted alias for Gemini
MODEL_API_KEY=      # Meta Muse Spark
# MUSE_API_KEY=     # alias for MODEL_API_KEY
```

## Today’s PRs

| PR | Hours | Ship |
| --- | ---: | --- |
| **A** | 1–2 | `ProviderId`, `TeamLlmProfile`, extract xAI adapter. Zero behavior change. Existing ChatXAI tests still pass. |
| **B** | 2–3 | Adapters: **muse** (ChatOpenAI + Meta base URL), **openai**, **gemini**. Factory `createChatModel({ kind, profile })`. Constructor unit tests only — no network. |
| **C** | 2 | Wire `compileTeamGraph({ profile })` and AAR compile per side. CLI flags + start/series body. `--no-llm` ignores profiles. |
| **D** | 1 | Prices for default slugs, health booleans, HUD labels, protocol denylist, README + this file’s “how to run a lab match”. |

## Fair lab matches (after D)

| Home | Away | Point of the experiment |
| --- | --- | --- |
| xai | muse | SpaceXAI vs Meta Spark |
| xai | openai | SpaceXAI vs GPT-5.6 |
| xai | gemini | SpaceXAI vs Gemini 3 |
| openai | gemini | OpenAI vs Google, xAI unused |
| muse | openai | Meta vs OpenAI |

Same seed playbooks (`original-six` vs `expansion`) so the company is the variable, not the book.

## Risks

- **Slugs rot.** Re-fetch Meta / OpenAI / Gemini model lists the morning of PR B. Do not hard-code retired IDs.
- **Muse contributor tier.** Never default `muse-spark-1.2-contributor` (prompts used for training).
- **Structured output.** If a provider 400s on Zod JSON, epoch falls back to last directive (existing `invokeTeam` contract). Add one test per adapter with FakeListChatModel.
- **Gemini key names.** Accept `GEMINI_API_KEY` first, then `GOOGLE_API_KEY`.
- **Muse key names.** Accept `MODEL_API_KEY` (docs) and `MUSE_API_KEY` (ours, clearer in `.env`).
- **Timeouts.** Muse/OpenAI/Gemini may think longer than 5s/2.5s; keep the 8s graph abort so one slow company cannot stall the other.

## Done tonight

1. Default both benches still xAI.  
2. `simulate --home-provider xai --away-provider muse` compiles two backends.  
3. Same for openai and gemini.  
4. `npm test` green with **no** vendor keys.  
5. Browser never sees `*_API_KEY`.  

Engine, Film Room, and `--no-llm` goldens must not move.

## How to run a lab match

1. Copy `.env.example` → `.env` and set **only** the keys for the companies on the ice. CI never gets these.
2. Same books: `--home original-six --away expansion`.
3. Pick benches. Omit providers → both xAI.

```bash
npm run gh -- simulate --home-provider xai --away-provider muse
npm run gh -- simulate --home-provider openai --away-provider gemini \
  --home-model gpt-5.6-sol --away-model gemini-3.1-pro-preview
```

4. Browser: `npm run web`, pick **Home bench** / **Away bench**, check **Use LLM** (enabled only when `/api/health.providers` is true for that pair). HUD shows `home: xai/grok-4.5 vs away: muse/muse-spark-1.2` — names only.
5. `--no-llm` still skips every vendor. Never default `muse-spark-1.2-contributor`.
