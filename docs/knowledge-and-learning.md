# Knowledge and learning — Graph_Hockey (LangGraph staffs)

| Field | Value |
| --- | --- |
| **Date** | 2026-08-27 |
| **Status** | Cycle 5 attempt **1/5** (bank **2/5**). Evaluate 18 void (mutate re-injected pk-box). Apply-path even-on-ice shipped. Counting Evaluate 19. Glimmer **up**. |
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

7. **Carry-forward before more ice, unless Glimmer is down.** R1/R2/H1/R4, leftover retrieve #1, and PR-R5 shipped. Retention Evaluate ran. Glimmer is **up** (Evaluate 17). Do not kill `:8080` unless asked. Do not restart 8787. Timeouts not raised.

---

## Progress (honest, measured)

### Proof 1 — Write path (proven)

Inside **one** sqlite, live AAR applies. Books v1→v8. `--no-llm` twin stays v1, `retrieveTopChanged` 0/6, `booksMoved` false. Snapshots: `data/playbook-snapshots/<seriesId>/before.json` + `after-game-N.json`. Code: `ensureSeedPlaybooks` then `latestPlaybook` each game (`src/sim/series.ts`, `src/persist/playbooks.ts`).

This is CoALA “learning = write LTM” **within a series**. It is also LangGraph’s background-write pattern (AAR after the result, not on the 12s epoch).

### Proof 2 — Maintain knowledge (survive proven; transfer started)

`--from-snapshot` `7edabe9` restores snapshot books before game 0. `ser-retain-1` carried `ser-emp-17` after-game-6 (survive **pass**: g0 v8→v9, xG 0.386 vs seed-fresh 0.152). Retrieve stayed 122 on that run.

Rate rank + unused bonus (`5f7ca56`) and leftover retrieve #1 (`33878fc`) then moved the **live** menu: Evaluate 15 retrieveTop **`oz-cycle-low`**; Evaluate 16 g1 opened **`nz-122-trap`**, cycle `stats.games` 1, then 122 rate won again. That is one-look transfer, not a new default sheet. 122 is still most directives.

Checkpointer is still `MemorySaver` per-epoch. Long-term knowledge lives in SQLite playbooks. Carry-forward **reads** that store. We do not compile LangGraph `store`.

### Proof 3 — Get better at hockey (bank 2/5)

| | Then (`ser-emp-7`) | Now |
| --- | ---: | ---: |
| Lead-protect while losing | g4–g6 locked | **0** skating hits |
| Live offsides | 0–2 (control storms) | live **0–2** |
| Credited home Δ xG | — | **−0.376** then **−0.071** |
| Last two series Δ xG | — | Evaluate 11 **+0.443** (uncashed: chance mean 4.71, g2 home 3 offs, pairs 3) |
| Pairs floor | 0 | credited **4** |
| Bank | 0 | **2 / 5** |

Evaluate 16 (cycle 4 abort): leftover retrieve #1 **skated** (g1 trap). Chance mean **4.29**, pairs 0, Δ **−0.023**. Quality fail is PP/PK AAR boost (g0 umbrella×10, g4 pk-box×14), not missing F3 geometry. Do not cash uncashed Δ xG from Evaluate 11/15.

Evaluate 17 (cycle 5 attempt 1): PR-R5 **partial**. g0 boosted **122** not umbrella. g1/g4 still boosted **pk1-box** because even-strength leftover had 0 `playUsage` seconds. Chance mean **3.43**, pairs 1, Δ **−0.049** (would beat −0.071; floors fail). Do not cash it.

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

### Quality track (cycle 5, existing bar)

Offs band is honest. Unused one-look and leftover retrieve #1 shipped. PR-R5 counted (Evaluate 17 not credited). PR-R5b draft was not enough (Evaluate 18 void). Apply-path even-on-ice shipped. Counting Evaluate 19.

Glimmer is **up**. Do not kill `:8080` unless asked. Do not restart 8787. Timeouts not raised.

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
| **PR-H1b** | F2 outlet only in established OZ (`BLUE+8`) | `src/ice/roles.ts`, tests, goldens | H1 | **shipped `9ddd4f4`.** Evaluate 12 not credited (g5 home 4 offs). |
| **PR-R4** | Retrieve unused + loser retarget | `src/playbook/retrieve.ts`, `draftRevision.ts` | R1 | **shipped `5f7ca56`.** Evaluate 15 retrieveTop cycle. |
| **Leftover #1** | Timeout/micro skate retrieveFallbackId | `invokeTeam.ts`, `assembleDirective.ts` | R4 | **shipped `33878fc`.** Evaluate 16 g1 trap; cycle 4 abort. |
| **PR-R5** | Never boost PP/PK when 5v5 was on the ice | `src/aar/nodes/draftRevision.ts` | R4 | **shipped `99b4e4e`.** Evaluate 17 **not credited** (g0 worked; g1/g4 0-second leftover). |
| **PR-R5b** | Even-strength DirectiveApplied counts as on-ice | `src/aar/nodes/draftRevision.ts` | R5 | **shipped `b535c63`.** Draft-only. Evaluate 18 void. |
| **PR-R5b apply** | mutate even-on-ice (do not re-inject PP/PK) | `src/playbook/mutate.ts`, `apply.ts` | R5b | **this commit.** Counting Evaluate 19. Goldens unchanged. |
| **PR-R3** | Optional `BaseStore` playbook adapter | `src/playbook/`, `teamGraph.ts` | R1 | Only if retrieve path actually reads Store |

Independently mergeable: R2 and H1 do not need R1. R1 is the learning proof. Cranky → `npm test` on all. Goldens move only if H1 changes `--no-llm` physics.

### Suggested sequence

1. Docs + R1–R5 + leftover retrieve **shipped**. Retention survive **ran**. Live transfer **started** (cycle, then trap, then 122 rate).
2. **Now:** PR-R5b apply-path shipped. Counting Evaluate 19. Evaluate 18 was void.
3. Bank 5 is still the hockey program.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Carry-forward uses a book trained on **old ice** | Snapshot from a series whose ice matches `main` (e.g. `ser-emp-15` or later). Do not carry `ser-emp-7` protect-lead books. |
| Operator thinks `env` seed 7 “resets memory” | Seed reseeds **physics**. Playbooks are separate. Document on the CLI help line. |
| Quality bank confused with retention | Separate heading, separate series ids `ser-retain-*`. |
| BaseStore rewrite stalls hockey | Optional. R1 first. |
| Glimmer down | Live Evaluates need `:8080`. **Up for Evaluate 17.** Do not kill unless asked. Do not restart 8787. |

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
