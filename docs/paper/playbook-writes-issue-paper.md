# Playbook Writes Are Not Beneficial Retrieve

### Frozen cross-play of language-model hockey coaches

**Graph_Hockey laboratory**

Keywords: language-model agents; long-term memory; self-play evaluation; retrieve-and-use; ice-hockey simulation

---

## Abstract

We ran twenty-five series of simulated ice hockey, seven games each. In every series the playbooks were locked: after the horn, the staff could not rewrite the sheet before the next faceoff. Three ways of using those sheets were compared—ask the trained book what to run, ask the original seed book what to run, and give both benches the seed book. Average scoring-chance volume did not leave one band (9.23 to 9.71 combined chances per game). Standard errors overlap.

It would be difficult to find anyone arguing against “the staff should remember the last game.” The argument that bumping a version number in a database *is* that memory is one of semantics.

The test must freeze the opponent’s book. Saving a lesson is a control. Using a lesson is a later game against an opponent that cannot rewrite while you play.

This plant is two language-model coaching staffs on a coded rink. Ice, not the model, moves the skaters. After a result, After-Action Review may write a structured playbook. The next game may read that book when choosing a play. A twin with the language model turned off never writes. That twin proves the write happens. It does not prove later hockey changed.

Measuring one learning staff against another learning staff is coadaptation, not skill (Zhang et al. 2024; Lu et al. 2025). The design here locks both books, uses the same model on both benches, and repeats the three ways of reading the book at five random seeds. What was counted: how many distinct scoring chances the trained side created, and both sides together.

On paired seeds, a trained home staff was +0.03 chances per game versus seed-versus-seed. A trained away staff was −0.17. Asking the trained away book what to run never beat asking the seed book (difference −0.51; every seed at or below zero). That is not a claim of harm. It is a failure to show help.

The scarce input is a coach answer inside eight seconds. If the model times out, the team keeps the last leftover play. Ice code is a second policy on the same stick.

**Conclusion.** Playbook writes fire. Retrieving those writes does not raise scoring-chance volume against an opponent whose book is locked. Official LangGraph Store, National Hockey League–calibrated expected goals, and “the staffs learned hockey” are not licensed by this evidence.

---

## 1. Background

### 1.1 The plant

Graph_Hockey is a deterministic ice-hockey simulation. Two benches compete on a rink 200 by 85 feet. Physics and rules advance at ten hertz. The puck, offside, icing, and goals are decided by code. A spectator may watch. The spectator process never calls a model and never receives the opponent playbook.

Each bench is a compiled LangGraph staff: home and away, separate short-term threads, separate playbooks. They do not vote as twelve skaters. They share a structured play—a JSON sheet that names a formation and a shot policy. A Head Coach, which is a language model, is queried only at decision epochs: faceoff, special-teams change, or a possession that has lasted about eight seconds of simulated time. Between those calls, coded roles (first forward through goalie) skate.

After the result, After-Action Review reads the event log and may patch the playbook. The next game may retrieve from that book. That loop is the object of study.

LangGraph documents split short-term thread state (a checkpointer) from long-term application documents (a store) (LangChain, Persistence; Stores). This plant compiles the checkpointer only. Playbooks reside in SQLite beside the graph. That is an application store, not compilation with a store argument. The claim that official LangGraph Store is how the benches remember does not survive the compile line (LangChain 2024).

Ice is environment. The staff cannot arbitrarily rewrite faceoff alignment or support-forward geometry from a prompt. Anything the agent cannot change at will is environment (Sutton and Barto, Ch. 3.1). The same physical loop, cut differently, yields different optimal values (Jiang 2019). Playbooks stay on the agent side of that cut, or “the graph learned hockey” becomes a tautology about whoever last edited the ice.

There are important interdependencies between those layers. Overlay shot policy is a staff action. Ice first-forward shoot still beats overlay pass in the offensive zone. Timeout leftover strips overlay so ice can shoot. A playbook slot that ice never reads is a geometry API in name only. Either layer can look like improvement if the test does not lock the other.

### 1.2 What the literature requires

CoALA labels writing long-term memory as a learning action (Sumers et al. 2024). That is a taxonomy. Instantiating it is not a result.

Frozen-weight agents can change later behavior by writing external memory. Reflexion, Voyager, and ExpeL were accepted because performance on the task moved, with ablations (Shinn et al. 2023; Wang et al. 2023; Zhao et al. 2024). A log is not memory until a later run retrieves it and uses it to change behavior (LangChain 2026). Mitchell’s test, which ExpeL prints as epigraph, is the same: experience counts as learning only if the measure on the task improves (Zhao et al. 2024). Retrieved skills can hurt (Feng et al. 2026). Library size is not contribution.

