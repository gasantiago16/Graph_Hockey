# Knowledge and learning — Graph_Hockey (LangGraph staffs)

| Field | Value |
| --- | --- |
| **Date** | 2026-08-26 |
| **Status** | Cycle 3 attempt 1. Bank **2/5**. Write path proven. Retention **survive** proven (`ser-retain-1`). **Transfer** of a different skill **failed** (still 122). Evaluate 11 not credited. |
| **Scoreboard** | [`better-hockey.md`](better-hockey.md) |
| **Bibliography** | [`ANNOTATED_BIBLIOGRAPHY.md`](ANNOTATED_BIBLIOGRAPHY.md) |
| **Handbook** | [`FORgasan.md`](FORgasan.md) |

This document is the plan to **prove** three different things we have been saying as one sentence. Deep-research review (2026-08-26) says they are not the same proof.

---

## Key Decisions

1. **Split proofs: write path, retention/transfer, hockey quality.** A version bump is (1). Carry-forward books into a new series is (2). Δ xG vs previous-best is (3). Do not cash (3) for ice-only PRs as “the graph learned,” and do not cash (1) as (2).

2. **Playbooks stay on the agent side of the Sutton cut.** `src/ice/` and `src/engine/` are environment. AAR + retrieve + SQLite `playbooks` are agent memory. Experimenter ice edits change the MDP; they are not LangGraph learning (Sutton & Barto Ch. 3.1; Jiang 2019).

3. **AAR is background memory writing.** LangGraph documents hot-path vs background writes; background exists to keep live-turn latency down. Live epochs stay 12s. Do not raise timeouts. Do not put Store `put` on the 10 Hz tick.

4. **Retention Evaluate does not require LangGraph `BaseStore`.** Official Store is `compile({ store })`. We do not do that today (`compileTeamGraph` is checkpointer-only). Proving C6 needs **not wiping** `latestPlaybook` between series A and series B. Wiring `BaseStore` is an honesty/alignment PR, not the proof.

5. **Transfer test is retrieve-and-use, not stats on 122.** Home `retrieveTop` 0/6 after the lead-protect gate can be success (illegal sheet gone). Proof that *memory changed the policy* is: later episode executes a different play or different params **because** retrieve saw the stored book, vs a seed-fresh twin. Quality vs `--no-llm` still required for *beneficial* transfer (Feng et al.: retrieved skills can hurt).

6. **Quality bank stays 5 Δ xG credits.** Retention gets its **own** pass/fail and does **not** steal a bank slot. Ice PRs that fix chance mean may still take a counting quality Evaluate.

7. **Carry-forward before more ice, unless Glimmer is down.** R1/R2/H1 shipped. Retention Evaluate ran. Glimmer is up on `:8080` this session; do not restart 8787. Timeouts not raised.

---

## Progress (honest, measured)

### Proof 1 — Write path (proven)

Inside **one** sqlite, live AAR applies. Books v1→v8. `--no-llm` twin stays v1, `retrieveTopChanged` 0/6, `booksMoved` false. Snapshots: `data/playbook-snapshots/<seriesId>/before.json` + `after-game-N.json`. Code: `ensureSeedPlaybooks` then `latestPlaybook` each game (`src/sim/series.ts`, `src/persist/playbooks.ts`).

This is CoALA “learning = write LTM” **within a series**. It is also LangGraph’s background-write pattern (AAR after the result, not on the 12s epoch).

### Proof 2 — Maintain knowledge (survive proven; transfer failed)

`--from-snapshot` `7edabe9` restores snapshot books before game 0. `ser-retain-1` carried `ser-emp-17` after-game-6:

| Check | Result |
| --- | --- |
| g0 version > 1 | **pass** v8→v9 (seed-fresh is v1→v2) |
| g0 hockey / stats differ | **pass** xG 0.386 vs seed-fresh 0.152; 2–2 vs 2–6 |
| `--no-llm` still v1 | **pass** (`ser-emp-18-nollm`) |
| Later game executes a **different** retrieveTop | **fail** — still `5v5-122-forecheck` 0/6. After 14 games 122 net **+4.05**; `oz-cycle-low` net 0 |

Checkpointer is still `MemorySaver` per-epoch. Long-term knowledge lives in SQLite playbooks. Carry-forward **reads** that store. Retrieve ranking by **cumulative** net xG does not: OZ 122 keeps leftover xG-for; DZ beatings are billed to `5v5-breakout-d-to-winger`; loser `add_counter` on 122 adds `COUNTER_BONUS` 0.25. Confirmatory memory.

Voyager / ExpeL / Hu: we ran the protocol. Survival holds. Transfer of a *new* skill does not.

### Proof 3 — Get better at hockey (bank 2/5)

| | Then (`ser-emp-7`) | Now |
| --- | ---: | ---: |
| Lead-protect while losing | g4–g6 locked | **0** skating hits |
| Live offsides | 0–2 (control storms) | live **0–2** |
| Credited home Δ xG | — | **−0.376** then **−0.071** |
| Last two series Δ xG | — | Evaluate 11 **+0.443** (uncashed: chance mean 4.71, g2 home 3 offs, pairs 3) |
| Pairs floor | 0 | credited **4** |
| Bank | 0 | **2 / 5** |

