# Annotated bibliography — LangGraph learning vs Graph_Hockey

| Field | Value |
| --- | --- |
| **Date** | 2026-08-27 |
| **Target** | (1) Claims that Graph_Hockey’s LangGraph staffs *learn*, *keep* knowledge, and *get better*. (2) **Paper pitch:** is this body of work enough for an original research paper? |
| **Method** | Deep-research review: extract claims, counter with primaries, defender/prosecutor/judge |
| **Product code** | Not changed. Plan: [`knowledge-and-learning.md`](knowledge-and-learning.md). Scoreboard: [`better-hockey.md`](better-hockey.md) |

This is an epistemic review, not a merge gate. Empty “no source” is allowed; we did not need it.

The 2026-08-26 C1–C8 review still stands. This update adds **P1–P8** (paper pitch) after cross-play HS/SH, null-retrieve, dual quality card, and Evaluates 17–19.

---

## Claim table (C — plant / learning slogans)

| ID | Claim | Verdict | Judge label | Best cite | Hole |
| --- | --- | --- | --- | --- | --- |
| **C1** | LangGraph checkpointers are thread-scoped short-term graph state. They are not the cross-thread knowledge API. | **holds-with-caveat** | proven-pattern | [Persistence (JS)](https://docs.langchain.com/oss/javascript/langgraph/persistence) | One saver can hold many threads; `copy_thread` clones. Not a fact store. |
| **C2** | Stores hold application-defined JSON across threads. Official JS compile is `builder.compile({ checkpointer, store })`. | **holds-with-caveat** | proven-pattern | [Stores](https://docs.langchain.com/oss/javascript/langgraph/stores) | Both args optional. Namespaced dicts, not opaque blobs. |
| **C3** | Memory taxonomy: semantic / episodic / procedural. Background writes avoid hot-path latency. | **holds-with-caveat** | research | [Memory overview](https://docs.langchain.com/oss/javascript/concepts/memory); [CoALA](https://arxiv.org/abs/2309.02427) | Vocabulary on one `BaseStore`, not three product types. |
| **C4** | Physics/rules live in the environment. Experimenter ice edits are not “the agent learned.” | **holds-with-caveat** | proven-pattern | Sutton & Barto Ch. 3.1; Jiang 2019 | Cut is leaky: ice F1 shoot beats overlay pass; `tweak_slot` is mostly dead. Slogan still forbidden. |
| **C5** | LLM agents can change later behavior by writing external memory without weight updates. That is not \(\pi_\theta\) improvement. | **holds-with-caveat** | research | CoALA; Reflexion; Voyager; ExpeL | \(\pi(a\mid s,M)\) *does* change when \(M\) changes. Write ≠ learn until retrieve-and-use. |
| **C6** | Retention requires the next episode to start from the stored memory. Wiping the store cannot prove CL. | **holds-with-caveat** | research | ExpeL; Voyager new-world; Hu et al. 2026 | `env.reset(seed)` is not a store wipe. Our Evaluates wipe the *playbook db*. Snapshot restore is I/O, not FWT. |
| **C7** | Version bumps / stats on the same default play are not policy transfer. Transfer needs later retrieve-and-use, plus quality vs a no-write control. | **holds-with-caveat** | our-bet | [LangChain memory blog](https://www.langchain.com/blog/how-to-give-your-agent-memory); Feng et al. 2026 | Same skill ID can still change params. Harmful transfer is still a policy change. Quality↑ is *beneficial* transfer. |
| **C8** | Graph_Hockey SQLite playbooks *are* LangGraph Store long-term memory. | **fails** | our-bet | Stores + `compile({ store })` | We persist JSON beside the graph. `compileTeamGraph` only passes `checkpointer`. |

---

## Claim table (P — paper pitch, 2026-08-27)

| ID | Claim | Verdict | Judge label | Best cite | Hole |
| --- | --- | --- | --- | --- | --- |
| **P1** | Dual LangGraph staffs + 10 Hz NHL-like rink + AAR playbooks is a *novel experimental class*. | **fails** | marketing-overlap | [LLCoach](https://arxiv.org/abs/2406.18285); RoboCup Coach (AAAI 2006); [AgentPitch](https://github.com/gangtao/AgentPitch/); [FM-Bench](https://arxiv.org/abs/2608.18423) | Ice + LangGraph.js is a new *artifact*. Independent coaches writing structured playbooks after the horn is RoboCup Coach / AgentPitch. |
| **P2** | Code AAR that boosts cited plays is CoALA learning and a sufficient scientific contribution. | **fails** | marketing-overlap | CoALA (taxonomy); Reflexion; Voyager; ExpeL | CoALA *labels* a write. Those papers were accepted because *P(T)* moved with ablations. v1→v8 with sticky 122 is a mutation log. `--aar-mode code` is Soar-like production weighting, not LLM-mediated LTM. |
| **P3** | Snapshot restore (`ser-retain-1` g0 v8, stats ≠ seed) is continual-learning retention. | **fails** | our-bet | Hu 2026; Lopez-Paz GEM; Voyager new-world | Same seed 7 is reload, not Task A→B. Transfer **failed** on the only carry series. `stats.games` must differ after seven AAR games. |
| **P4** | HS/SH chance mean vs seed-fresh SS proves the staff improved. | **fails** | our-bet | Zhang 2024 EVAL; OpenAI Five frozen copies; Balduzzi 2019 | n=7, one seed, no CI. Seed away still wrote AAR (v1→v8). Combined HS **8.71 < SS 9.29**. 5.57 fails our own chance-mean floor of 6. Coadapt clause **holds**. |
| **P5** | `--null-retrieve` on HH shows retrieve ranking is not the cause of HS/SH wins. | **fails** as causal ID; **holds-with-caveat** as a dirty negative | research | Feng 2026; Voyager skill in/out | Wrong arm (HH not HS/SH). Home ranking is a no-op (still 122). n=7, gap ~1 chance/game. Allowed: “one HH series with seed ranking had combined 9.57 vs live 8.57; ranking is not identified as the HS/SH mechanism.” |
| **P6** | 7×20s chance/xG/offs/pairs are valid *hockey-quality* science. | **fails** | our-bet | MoneyPuck; HockeyStats xG; DataDrivenHockey; NST glossary | 20s < one NHL shift. Minors unscaled (120s). Engine xG is an uncalibrated logit (Eval 8 g6: 4 goals on 0.70 xG). Offs 0–2 is a storm gate. **Keep:** goals in 7×20s are not skill. |
| **P7** | This log is enough for an original peer-reviewed paper. | **fails** main/JQAS; **holds-with-caveat** arXiv + workshop if rewritten | our-bet | NeurIPS 2026 CFP; PALM/TTCL/ICBINB; AAAI demo | No manuscript, private repo, n=1. Demo track matches the *product*. Workshop only if the title is “write ≠ beneficial retrieve.” |
| **P8** | Ice geometry PRs are env/MDP, not LangGraph learning. | **holds-with-caveat** | proven-pattern | Sutton 3.1; Jiang 2019; Ng 1999 | Bank 2/5 includes Evaluate 2 (ice-only). Overlay pass is env-nullified in OZ. Cut is the right *commitment*, not a clean fact. |

---

## What the judge would **not** let us say in a pitch (updated)

- “The LangGraph Store is how the benches remember.” We do not compile with `store`.
- “We invented competing LLM coaches that write playbooks.” RoboCup Coach (2001–2006), LLCoach (2024), AgentPitch (2026), FM-Bench (2026).
- “Ten Evaluates proved the graph learned hockey.” Ice PRs moved Δ xG. Each counting Evaluate starts from **seed books in a fresh sqlite**.
- “Home retrieveTop 0/6 means learning failed.” After the lead-protect gate, 0/6 can be success. Diagnostic, not the live-learns pass.
- “Dump-in / high-slot / F2 chase is LangGraph learning.” **Environment** repairs (C4/P8). Evaluate 2’s bank credit is ice.
- “A version integer is knowledge retention.” Storage without later retrieve-and-use is not memory-in-use (C7/P3).
- “Home Δ xG vs a learning away bench proves the staff got better.” Coadapt. Cross-play HS/SH is the *intended* EVAL — and **P4 still fails** (n=1, opponent not frozen, combined mixed).
- “HS home μ 5.57 > SS 4.43 proves skill.” Unsigned n=7; combined down; seed opponent wrote AAR; fails our own floor of 6.
- “Null retrieve proved ranking doesn’t help.” Dirty ablation on the wrong arm. Underpowered.
- “Goals in a 7×20s series are skill.” Keep this prohibition. Do **not** replace it with “chance mean is NHL-valid xG/SCF.”
- “Bank 2/5 means hockey quality is a paper result.” Credited Δ xG is **negative** (−0.376, −0.071). Later chance means 3.43–4.43.
- “`--aar-mode code` is CoALA cognitive learning.” Code draft is production weighting. CoALA Fig. 1C uses the LLM to *write* LTM.
- “This is a NeurIPS/ICML/ICLR main paper.” Fail closed until a new campaign.
- “This is a JQAS / Sloan hockey paper.” Toy 20s uncalibrated xG.

**Allowed sentences (narrow):**

- Two independently compiled staff graphs share a JSON play, not five voting skaters. Ice is code.
- Within one sqlite, live AAR writes books v1→v8; `--no-llm` stays v1 (`booksMoved` false). That is a **write-path** control.
- `--from-snapshot` loads those rows into a new db. The CLI works. That is persistence, not CL.
- Live-vs-live home Δ xG is `coadapt`. Dual quality card reports combined chances and both Δ xG.
- One HH series with `--null-retrieve` had combined 9.57 vs live 8.57. Do not identify that as the HS/SH mechanism.
- The watchable rink + Film Room is a **demo**. The honest workshop paper is a **negative**: playbook writes fire; beneficial retrieve is not shown.

---

## Synthesis (defender / prosecutor / judge) — paper pitch

### Defender

The plant is a real closed loop: deterministic env, two private graphs, background write, retrieve on the next epoch, `--no-llm` twin, golden hashes that move only when ice moves, and a dual card that refuses to cash coadapt as skill. That is more experimental hygiene than most LLM-agent demos. CoALA/Reflexion/Voyager already license frozen-weight memory; we do not need BaseStore to *have* LTM. Cross-play and null-retrieve are the right *kinds* of arms (frozen opponent; ranking vs books). The Sutton cut is the right commitment even if the TypeScript leaks. A workshop negative result (“writes happen; retrieve ranking of those writes did not improve combined chances”) is a legitimate scientific object if rewritten with seeds and a freeze.

### Prosecutor

Every attractive slogan is either a remix or a protocol error. Dual LLM coaches writing structured advice after the match is RoboCup Coach + AgentPitch + LLCoach. Code AAR is not Reflexion. Snapshot restore at seed 7 is not Voyager’s new world. HS/SH is not Zhang EVAL: the “frozen” seed still AAR-writes, n=7 has no CI, combined volume goes the wrong way, and null-retrieve was run on HH. 20-second “hockey quality” uses an uncalibrated logit, unscaled 120s minors, and a chance definition that is a 1.5s shot cluster. Bank 2/5 credited **negative** home Δ xG after an ice-only Evaluate. The repo is private. There is no manuscript. Main conference and sports journals are a fantasy. Instantiating CoALA’s taxonomy in 2026 is not a paper.

### Judge

Keep **three proofs**, never one slogan — and do not upgrade any of them to “original research paper” without a rewrite:

1. **Write path** — proven as an engineering control (`ser-emp-7` onward). Not original learning theory (P2 fails).
2. **Retention / transfer** — survive = file load (P3 fails). Transfer menu started (cycle, trap); skating still 122. Null retrieve is a **hint**, not an identification (P5).
3. **Hockey quality** — bank **2/5**, both credits negative Δ xG, later chance means down. Ice PRs are env (P8 holds-with-caveat). 20s metrics are not NHL science (P6 fails).

**Paper object that survives:** a **demo** (rink + film) plus, after a rewrite, a **workshop negative / systems** note: *episodic playbook writes are gated and observable; ranking those writes is not shown to improve combined chances vs seed ranking; live-vs-live Δ xG is coadapt.* Title must not say “LangGraph learned hockey.”

Label P1, P2, P3, P4, P6, P7-main **fails**. Label P5 **fails as causal**, **holds-with-caveat as dirty negative**. Label P7-workshop/arXiv **holds-with-caveat**. Label P8 **holds-with-caveat**.

---

## Annotated entries

### LangGraph / LangChain (primaries)

- **Persistence (JS).** https://docs.langchain.com/oss/javascript/langgraph/persistence — Checkpointer = thread graph state; Store = application KV across threads. Compile with either or both. *Plant:* our graphs compile checkpointer only.
- **Stores (JS).** https://docs.langchain.com/oss/javascript/langgraph/stores — Namespaced JSON documents, `put`/`search`. *Plant:* playbooks are namespaced by `team_id` + version in SQLite — same *idea*, not the *interface*.
- **Add memory (JS).** https://docs.langchain.com/oss/javascript/langgraph/add-memory — Remember on `thread_id: "1"`, recall on `"2"`. *Plant:* analog is game 0 AAR → game 1 `retrieve_plays`, not Store.
- **Memory overview (JS).** https://docs.langchain.com/oss/javascript/concepts/memory — Semantic / episodic / procedural; hot path vs background write. *Plant:* live epoch is hot; AAR is background. Split is already correct.
- **How to give your agent memory (LangChain blog, 2026-06-24).** https://www.langchain.com/blog/how-to-give-your-agent-memory — A log is not memory until a later run retrieves it **and changes behavior**. *Plant:* `booksMoved` without retrieve-and-use is the failure mode they name.
- **Launching long-term memory in LangGraph (2024).** https://www.langchain.com/blog/launching-long-term-memory-support-in-langgraph — Productized “learn from feedback” via Store. *Plant:* we did not ship that compile path.

### Cognitive architecture / agents

- **CoALA, Sumers et al., TMLR 2024.** https://arxiv.org/abs/2309.02427 — LTM = procedural + semantic + episodic. Learning = **write LTM**. *Plant:* ice = grounding; playbook writes = learning *action*; event log/film = episodic. *Caveat:* taxonomy, not a method. Instantiating it is not a result.
- **Reflexion, Shinn et al. 2023.** https://arxiv.org/abs/2303.11366 — Linguistic feedback, no weight updates. Ablation: tests without reflection = no gain. *Plant:* we need write-off / retrieve-off / write-without-retrieve, not only `--no-llm`.
- **Voyager, Wang et al. 2023.** https://arxiv.org/abs/2305.16291 — Skill library built in one world, used in a **new** world. *Plant:* missing Evaluate: carry into a new seed/opponent with skills *executed*.
- **ExpeL, Zhao et al. 2024.** https://arxiv.org/abs/2308.10144 — Keep experiences **across tasks**; exam is one shot. Distinguishes Reflexion same-instance loops from retention. Mitchell 1997 as epigraph: *P(T)* must improve with *E*.
- **Generative Agents, Park et al. 2023.** https://arxiv.org/abs/2304.03442 — Reflect, cite, write, retrieve. Ablations on observation / planning / reflection.
- **Feng et al. 2026, skill transfer.** https://arxiv.org/abs/2608.20274 — Library growth / reuse counts hide contribution. Retrieved skills can **hurt** vs no-memory. *Plant:* quality vs no-memory stays required; HH null 9.57 > live 8.57 is compatible with hurt, useless, or noise.

### Prior art that kills “novel testbed” (P1)

- **LLCoach, Brienza et al., RoboCup Symposium 2024.** https://arxiv.org/abs/2406.18285 — LLM/VLM coach generates and refines soccer plans; robots execute code. Coach impersonation pipeline.
- **Know Thine Enemy, Kuhlmann, Knox, Stone, AAAI 2006.** https://aaai.org/papers/01463-aaai06-230-know-thine-enemy-a-champion-robocup-coach-agent/ — Privileged coach, structured CLang playbooks from game logs, independent players. Graph_Hockey is this split (JSON + LLM).
- **AgentPitch, Tao 2026.** https://github.com/gangtao/AgentPitch/ — Two independently compiled LLM strategies on a deterministic 2D football engine; post-match rewrite from the log; spectator replay.
- **FM-Bench, Wang et al. Aug 2026.** https://arxiv.org/abs/2608.18423 — Competing LLM football-club agents on a deterministic engine; lineup/tactics tools; Arena; no LLM judge.
- **PokerSkill, Li et al. 2026.** https://arxiv.org/abs/2605.30094 — Frozen LLM + structured skill library, no training. Same recipe, different sport.
- **Tübingen hockey-env / EA STS2 / GRF.** https://github.com/martius-lab/hockey-env ; https://arxiv.org/abs/1906.10124 ; https://arxiv.org/abs/1907.11180 — 2D team-sport rinks as competing-agent testbeds already exist.
- **Zhang, ECE 2025, MARL ice hockey + MHPTD.** https://papers.iafor.org/wp-content/uploads/papers/ece2025/ECE2025_93889.pdf — Per-skater MARL on hockey tracking. Different cut (players as agents, not staff).

### RL / continual learning / self-play

- **Sutton & Barto, Ch. 3.1.** http://incompleteideas.net/book/the-book-2nd.html — Cut = control, not knowledge. Motors are environment.
- **Jiang 2019, agent-environment boundary.** https://arxiv.org/abs/1905.13341 — Same loop, different cuts, different \(Q^\star\).
- **Ng, Harada, Russell 1999.** Reward shaping ≠ new \(\pi^\star\). Ice PRs change \(P\), stronger than shaping.
- **Hu, Long, Wang 2026.** https://arxiv.org/abs/2604.27003 — Memory CL is FWT/BWT under sequential tasks. Store-and-reload is not FWT.
- **Lopez-Paz & Ranzato, GEM 2017.** https://arxiv.org/abs/1706.08840 — ACC / FWT / BWT on a **sequence of tasks**.
- **Zhang et al. 2024, Self-play survey.** https://arxiv.org/abs/2408.01072 — `EVAL(Π)` vs a policy population / frozen copies.
- **Search Self-play, 2025.** https://arxiv.org/abs/2510.18821 — In-game reward can dip while frozen-benchmark scores rise.
- **OpenAI Five, Berner et al. 2019.** https://arxiv.org/abs/1912.06680 — Frozen past parameter versions.
- **AlphaStar, Vinyals et al. 2019.** https://www.nature.com/articles/s41586-019-1724-z — League payoff + human MMR.
- **Balduzzi et al. 2019.** https://arxiv.org/abs/1901.08106 — Population performance, not pairwise vs init.
- **FCP, Strouse et al. 2021.** https://arxiv.org/abs/2110.08176 — BR to a frozen seed×checkpoint pool.
- **Lin 1992, experience replay.** Do not equate AAR retrieval with DQN replay.

### Hockey analytics (why 20s is not that literature)

- **DataDrivenHockey 2024.** https://www.data-driven-hockey.com/2024/02/21/hockey-analytics-primer-rate-stats-and-strength-states/ — ~70% EV goals **because** a 2:00 minor is 3.3% of 60:00. PP 7.59 vs EV 2.77 GF/60. Stratify; do not call 22% of goals “poison.”
- **MoneyPuck about.** https://moneypuck.com/about.htm — xG trained on ~800k NHL shots.
- **HockeyStats xG methodology.** https://hockeystats.com/methodology/expected-goals — Separate ES/PP/SH/EN models; ES AUC ~0.80.
- **Natural Stat Trick glossary.** https://www.naturalstattrick.com/glossary.php?lines — Scoring chances ≠ 1.5s shot clusters.
- **Low Cycle, using xG.** Team xG insight ~**15–25 games**, not 7 minutes.

### Venues (P7)

- **NeurIPS 2026 CFP / contribution types.** https://neurips.cc/Conferences/2026/CallForPapers — Main closed (6 May 2026). Negative-results type has a high bar.
- **PALM @ NeurIPS 2026.** https://palm-neurips-2026.github.io/ — Memory for agents; systems and negatives. Workshop deadline **29 Aug 2026**.
- **TTCL workshop.** https://ttcl-agents.github.io/ — Test-time continual agents; system demos allowed.
- **ICBINB @ ICLR 2026.** https://sites.google.com/view/icbinb-2026/submit — “I can’t believe it’s not better”; wants error bars. 2026 already happened.
- **AAMAS demonstrations.** https://cyprusconferences.org/aamas2026/call-for-demonstrations/ — 2–4 pp + live system + video. Matches the artifact.
- **JQAS.** https://www.degruyterbrill.com/journal/key/jqas/html — Stats on real competition. Toy 20s xG dies.
- **Sloan research papers.** https://www.sloansportsconference.com/research-paper-competition — Novelty, rigor, impact on real sport.

---

## Open questions (for the user, not silently decided)

**Answered from the 2026-08-26 list:** carry-forward ran (survive yes, transfer no). BaseStore still optional. Retention must not steal a quality-bank slot.

**New (paper):**

1. Do we write a **workshop negative** (“playbook writes fire; ranking those writes is not shown to help”) or a **demo paper** (rink + film), and refuse a methods pitch until a new eval campaign?
2. Will we freeze AAR on probe series (true frozen opponent) and run HS/SH × `{live retrieve, seed ranking, seed books}` with **≥5 physics seeds**?
3. Do we scale clocks (`MINOR_SECONDS`, pull-goalie) with period length, or stop calling 20s results “hockey quality”?
4. Is public `--no-llm` goldens + snapshots enough for arXiv, or do we open the repo?

See [`knowledge-and-learning.md`](knowledge-and-learning.md) for the engineering plan. This file is the fidelity scorecard for slogans and for a paper pitch.
