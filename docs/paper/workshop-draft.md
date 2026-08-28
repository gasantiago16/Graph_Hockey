# Playbook writes are not beneficial retrieve

**Formal issue paper:** [`playbook-writes-issue-paper.md`](playbook-writes-issue-paper.md) · [`playbook-writes-issue-paper.html`](playbook-writes-issue-paper.html)

**Issue paper / workshop note.** Campaign B, 25 cells, freeze 25/25, closed 2026-08-28.  
Voice: Matsumura. Spine: Sturzinger. Facts: [`factorial-b.md`](../factorial-b.md). Fidelity: [`ANNOTATED_BIBLIOGRAPHY.md`](../ANNOTATED_BIBLIOGRAPHY.md).

---

## Abstract

On 28 August 2026 the last of 25 frozen probe cells finished. Playbook versions did not move. Distinct chance means sat in one band: live retrieve, seed ranking, and seed-versus-seed. Combined volume 9.23–9.71; standard errors overlap.

It would be difficult to find anyone arguing against “the staff should remember the last game.” The argument that a version bump *is* that memory is one of semantics.

The authors must stop scoring learning as sqlite growth. A write is a control. Use is a later episode against an opponent that cannot rewrite its book on the same clock.

Two staff graphs propose. Ice code disposes. After the horn, After-Action Review patches JSON. The next epoch may retrieve it. A `--no-llm` twin never patches. That twin proves the write path. It does not prove hockey moved.

Live-versus-live Δ xG is coadaptation. The seed side that still runs `--aar-mode code` is not frozen. Campaign B froze both books (`propose`: digest, no bump), used one LLM on both benches, and compared three paths at five seeds. Pre-registered output: chance mean on the trained side.

Paired, trained home minus seed-seed is +0.03. Trained away minus seed-seed is −0.17. Ranking the trained away book never beat seed ranking on that side (live minus null −0.51, every seed ≤ 0). That is not a cashed “hurt.” It is a failure to show help.

The scarce input is a Head Coach completion inside eight seconds. Timeouts skate leftover. Ice geometry is a second policy on the same stick. Either path can look like “learning” if the test is live-versus-live.

The near-term decision is not another ice patch and not a Store wrapper. It is whether to treat emp-26 books as dead weight on this metric and design the next probe so ranking *is* the policy — leftover/micro-only, freeze held, more seeds — or to stop claiming retrieve.

---

## Outline

**Title.** Playbook writes are not beneficial retrieve.

**Form.** Issue paper, ~4–6 pp. Workshop / arXiv. Not a main-track methods paper. Not a hockey-analytics journal.

**Hook.** 25 frozen cells, 28 August 2026. Versions held. Chance means did not separate.

**Must-do.** Measure retrieve-and-use against a frozen opponent. Do not substitute a version integer.

### THE PROBLEM, NOT THE SLOGAN

- Operational question: did the written book change later chance volume versus a book that could not learn on the same clock?
- “The team learned hockey” collapses write, retain, and quality. Split them.
- Prior HS/SH left the seed side writing AAR. That is co-play, not EVAL.
- Contribution is the plant plus a negative on retrieve, not a new coach class (RoboCup Coach, LLCoach, AgentPitch already occupy that class).

### HOW SUCCESS IS MEASURED

- Write path: live books move; `--no-llm` does not.
- Freeze: g6 version equals g0.
- Probe: trained-side chance mean and combined chance mean. Not goals. Not NHL xG.
- 7×20 s is a volume diagnostic. Unscaled 120 s minors remain a clock defect. Name it; do not hide it.

### THREE PATHS

| Path | What it tests |
| --- | --- |
| **ss** | Seed versus seed, frozen. Baseline. |
| **live** | Trained book, retrieve ranks that book, opponent frozen. |
| **null** | Same trained JSON, retrieve ranks *seed* order. Isolates ranking from the sheet. |

Home-trained and away-trained (HS / SH). Five seeds. Same LLM both sides. Snapshot emp-26 after game 6.

### WHAT THE 25 CELLS SHOW

- Freeze 25/25.
- Table: means ± SE. Live ≈ null ≈ ss.
- Table: paired deltas. Home live−ss +0.03. Away live−ss −0.17. Away live−null −0.51, all seeds ≤ 0.
- Scorecard `retrieveTop` under null still names the live book — a leak, not a manipulation check.
- Ice and timeout leftover remain competing policies. Name the countermeasure: leftover 122/212 when the coach does not finish.

### WHAT ANALYSIS MUST NOT CLAIM

- LangGraph Store (`compile({ store })` was not used).
- Quality bank 2/5 as hockey science.
- Ice PRs (offside clamp, F2/F3) as staff learning — those change the environment.
- “Hurt” on SH null>live without intervals that exclude zero.
- Main-conference originality of competing coaches who write playbooks.

### DECISION AGENDA

- **Consider** leftover/micro-only twins so the ranker *is* the policy.
- **Examine** whether play JSON (assignments, counters) moves anything if ranking does not.
- **Test** a new snapshot only after the freeze-and-rank probe is the counting experiment, not an exception.
- **Do not** spend the next cycle on ice geometry if the claim is memory.