Competing coaches who write structured advice after a match are not a new experimental class. RoboCup’s coach wrote CLang playbooks from game logs while independent players executed (Kuhlmann, Knox, and Stone 2006). LLCoach generates soccer plans that robots run (Brienza et al. 2024). AgentPitch compiles two language-model strategies onto a deterministic football engine and rewrites them after the result (Tao 2026). FM-Bench seats competing club agents on a deterministic football world (Wang et al. 2026). Graph_Hockey is that split—JSON and a language-model Head Coach—on ice. The plant is unpublished. The class is not.

Skill in self-play is a payoff against frozen copies or a population, not in-game score against a co-learner who is also writing (Zhang et al. 2024; Berner et al. 2019; Vinyals et al. 2019). In-game reward can dip while a frozen benchmark rises, because the opponent got harder (Lu et al. 2025).

Goals in seven 20-second periods are not skill. National Hockey League process statistics accumulate over 60-minute games, and many of them (DataDrivenHockey 2024; MoneyPuck n.d.). This clock is a volume diagnostic: distinct shot clusters, 1.5 seconds apart. A 120-second minor penalty remains unscaled inside a 60-second regulation. Name the defect. Do not call the metric a fitted National Hockey League expected-goals model.

### 1.3 Prior measurements in this plant

A writing series with After-Action Review applied advances live playbooks from version 1 to version 8. A no-model twin, same physics seed, stays at version 1. That is the write path.

Restoring those rows into a new series is persistence, not continual learning (Hu, Long, and Wang 2026; Lopez-Paz and Ranzato 2017). Voyager’s transfer test is a new world with skills executed (Wang et al. 2023).

An earlier cross-play of trained versus seed books left the seed side still applying After-Action Review. Books still moved from version 1 to version 8. The opponent was not frozen. A ranking ablation on both-trained-versus-both-trained, one seed, cannot identify trained-versus-seed use.

---

## 2. Hypothesis

It would be difficult to find anyone arguing against “the staff should remember the last game.” The argument that a version integer *is* that memory is one of semantics.

The question is operational. Did the written book change later scoring-chance volume against an opponent whose book could not change on the same clock?

**H1.** With playbooks locked, a staff that reads the trained book’s preferred ranking produces a higher trained-side chance mean than seed-versus-seed.

**H2.** With the same trained sheet on the ice, reading the trained book’s ranking produces a higher trained-side chance mean than reading the seed book’s ranking.

**H0.** Live, seed-ranking, and seed-versus-seed sit in one band. The written book is dead weight on this metric.

Pre-registered outputs: trained-side distinct chance mean; combined chance mean (both benches). Freeze check: playbook version at game 6 equals version at game 0. Help is licensed only if H1 holds. Ranking as the mechanism is licensed only if H2 holds. Harm is not licensed without intervals that exclude zero (Feng et al. 2026).

The scarce input is a Head Coach completion inside eight seconds. If the model times out, leftover skating is ice plus the last play, not retrieve.

---

## 3. Methods

### 3.1 Design

Playbooks are locked for the entire series. After-Action Review writes a digest of the game and does not change the playbook version. The Head Coach is still asked each epoch. The same commercial language model sits on both benches, so side is not confounded with provider. Extending the timeout would buy time the live epoch does not have.

Playbooks restored for the trained side are those written during a prior seven-game series in which After-Action Review *did* apply (version 8). Each series is seven games of 20-second periods. Physics seeds: 7, 11, 19, 23, 29. Twenty-five series in all.

Table 1 is shorthand. “Live” means ask the trained book what to run. “Null” means keep that trained sheet but ask the original seed book what to run. “ss” means seed books on both benches. Home-trained (hs) and away-trained (sh) reverse which staff holds version 8.

**Table 1.** The three ways of reading the book, home-trained and away-trained.

| Path | Home book | Away book | Retrieve ranks |
| --- | --- | --- | --- |
| ss | seed | seed | seed |
| hs-live | trained | seed, locked | trained home book |
| hs-null | trained | seed, locked | seed JSON order |
| sh-live | seed, locked | trained | trained away book |
| sh-null | seed, locked | trained | seed JSON order |

A design for the real range of the problem may have to embody more than one path. Live without null cannot separate ranking from the sheet. Null without ss cannot say whether the sheet itself beat seed. Seed-versus-seed without a lock is co-play.

