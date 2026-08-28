# Campaign B — frozen HS/SH × retrieve factorial

| Field | Value |
| --- | --- |
| **Date** | 2026-08-27–28 |
| **Status** | **Done.** 25/25, fail 0. Freeze 25/25. Verdict: live ≈ null ≈ ss. Carried books are dead weight on chance mean vs frozen seed. |
| **Question** | Does retrieving the *written* playbook beat ranking seed JSON against a **frozen** seed opponent? |
| **Not** | Quality bank. LangGraph Store. NHL-calibrated xG. Live-vs-live Δ xG. |

Counter-review: [`ANNOTATED_BIBLIOGRAPHY.md`](ANNOTATED_BIBLIOGRAPHY.md) P4/P5. This campaign is the experiment that can license a **memory** sentence. It cannot license “the graph learned hockey.”

---

## Why this protocol

Prior HS/SH (`ser-cross-hs` / `ser-cross-sh`) is **not** a freeze: the seed side still ran `--aar-mode code` and books moved v1→v8. Null retrieve ran on **HH**, the wrong arm. n = 1 seed. Glimmer timeouts skated leftover instead of a Head Coach pick.

B fixes those three holes:

1. **`--aar-mode propose`** = code AAR digest, **no playbook bump** (frozen probe). Live epochs still call the Head Coach.
2. Factorial on **HS and SH**, not HH: `{live retrieve, seed ranking (--null-retrieve), seed books}`.
3. **Five physics seeds:** 7, 11, 19, 23, 29.
4. **Both benches xAI.** Glimmer is down (user-killed). Same provider removes the side×model confound. Do not restart Glimmer for this campaign.

SS is seed vs seed with AAR frozen — not Evaluate 19 (which wrote books).

---

## Cells (25)

Snapshot: `data/playbook-snapshots/ser-emp-26/after-game-6.json` (emp-26 after game 6, books v8).

| Arm | Home | Away | Retrieve ranks | Series id |
| --- | --- | --- | --- | --- |
| **ss** | seed | seed | seed | `b-ss-s{seed}` |
| **hs-live** | trained | seed frozen | live (trained home) | `b-hs-live-s{seed}` |
| **hs-null** | trained | seed frozen | seed JSON | `b-hs-null-s{seed}` |
| **sh-live** | seed frozen | trained | live (trained away) | `b-sh-live-s{seed}` |
| **sh-null** | seed frozen | trained | seed JSON | `b-sh-null-s{seed}` |

CLI pattern (hs-live):

```text
npm run gh -- series --games 7 --period-seconds 20 --aar-mode propose --no-record --json
  --home-provider xai --away-provider xai
  --from-snapshot data/playbook-snapshots/ser-emp-26/after-game-6.json
  --home-from-snapshot --away-seed --seed N --id b-hs-live-sN
  --db data/factorial-b/b-hs-live-sN.sqlite
```

Captain unset. `GRAPH_HOCKEY_EPOCH_TIMEOUT_MS` not raised (8000). Fresh sqlite per cell. Do not touch `ser-emp-*` dbs.

Pre-registered metrics (trained side vs frozen seed):

- even-strength / overall **distinct chance mean** (home for HS, away for SH)
- **combined** chance mean
- evenNonDefault rates (not raw counts)
- `playbookVersions` must not increment (freeze check)
- `openingPlayId` vs retrieve #1 (manipulation: leftover/HC actually follow the rank book)

---

## How to read the outcome

| Pattern | Allowed sentence |
| --- | --- |
| live > null > ss | Retrieve ranking of the written book **helped** vs frozen seed. |
| live ≈ null > ss | The **play JSON** is doing the work, not retrieve order. |
| live ≈ null ≈ ss | Carried books are **dead weight**. |
| null > live | Ranking the trained book **hurt** (Feng-style), if CIs exclude 0. |

**Landed: live ≈ null ≈ ss.** SH away point estimate is null > live (5.11 vs 4.60), but n=5 and SEs overlap. Do not cash “hurt.” Do cash “not shown to help.”

Do not cash live-vs-live Δ xG. Do not recode quality bank 2/5. Do not say LangGraph Store.

Runner: `node scripts/run-factorial-b.mjs` (resumable). Results: `data/factorial-b/*.json`. Aggregate: `node scripts/aggregate-factorial-b.mjs` → `data/factorial-b/SUMMARY.md`.

---

## Results (25/25, 2026-08-28)

Mean ± SE over seeds 7, 11, 19, 23, 29. Chance clusters, 7×20 s, both benches xAI, AAR propose (no bump).

| arm | n | home μ | away μ | combined μ | freeze |
| --- | ---: | ---: | ---: | ---: | --- |
| ss | 5 | 4.89±0.32 | 4.77±0.38 | 9.66±0.21 | 1/1 |
| hs-live | 5 | 4.91±0.44 | 4.80±0.29 | 9.71±0.23 | 8/1 |
| hs-null | 5 | 4.74±0.30 | 4.80±0.20 | 9.54±0.25 | 8/1 |
| sh-live | 5 | 4.63±0.31 | 4.60±0.31 | 9.23±0.13 | 1/8 |
| sh-null | 5 | 4.54±0.39 | 5.11±0.23 | 9.66±0.31 | 1/8 |

Paired (same seed):

- HS home live − ss: **+0.03** (signs mix: +0.57, −0.29, +0.15, +0.28, −0.57)
- HS home live − null: **+0.17**
- SH away live − ss: **−0.17**
- SH away live − null: **−0.51** (all ≤ 0: −0.57, −0.43, 0, −1.57, 0)

Pre-registered read: trained-side chance mean vs frozen seed **does not beat ss**. Retrieve ranking of the trained book **does not beat seed ranking**. Scorecard `retrieveTop` under `--null-retrieve` still names the live book (leaky; known). One ss cell (seed 23) home offs max **3** (storm gate, not the RQ).

**Allowed:** write path stands; freeze works; vs a frozen seed opponent, emp-26 books are dead weight on this volume metric.

**Forbidden:** staff improved; ranking caused HS/SH; Store; bank 2/5 moved.