**Close.** The clock that matters is the eight-second coach window and the next frozen series, not another night of rink repair. Force capability of the *test* — freeze, factorial, paired seeds — beats a larger log of co-adapting games.

**Figures.** (1) Ice versus staff split. (2) Three paths. (3) Paired deltas by seed.

**Word budget.** Abstract as above. Body 4–6 pp.

## 1. Introduction

LLM agents can change later actions by writing external memory without updating weights (Reflexion, Voyager, ExpeL; CoALA: learning = write LTM). A log is not memory until a later run retrieves it **and uses it** (LangChain 2026). Competing coaches who write structured advice after a match are not a new experimental class (RoboCup Coach, LLCoach, AgentPitch, FM-Bench). The unpublished plant here is ice + JSON playbooks + a `--no-llm` physics golden.

We previously measured write (books v1→v8, control stays v1), snapshot restore (file load), and live-vs-live Δ xG. The last is coadaptation, not skill (Zhang 2024; Search Self-play 2025). This note asks only: **does retrieve ranking of the written book move even-strength chance volume vs a frozen seed opponent?**

## 2. Related work

**Memory without weights.** CoALA is a taxonomy. Reflexion / Voyager / ExpeL were accepted because $P(T)$ moved with ablations. Feng et al. (2026): retrieved skills can hurt.

**Coaches vs players.** RoboCup Simulation Coach (CLang playbooks, AAAI 2006); LLCoach (2024); AgentPitch (2026); FM-Bench (2026). We are that split: staff graph proposes, ice code disposes.

**Self-play EVAL.** Skill is a payoff vs frozen copies / a population (OpenAI Five, AlphaStar, Zhang `EVAL(Π)`), not in-game score vs a co-learner.

**Hockey process stats.** Goals in tiny samples are luck. Our 7×20 s clock is **not** NHL analytics (uncalibrated engine xG; unscaled 120 s minors). We treat distinct chance clusters as a **volume diagnostic**, not as MoneyPuck xG.

## 3. System

Environment: 10 Hz Euler rink, offside/icing/goals. F1–G are code (`src/ice/`), not graphs. Two compiled `StateGraph`s (home/away) with private playbooks and per-epoch `MemorySaver` threads. Live path: retrieve → Head Coach → assemble → validate. AAR is background. We do **not** `compile({ store })`. Playbooks live in SQLite beside the graph.

Default counting AAR is `--aar-mode code` (digest + apply). For this probe we use `--aar-mode propose`: the same digest, **no version bump**.

## 4. Protocol (campaign B)

- Snapshot: `ser-emp-26/after-game-6` (books v8).
- 7 games × 20 s periods. Seeds **7, 11, 19, 23, 29**.
- Providers: xAI `grok-4.5` both sides. Captain unset. Epoch timeout 8000 ms (not raised).
- Arms: ss, hs-live, hs-null, sh-live, sh-null (25 cells).
- Freeze check: `playbookVersions` must match g0 at g6.
- Pre-registered: chance mean on the trained side vs frozen seed; combined chance mean; evenNonDefault **rates**.

`--no-llm` remains the write-path control from earlier series; it is not this factorial (it also skips the Head Coach).

## 5. Results

**Write path (prior).** Live v1→v8; `--no-llm` v1; `booksMoved` false.

**Freeze.** 25/25 cells: g6 versions equal g0 (`ss` 1/1, `hs-*` 8/1, `sh-*` 1/8). Propose freeze works.

**Chance mean ± SE** (n=5 seeds; 7×20 s; xAI both sides):

| arm | home μ | away μ | combined μ |
| --- | ---: | ---: | ---: |
| ss | 4.89±0.32 | 4.77±0.38 | 9.66±0.21 |
| hs-live | 4.91±0.44 | 4.80±0.29 | 9.71±0.23 |
| hs-null | 4.74±0.30 | 4.80±0.20 | 9.54±0.25 |
| sh-live | 4.63±0.31 | 4.60±0.31 | 9.23±0.13 |
| sh-null | 4.54±0.39 | 5.11±0.23 | 9.66±0.31 |

Paired same-seed: HS home live−ss **+0.03**; SH away live−ss **−0.17**; SH away live−null **−0.51** (every seed ≤ 0). Pattern **live ≈ null ≈ ss**. SH null>live is a point estimate with overlapping SEs — do not cash “hurt.”

Scorecard `retrieveTop` under `--null-retrieve` still names the live book (menu, not the ranker). One ss cell (seed 23) home offs max 3.

**Read.** Retrieving emp-26 books does not raise chance volume vs a frozen seed opponent. The write path is real; beneficial retrieve is not shown.

## 6. What we do not claim

LangGraph Store. Quality bank 2/5 as hockey science. Goals. Version integers as retention. “Both staffs improved.” NHL-calibrated xG. Main-conference originality of the coach loop.

## 7. Limitations

20 s periods; unscaled minors; engine xG uncalibrated; private live path (xAI key); specialists compiled and idle; one training snapshot; Head Coach may still timeout onto leftover.

## References

See [`docs/ANNOTATED_BIBLIOGRAPHY.md`](../ANNOTATED_BIBLIOGRAPHY.md).