Evaluate 11 g0 was a **2–6** collapse (OZ 8s / DZ 26s, xG 0.152) vs `--no-llm` **4–2** / xG 0.699 / OZ 35s on the same F2-outlet ice. F2 `alongPuck+10` the instant the puck nicks OZ is the offs leak (tick 46 seq 133 on 122, live only). Do not cash Δ +0.443.

Home still opens **`5v5-122-forecheck`** every live game, including the carry series. AAR boosts 122 on wins/ties. That is confirmatory memory on the default play, not a new skill (C7).

---

## How LangGraph says memory works (mapped to this repo)

```mermaid
flowchart TB
  subgraph short ["Short-term — LangGraph checkpointer"]
    Epoch["per-epoch thread_id\nMemorySaver RAM"]
  end
  subgraph long ["Long-term — application store today"]
    PB[(playbooks SQLite\nteam_id + version)]
    Snap[JSON snapshots on disk]
  end
  subgraph env ["Environment — not the graph"]
    Ice["src/ice + src/engine\n10 Hz"]
  end
  Live["live epoch: retrieve_plays → HC → assemble"]
  AAR["AAR background write\n--aar-mode code"]
  Ice --> Live
  Epoch --> Live
  PB --> Live
  Live --> Ice
  Live --> AAR
  AAR --> PB
  PB --> Snap
```

| CoALA / LangGraph type | In Graph_Hockey | Hot or background |
| --- | --- | --- |
| Working / short-term | Per-epoch graph state + checkpointer | Hot (12s) |
| Semantic | `play.stats` xG, `counters`, family | Background AAR |
| Episodic | Event log, film clips, snapshots | After the game |
| Procedural | Seed JSON assignments + ice code; AAR `boost` / `tweak` | Ice is env; play JSON is agent |
| Grounding | `advanceWorld` | Every tick |

**We do not compile with `store`.** Official long-term memory is `builder.compile({ checkpointer, store })` and nodes `runtime.store.put/search`. Ours is SQLite beside the graph. Research verdict on “this *is* LangGraph Store”: **fails**. Research verdict on “this *can* be valid agent LTM”: **holds** if the next episode actually reads it.

---

## Goals

- Prove **retention**: series B opens from series A’s after-game-6 books; a seed-fresh twin does not.
- Prove **transfer**: at least one later game **executes** a non-seed play (or non-seed params) because retrieve ranked the stored book, not because ice changed.
- Keep proving **quality**: bank to 5 on Δ xG with the existing floors (pairs, chance mean, offsides, no lead-protect skating).
- Optional later: wrap playbooks in `BaseStore` so the pitch matches LangGraph docs.

## Non-goals

- Fine-tuning grok / Glimmer weights. CoALA lists that as one learning mode; it is not v1.
- Per-skater LangGraphs. Captain micro. Raising timeouts. Restarting 8787. Restarting Glimmer unless asked.
- Calling ice PRs “the graph learned.”
- Implementing `--aar-mode code` as `noLlm: true`.
- Spending a quality-bank slot on cosmetics (PR-7 scorecard flag).

---

## Proposed design

### Retention protocol (new counting *learning* Evaluate, not a quality-bank steal)

Three arms, same seed 7, 7×20s, captain unset, timeouts not raised:

| Arm | Books at g0 | LLM | What it proves |
| --- | --- | --- | --- |
| **Carry** | Load `ser-emp-15` (or latest credited) `after-game-6` original-six + expansion | xAI vs Glimmer, `--aar-mode code` | Memory survived |
| **Seed-fresh live** | Seed JSON v1, fresh db | same | Isolates carry vs “this ice always looks like that” |
| **`--no-llm` control** | Seed v1 | none | Write path still honest on the fresh arm |

**Pass (retention):** carry g0 `playbookVersion` > 1 **and** carry g0 `retrieveTopId` or play `stats` (xG/games) **differ** from seed-fresh g0 **and** `--no-llm` still v1.

**Pass (beneficial transfer, optional same run):** carry home Δ xG or chance mean **strictly better** than seed-fresh live, with offsides 0–2 and no lead-protect skating.

**Fail honestly:** if carry and seed-fresh are identical hockey and identical retrieve, the stored book is dead weight (confirmatory 122). Then the next PR is retrieve/AAR targeting, not more ice.

CLI sketch (one flag, no new architecture):

```text
npm run gh -- series --from-snapshot data/playbook-snapshots/ser-emp-15/after-game-6.json
  --games 7 --period-seconds 20 --seed 7
  --home-provider xai --away-provider muse --aar-mode code
  --db data/ser-retain-1.sqlite --id ser-retain-1 --json
```

