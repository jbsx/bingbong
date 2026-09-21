# Live-web report — bingbong.live-web.information-hunts (baseline3-2)

Generated 2026-09-21T23:19:36.449Z from a capture set created 2026-09-21T22:58:11.646Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): 4096bddb
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 1/4 | 4 | 3 | 0 | 0 | 0 | 4 | 0 | 1 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | budget_exhausted | 224337 ms | 224337 ms | 224340 ms | — |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | budget_exhausted | 139738 ms | 139738 ms | 139739 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | no_answer | unsuccessful | failed | — | — | unavailable | n/a | 980 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 107585 ms | n/a | 107589 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 62923 ms | 62923 ms | 62925 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | deadline_reached | 338911 ms | n/a | 338915 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=3 (missing 0) min 62923 ms | median 139738 ms | max 224337 ms
- unverified attempt Answer latency: n=2 (missing 1) min 107585 ms | median 107585 ms | max 338911 ms
- full Run duration (attempted): n=6 (missing 0) min 980 ms | median 107589 ms | max 338915 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 364620 ms | 542 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 523 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline3-2--compatibility-pi-camera, baseline3-2--historical-longitude-watch, baseline3-2--rule-eurostar-luggage, baseline3-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 41 | 436.7887780001329 ms | 436.7887780001329 ms | 5 |
| browser-settle | 41 | 12340.637989000046 ms | 12340.637989000046 ms | 5 |
| llm | 80 | 770200.7421220003 ms | 770200.7421220003 ms | 6 |
| tool | 81 | 103650.18025699993 ms | 103650.18025699993 ms | 5 |
| tts-synthesis | 6 | 2.546714000054635 ms | 2.546714000054635 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 90
- Subagents: 0 stopped (none delegated)
- vision: 1 request(s), 3253 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.546714000054635 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 5 | 1 | 0 | 1813832 | 42173 | 79 | 78 | no | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline3-2--compatibility-pi-camera: events(b7bde4f8), host_trace(30671114), perf(7dd9f1ee), run_trace(1c4d0052), screenshot(7d286d6e), usage_ledger(c330d256), events(273f97a4), screenshot(9dd53793), stderr(7b5f1f42), events(b7bde4f8)
- compatibility-pi-camera--follow_up in baseline3-2--compatibility-pi-camera: events(b7bde4f8), host_trace(30671114), perf(7dd9f1ee), run_trace(1c4d0052), screenshot(7d286d6e), usage_ledger(c330d256), events(273f97a4), screenshot(9dd53793), stderr(7b5f1f42), events(273f97a4)
- historical-longitude-watch--initial in baseline3-2--historical-longitude-watch: events(3fe35513), host_trace(e696e3ab), perf(d1493721), run_trace(7fce9834), screenshot(5403e059), stderr(ee2b861a), events(3fe35513)
- rule-eurostar-luggage--initial in baseline3-2--rule-eurostar-luggage: events(9505b5d4), host_trace(1f045b7d), perf(8a91b6f7), run_trace(19f96bea), usage_ledger(61d94e6e), events(7e0abd35), stderr(3ea29f9d), events(9505b5d4)
- rule-eurostar-luggage--follow_up in baseline3-2--rule-eurostar-luggage: events(9505b5d4), host_trace(1f045b7d), perf(8a91b6f7), run_trace(19f96bea), usage_ledger(61d94e6e), events(7e0abd35), stderr(3ea29f9d), events(7e0abd35)
- superseded-voyager-interstellar--initial in baseline3-2--superseded-voyager-interstellar: events(4471ae15), host_trace(3bacde3e), perf(274dfef3), run_trace(91521be2), screenshot(def21bd7), usage_ledger(04cb83cc), stderr(578e6d28), events(4471ae15)
