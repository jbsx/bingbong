# Live-web report — bingbong.live-web.information-hunts (baseline2-2)

Generated 2026-09-14T20:16:14.168Z from a capture set created 2026-09-14T19:37:17.550Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): d683e814
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 1/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 1 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | objective_met | 444161 ms | 444161 ms | 444165 ms | truncated_tool_results |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | budget_exhausted | 346148 ms | 346148 ms | 346153 ms | usage_incomplete |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 185087 ms | n/a | 185090 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 235022 ms | n/a | 235025 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 71914 ms | 71914 ms | 71915 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | objective_met | 241981 ms | n/a | 241984 ms | — |

## Latency

- successful Task Completion Time: n=3 (missing 0) min 71914 ms | median 346148 ms | max 444161 ms
- unverified attempt Answer latency: n=3 (missing 0) min 185087 ms | median 235022 ms | max 241981 ms
- full Run duration (attempted): n=6 (missing 0) min 71915 ms | median 235025 ms | max 444165 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 791107 ms | 794 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 372 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline2-2--compatibility-pi-camera, baseline2-2--historical-longitude-watch, baseline2-2--rule-eurostar-luggage, baseline2-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 54 | 767.7043049996646 ms | 767.7043049996646 ms | 6 |
| browser-safety | 6 | 3.8648549999998068 ms | 3.8648549999998068 ms | 3 |
| browser-settle | 120 | 16867.745351999845 ms | 16867.745351999845 ms | 6 |
| llm | 122 | 1454967.5228930004 ms | 1454967.5228930004 ms | 6 |
| subagent-llm | 26 | 154454.03535300004 ms | 85629.95002100006 ms | 1 |
| tool | 122 | 68849.72094600009 ms | 68849.72094600009 ms | 6 |
| tts-synthesis | 7 | 4.331972999963909 ms | 4.331972999963909 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 134
- Subagents: 2 stopped (budget_exhausted 2)
- vision: 5 request(s), 12682 ms over 3 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 4.331972999963909 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2107579 | 83395 | 122 | 121 | no | GLM-5.3 |
| subagent | 1 | 0 | 5 | 363396 | 3999 | 26 | 26 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline2-2--compatibility-pi-camera: events(8145cca0), host_trace(b326252a), perf(bcda6790), run_trace(a6ba175d), usage_ledger(9f6ae38f), events(4ea4b392), screenshot(79a6f6d3), stderr(59da0ad3), events(8145cca0)
- compatibility-pi-camera--follow_up in baseline2-2--compatibility-pi-camera: events(8145cca0), host_trace(b326252a), perf(bcda6790), run_trace(a6ba175d), usage_ledger(9f6ae38f), events(4ea4b392), screenshot(79a6f6d3), stderr(59da0ad3), events(4ea4b392)
- historical-longitude-watch--initial in baseline2-2--historical-longitude-watch: events(4072ccdd), host_trace(fa5c3b3b), perf(39eb9de8), run_trace(4be6a71e), screenshot(618d37a0), usage_ledger(14fee1b1), stderr(82cca3d6), events(4072ccdd)
- rule-eurostar-luggage--initial in baseline2-2--rule-eurostar-luggage: events(83d402c0), host_trace(2e02c27e), perf(314ab5d5), run_trace(f3b5f6b4), usage_ledger(b1f58d55), events(416fee21), stderr(328a87c1), events(83d402c0)
- rule-eurostar-luggage--follow_up in baseline2-2--rule-eurostar-luggage: events(83d402c0), host_trace(2e02c27e), perf(314ab5d5), run_trace(f3b5f6b4), usage_ledger(b1f58d55), events(416fee21), stderr(328a87c1), events(416fee21)
- superseded-voyager-interstellar--initial in baseline2-2--superseded-voyager-interstellar: events(deb42aae), host_trace(0a467b28), perf(9e915d48), run_trace(b8213a7f), usage_ledger(ca8ab7f2), stderr(1f27df0d), events(deb42aae)