`runSeries` already calls `currentBook = latestPlaybook ?? seed`. Add an insert of snapshot rows **before** the loop when `--from-snapshot` is set. Do not call `resetPlaybookToSeed`. `--no-llm` must refuse to apply AAR (already true).

### Transfer instrumentation (merge-without-Evaluate if it is JSON-only)

`gh series --json` already prints `retrieveTopId` and `openingPlayId`. Add **executed play mix**: seconds or chance share per `playId` (we have `playUsage` in AAR). Print `openingPlayId === retrieveTopId` rate. Do not replace Δ xG.

### Quality track (cycle 3, existing bar)

H1 F2 OZ outlet shipped (`be9be08`) and **failed** Evaluate 11 (offs + chance mean). Next ice: F2 outlet only when `alongPuck > BLUE+8` (established OZ), else support-below. That is **environment**. Evaluate 12 counts for the quality bank. Transfer PR (retrieve/AAR) is the next *learning* slice after the offs band is honest.

Glimmer is **up** this session. Do not restart 8787. Timeouts not raised.

### Optional LangGraph Store adapter (later)

A `PlaybookStore` implementing `BaseStore`: namespace `["playbook", teamId]`, key `version` or `latest`. `compileTeamGraph({ store })`. Retrieve node reads `runtime.store`. **Do not** block retention on this. Pitch honesty only.

---

## PR Plan

| PR | Title | Files | Deps | Evaluate? |
| --- | --- | --- | --- | --- |
| **Docs** | Document three proofs + bibliography | `docs/*`, README | none | **Never** |
| **PR-R1** | `--from-snapshot` / `--from-db` seed series from stored books | `src/sim/series.ts`, `src/cli/main.ts`, tests | Docs | **shipped `7edabe9`.** Retention `ser-retain-1` ran (survive yes, transfer no). Does **not** increment quality bank. |
| **PR-R2** | Series JSON: executed play mix / usage share | `src/film/chances.ts`, CLI, tests | none | **shipped `dd4cd03`.** Never an Evaluate. |
| **PR-H1** | F2 support on OZ carry (cycle 3 ice) | `src/ice/roles.ts`, tests, pr7/pr8 goldens | none | **shipped `be9be08`.** Evaluate 11 **not credited** (g2 home 3 offs, chance mean 4.71, pairs 3). |
| **PR-H1b** | F2 outlet only in established OZ (`BLUE+8`) | `src/ice/roles.ts`, tests, goldens | H1 | Counting quality Evaluate 12. |
| **PR-R3** | Optional `BaseStore` playbook adapter | `src/playbook/`, `teamGraph.ts` | R1 | Only if retrieve path actually reads Store |
| **PR-R4** | Retrieve/AAR: stop confirmatory 122 (rate rank and/or loser does not `add_counter` on the lost-with play) | `src/playbook/retrieve.ts`, `src/aar/nodes/draftRevision.ts` | R1 | Learning Evaluate `ser-retain-2` **and/or** quality Evaluate. Do not steal a bank slot for a JSON-only change. |

Independently mergeable: R2 and H1 do not need R1. R1 is the learning proof. Cranky → `npm test` on all. Goldens move only if H1 changes `--no-llm` physics.

### Suggested sequence

1. Docs + R1/R2/H1 **shipped**. Retention Evaluate **ran** (`ser-retain-1`).
2. Carry survived (v8→v15) and g0 xG differed. Retrieve stayed 122 — confirmatory, not a new skill.
3. **Now:** H1b (F2 established-OZ outlet) → Evaluate 12 (quality). Then R4 (retrieve/AAR targeting) → `ser-retain-2` (learning) and/or a counting quality Evaluate.
4. Bank 5 is still the hockey program. Transfer is how we show the LangGraph **used** the lesson.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Carry-forward uses a book trained on **old ice** | Snapshot from a series whose ice matches `main` (e.g. `ser-emp-15` or later). Do not carry `ser-emp-7` protect-lead books. |
| Operator thinks `env` seed 7 “resets memory” | Seed reseeds **physics**. Playbooks are separate. Document on the CLI help line. |
| Quality bank confused with retention | Separate heading, separate series ids `ser-retain-*`. |
| BaseStore rewrite stalls hockey | Optional. R1 first. |
| Glimmer down | Live Evaluates need `:8080`. This session it is up. Do not restart 8787. |

---

## Open Questions

Answered in Key Decisions unless you override:

| Question | Recommended |
| --- | --- |
| Carry-forward vs F2 ice first? | **R1 next** for the learning claim. H1 in parallel if you want hockey volume while Glimmer is down (unit tests only until `:8080`). |
| Quality bank vs retention slot? | **Separate.** Bank stays Δ xG. |
| Wire official Store now? | **No.** After R1 pass. |

---

## Inner loop (unchanged)

Diagnose → Implement → Cranky (`/review --local`) → `npm test` → Merge → Evaluate if the PR counts. `--aar-mode code` is not `--no-llm`. Do not commit `.env`. Do not raise `GRAPH_HOCKEY_EPOCH_TIMEOUT_MS`.