How will leftover defeat the intervention? By skating the seed 1-2-2 when the coach misses the window. How is that countered? A leftover-only twin, so the ranker is the policy, or a coach that finishes. This paper names the countermeasure. It does not close it.

### 3.2 Measures

A distinct chance is a cluster of shots by one side, broken after 1.5 seconds without a shot or after a stoppage. Combined chance mean is home plus away clusters, averaged across the seven games.

Chance mean is a volume diagnostic on a short clock. It is not National Hockey League expected goals (MoneyPuck n.d.; DataDrivenHockey 2024).

Means are reported ± standard error across the five seeds. Paired differences use the same physics seed.

---

## 4. Results

Playbook versions did not change in any of the twenty-five series. Seed-versus-seed stayed at version 1/1. Home-trained series stayed at 8/1. Away-trained series stayed at 1/8. The lock held.

**Table 2.** Distinct chance mean ± standard error (n = 5 seeds).

| Path | Home μ | Away μ | Combined μ |
| --- | ---: | ---: | ---: |
| ss | 4.89±0.32 | 4.77±0.38 | 9.66±0.21 |
| hs-live | 4.91±0.44 | 4.80±0.29 | 9.71±0.23 |
| hs-null | 4.74±0.30 | 4.80±0.20 | 9.54±0.25 |
| sh-live | 4.63±0.31 | 4.60±0.31 | 9.23±0.13 |
| sh-null | 4.54±0.39 | 5.11±0.23 | 9.66±0.31 |

**Table 3.** Paired differences, same physics seed.

| Contrast | Mean |
| --- | ---: |
| Trained home, live minus ss | +0.03 |
| Trained home, live minus null | +0.17 |
| Trained away, live minus ss | −0.17 |
| Trained away, live minus null | −0.51 (every seed ≤ 0) |

Live, null, and seed-versus-seed sit in one band. Combined volume does not separate.

The published retrieve-top field under seed ranking still names the live book. That is the stored menu, not the ranking leftover used. A leak in the scorecard, not a manipulation check. One seed-versus-seed series recorded a home offside maximum of three. That is an engine-storm gate, not the research question.

The write path from the writing series still stands: live versions advance; the no-model twin does not. Snapshot restore still loads rows. Loading is not this test.

---

## 5. Analysis

H1 is not supported. Trained home live minus seed-versus-seed is +0.03; signs mix across seeds. Trained away live minus seed-versus-seed is −0.17. Combined means occupy 9.23–9.71 with overlapping standard errors.

H2 is not supported as help. Trained away live minus null is −0.51, and every seed is at or below zero. Standard errors still overlap. Feng et al. (2026) require a no-memory contrast with intervals before a harm claim. The licensed sentence is: ranking the trained book is not shown to help.

H0 is the reading that survives. Written version-8 books are dead weight on this volume metric against an opponent whose book is locked.

Ice and leftover remain competing policies. If the coach misses eight seconds, the team skates seed structure. That can mask retrieve even when the JSON exists. Overlay pass that ice converts to shoot is the same class of leak: the sheet is not the motor.

Official LangGraph Store is not shown. The compile line does not pass a store.

A quality bank of two credits in five is not hockey science. Those credits were live-versus-live, and both home expected-goals deltas were negative. Ice patches (offside faceoff clamp, support-forward geometry) change the environment. No-model event hashes move when ice moves. That is not staff learning (Ng, Harada, and Russell 1999).

Goals as skill, version integers as retention, “both staffs improved,” and National Hockey League–calibrated expected goals are not licensed. Main-track originality of competing coaches who write playbooks after the horn is not licensed (Kuhlmann, Knox, and Stone 2006; Brienza et al. 2024; Tao 2026; Wang et al. 2026).

Autonomous staff is a misnomer. An operator starts the series, chooses models, and can stop the process. The Head Coach is a queried model on an eight-second leash.

Technology changes the status quo only if it changes later behavior against a locked opponent, or the time to an honest no. On this metric, the version-8 books do not change the first. They do buy the second.

---

## 6. Future work

What capabilities are essential, and how should they be prioritized?

Consider leftover-only and micro-only twins so retrieve ranking is the policy, not a menu the coach may ignore.

Examine whether play JSON (assignments, counters) moves anything if ranking does not. That is a different ablation: seed structure, zeroed statistics, trained sheet.

Compare lock-and-rank, as the counting experiment, against further ice geometry. If the claim is memory, ice is residual research and development.

