# Annotated bibliography — LangGraph learning vs Graph_Hockey

| Field | Value |
| --- | --- |
| **Date** | 2026-08-26 |
| **Target** | Claims that Graph_Hockey’s LangGraph staffs *learn*, *keep* knowledge, and *get better* |
| **Method** | Deep-research review: extract claims, counter with primaries, defender/prosecutor/judge |
| **Product code** | Not changed. Plan: [`knowledge-and-learning.md`](knowledge-and-learning.md). Scoreboard: [`better-hockey.md`](better-hockey.md) |

This is an epistemic review, not a merge gate. Empty “no source” is allowed; we did not need it.

---

## Claim table

| ID | Claim | Verdict | Judge label | Best cite | Hole |
| --- | --- | --- | --- | --- | --- |
| **C1** | LangGraph checkpointers are thread-scoped short-term graph state. They are not the cross-thread knowledge API. | **holds-with-caveat** | proven-pattern | [Persistence (JS)](https://docs.langchain.com/oss/javascript/langgraph/persistence) | One saver can hold many threads; `copy_thread` clones. Not a fact store. |
| **C2** | Stores hold application-defined JSON across threads. Official JS compile is `builder.compile({ checkpointer, store })`. | **holds-with-caveat** | proven-pattern | [Stores](https://docs.langchain.com/oss/javascript/langgraph/stores); [add-memory](https://docs.langchain.com/oss/javascript/langgraph/add-memory) | Both args optional. Namespaced dicts, not opaque blobs. |
| **C3** | Memory taxonomy: semantic / episodic / procedural. Background writes avoid hot-path latency. | **holds-with-caveat** | research | [Memory overview](https://docs.langchain.com/oss/javascript/concepts/memory); [CoALA](https://arxiv.org/abs/2309.02427) | Vocabulary on one `BaseStore`, not three product types. |
| **C4** | Physics/rules live in the environment. Experimenter ice edits are not “the agent learned.” | **holds-with-caveat** | proven-pattern | Sutton & Barto Ch. 3.1 | The cut is movable (Jiang 2019). Playbooks must stay on the *agent* side of the cut. |
| **C5** | LLM agents can change later behavior by writing external memory without weight updates. That is not \(\pi_\theta\) improvement. | **holds-with-caveat** | research | CoALA; Reflexion; Voyager; ExpeL | \(\pi(a\mid s,M)\) *does* change when \(M\) changes. Do not call it DQN replay. |
| **C6** | Retention requires the next episode to start from the stored memory. Wiping the store cannot prove CL. | **holds-with-caveat** | research | ExpeL; Voyager new-world; Hu et al. 2026 | `env.reset(seed)` is not a store wipe. Our Evaluates wipe the *playbook db*. |
| **C7** | Version bumps / stats on the same default play are not policy transfer. Transfer needs later retrieve-and-use, plus quality vs a no-write control. | **holds-with-caveat** | our-bet | [LangChain memory blog](https://www.langchain.com/blog/how-to-give-your-agent-memory); Reflexion; Feng et al. 2026 | Same skill ID can still change params. Harmful transfer is still a policy change. Quality↑ is *beneficial* transfer, not the definition of \(\pi\) moved. |
| **C8** | Graph_Hockey SQLite playbooks *are* LangGraph Store long-term memory. | **fails** | our-bet | Stores + `compile({ store })` | We persist JSON beside the graph. `compileTeamGraph` only passes `checkpointer`. That is an application store, not `BaseStore`. |

---

## What the judge would **not** let us say in a pitch

- “The LangGraph Store is how the benches remember.” We do not compile with `store`.
- “Ten Evaluates proved the graph learned hockey.” Ice PRs moved Δ xG. Each Evaluate starts from **seed books in a fresh sqlite**.
- “Home retrieveTop 0/6 means learning failed.” After the lead-protect gate, 0/6 can be success (they stopped picking the illegal sheet). It is a **diagnostic**, not the live-learns pass.
- “Dump-in / high-slot / F2 chase is LangGraph learning.” Those are **environment** repairs (C4).
- “A version integer is knowledge retention.” Storage without later retrieve-and-use is not memory-in-use (C7).
- “Home Δ xG vs a learning away bench proves the staff got better.” Self-play EVAL is vs a **frozen** opponent (Zhang et al. 2024 survey; Search Self-play 2025). Opposing Δ xG is **`coadapt`**, not a quality fail. Cross-play HS/SH is how we claim a staff improved. **2026-08-27:** HS home μ 5.57 > SS 4.43; SH away μ 5.86 > SS 4.86. That sentence is now allowed **for chance mean vs seed books**, not for the quality bank and not for LangGraph Store.
- “Goals in a 7×20s series are skill.” Even-strength process (xG, chances) over goals; ~70% of NHL goals are 5v5 (DataDrivenHockey 2024).

---

## Synthesis (defender / prosecutor / judge)

### Defender

The product already matches the *pattern* LangGraph documents: short-term checkpointer on the epoch, long-term JSON documents written **after** the hot path (AAR), retrieved on the next invoke (`retrieve_plays`). CoALA calls writing LTM “learning.” Reflexion/Voyager/ExpeL show frozen LLMs can change later actions via a store. Within one sqlite, books go v1→v8 and the `--no-llm` twin stays v1. That is a real write-path proof.

### Prosecutor

We compile `MemorySaver` only, per-epoch `thread_id`, so the checkpointer is not even match-long memory — by design, but then **all** long-term knowledge has to live in playbooks. We then **throw the playbooks away** every counting Evaluate (`data/ser-emp-N.sqlite` is fresh). Home still opens `5v5-122-forecheck` every game. Ice PRs (dump-in, F2, high-slot, DZ outlet) are experimenter MDP edits. Crediting those as “LangGraph got smarter” is the C4 trap. SQLite JSON without `compile({ store })` is not the Store feature.

### Judge

Keep **three proofs**, never one slogan:

1. **Write path** — proven (`ser-emp-7` onward).
2. **Retention / transfer** — **not proven across series**. Machinery exists (`latestPlaybook` in one db). Protocol discards it.
3. **Hockey quality** — bank **2/5**. Late games improved; middle games starve chances. Do not cash ice as graph learning.

Label C8 **fails**. Fixing C8 is optional LangGraph-native wiring. Proving C6 does **not** require BaseStore — it requires **not wiping** the playbook between the learning series and the probe series.

---

## Annotated entries

### LangGraph / LangChain (primaries)

- **Persistence (JS).** https://docs.langchain.com/oss/javascript/langgraph/persistence — Checkpointer = thread graph state; Store = application KV across threads. Compile with either or both. *Plant:* our graphs compile checkpointer only. *Caveat:* Agent Server can inject both; we are a local Node host.
- **Stores (JS).** https://docs.langchain.com/oss/javascript/langgraph/stores — Namespaced JSON documents, `put`/`search`, optional embeddings. *Plant:* playbooks are namespaced by `team_id` + version in SQLite — same *idea*, not the *interface*.
- **Add memory (JS).** https://docs.langchain.com/oss/javascript/langgraph/add-memory — Cross-thread example: remember on `thread_id: "1"`, recall on `"2"` with the same user/store. *Plant:* our analog is game 0 AAR → game 1 `retrieve_plays`, not Store.
- **Memory overview (JS).** https://docs.langchain.com/oss/javascript/concepts/memory — Semantic / episodic / procedural; hot path vs background write. Background “eliminates latency in the primary application.” *Plant:* live epoch is hot path; AAR is background. That split is already correct.
- **How to give your agent memory (LangChain blog, 2026-06-24).** https://www.langchain.com/blog/how-to-give-your-agent-memory — A log is not memory until a later run retrieves it **and changes behavior**. *Plant:* `booksMoved` without retrieve-and-use is the failure mode they name.

### Cognitive architecture / agents

- **CoALA, Sumers et al., TMLR 2024.** https://arxiv.org/abs/2309.02427 — LTM = procedural (weights/code) + semantic (facts) + episodic (past behavior). Learning = **write LTM**. Grounding = env actions. *Plant:* ice = grounding/env; playbook writes = learning; event log/film = episodic.
- **Reflexion, Shinn et al. 2023.** https://arxiv.org/abs/2303.11366 — Linguistic feedback, no weight updates. Ablation: tests without reflection = no gain. *Plant:* `cite_check` + boost-if-xG>0 is our “don’t write empty lessons.”
- **Voyager, Wang et al. 2023.** https://arxiv.org/abs/2305.16291 — Skill library built in one world, used in a **new** world. *Plant:* this is the missing Evaluate: carry books into a new series/seed.
- **ExpeL, Zhao et al. 2024.** https://arxiv.org/abs/2308.10144 — Keep experiences **across tasks**; exam is one shot, not infinite retries. Distinguishes Reflexion-style same-instance loops from retention.
- **Feng et al. 2026, skill transfer.** https://arxiv.org/html/2608.20274v1 — Library growth / reuse counts hide contribution. Retrieved skills can **hurt** vs no-memory. *Plant:* quality vs `--no-llm` stays required; retrieve-and-hurt is still a policy change.

### RL / continual learning

- **Sutton & Barto, RL: An Introduction, Ch. 3.1.** http://incompleteideas.net/book/the-book-2nd.html — Agent vs environment; policy change from experience is learning; the cut is control, not knowledge.
- **Jiang 2019, agent-environment boundary.** https://arxiv.org/abs/1905.13341 — Same problem, different cuts, different “optimal” values. *Plant:* keep playbooks on the agent side or C4 becomes a tautology.
- **Hu, Long, Wang 2026, When Continual Learning Moves to Memory.** https://arxiv.org/abs/2604.27003 — Carry memory Task A → Task B. FWT/BWT. External memory does **not** dissolve stability–plasticity; pollution/dilution still happen.
- **Lin 1992, experience replay.** *Machine Learning* 8:293–321 — Replay feeds **gradient** updates. Do not equate AAR retrieval with DQN replay.

### Self-play / hockey metrics (2026-08-27 add)

- **Zhang et al. 2024, A Survey on Self-play Methods in RL.** https://arxiv.org/abs/2408.01072 — EVAL vs policy population / frozen copies. In-game score vs the live co-player is not skill.
- **Search Self-play, 2025.** https://arxiv.org/abs/2510.18821 — Solver in-game reward can dip while frozen-benchmark scores rise (opponent got harder). *Plant:* `flag coadapt`.
- **DataDrivenHockey 2024, rate stats and strength states.** https://www.data-driven-hockey.com/2024/02/21/hockey-analytics-primer-rate-stats-and-strength-states/ — ~70% of NHL goals even-strength; PP/PK rates are a different sport. *Plant:* evenShare / combined chances, not goals.

---

## Open questions (for the user, not silently decided)

1. Is **carry-forward Evaluate** (seed series B from series A’s after-game-6 books) the next counting Evaluate, or do we still spend cycle 3 attempt 1 on F2 OZ-carry ice?
2. Do we want a later PR that wraps playbooks in LangGraph `BaseStore` (honest “we use Store”), or is SQLite-beside-the-graph enough if retention is proven?
3. Bank of 5 stays Δ xG. Should retention get a **separate** pass/fail (carry vs seed-fresh) that does **not** steal a quality-bank slot?

See [`knowledge-and-learning.md`](knowledge-and-learning.md) for the recommended answers and PR plan.