Test a new written snapshot only after lock, factorial, and paired seeds are the protocol, not an exception.

Scale the penalty clock with period length, or stop treating 20-second volume as National Hockey League process.

The clock that matters is the eight-second coach window and the next locked-book series. Capability of the test—lock, three paths, five seeds—beats a larger log of co-adapting games.

---

## References

Berner, C., et al. 2019. “Dota 2 with Large Scale Deep Reinforcement Learning.” arXiv:1912.06680. https://arxiv.org/abs/1912.06680

Brienza, M., et al. 2024. “LLCoach: Generating Robot Soccer Plans Using Multi-Role Large Language Models.” arXiv:2406.18285. https://arxiv.org/abs/2406.18285

DataDrivenHockey. 2024. “Hockey Analytics Primer: Rate Stats and Strength States.” https://www.data-driven-hockey.com/2024/02/21/hockey-analytics-primer-rate-stats-and-strength-states/

Feng et al. 2026. Skill transfer. arXiv:2608.20274. https://arxiv.org/abs/2608.20274

Hu, S., Long, Y., and Wang, Y. 2026. “When Continual Learning Moves to Memory.” arXiv:2604.27003. https://arxiv.org/abs/2604.27003

Jiang, N. 2019. “On Value Functions and the Agent-Environment Boundary.” arXiv:1905.13341. https://arxiv.org/abs/1905.13341

Kuhlmann, G., Knox, W. B., and Stone, P. 2006. “Know Thine Enemy: A Champion RoboCup Coach Agent.” *Proceedings of the AAAI Conference on Artificial Intelligence*. https://aaai.org/papers/01463-aaai06-230-know-thine-enemy-a-champion-robocup-coach-agent/

LangChain. 2024. “Launching Long-Term Memory Support in LangGraph.” https://www.langchain.com/blog/launching-long-term-memory-support-in-langgraph

LangChain. 2026. “How to Give Your Agent Memory.” https://www.langchain.com/blog/how-to-give-your-agent-memory

LangChain. n.d. “Persistence (JavaScript).” https://docs.langchain.com/oss/javascript/langgraph/persistence

LangChain. n.d. “Stores (JavaScript).” https://docs.langchain.com/oss/javascript/langgraph/stores

Lopez-Paz, D., and Ranzato, M. 2017. “Gradient Episodic Memory for Continual Learning.” arXiv:1706.08840. https://arxiv.org/abs/1706.08840

Lu et al. 2025. “Search Self-play.” arXiv:2510.18821. https://arxiv.org/abs/2510.18821

MoneyPuck. n.d. “About.” https://moneypuck.com/about.htm

Ng, A. Y., Harada, D., and Russell, S. 1999. “Policy Invariance under Reward Transformations: Theory and Application to Reward Shaping.” *Proceedings of the Sixteenth International Conference on Machine Learning*.

Shinn, N., et al. 2023. “Reflexion: Language Agents with Verbal Reinforcement Learning.” arXiv:2303.11366. https://arxiv.org/abs/2303.11366

Sumers, T., Yao, S., Narasimhan, K., and Griffiths, T. 2024. “Cognitive Architectures for Language Agents.” *Transactions on Machine Learning Research*. arXiv:2309.02427. https://arxiv.org/abs/2309.02427

Sutton, R. S., and Barto, A. G. *Reinforcement Learning: An Introduction*. 2nd ed. Ch. 3.1. http://incompleteideas.net/book/the-book-2nd.html

Tao, G. 2026. AgentPitch. https://github.com/gangtao/AgentPitch/

Vinyals, O., et al. 2019. “Grandmaster Level in StarCraft II Using Multi-Agent Reinforcement Learning.” *Nature* 575: 350–354. https://www.nature.com/articles/s41586-019-1724-z

Wang, G., et al. 2023. “Voyager: An Open-Ended Embodied Agent with Large Language Models.” arXiv:2305.16291. https://arxiv.org/abs/2305.16291

Wang et al. 2026. “FM-Bench: A Benchmark for Long-Horizon Management with Competing Agents.” arXiv:2608.18423. https://arxiv.org/abs/2608.18423

Zhang et al. 2024. “A Survey on Self-play Methods in Reinforcement Learning.” arXiv:2408.01072. https://arxiv.org/abs/2408.01072

Zhao, A., et al. 2024. “ExpeL: LLM Agents Are Experiential Learners.” arXiv:2308.10144. https://arxiv.org/abs/2308.10144
