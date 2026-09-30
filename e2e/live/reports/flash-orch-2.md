# Live-web report — bingbong.live-web.information-hunts (flash-orch-2)

Generated 2026-09-30T20:53:34.871Z from a capture set created 2026-09-30T20:09:51.125Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): f16dbd23
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3-flash; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 2/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 2 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | partial | deadline_reached | 492497 ms | 492497 ms | 492501 ms | usage_incomplete |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | partial | deadline_reached | 345244 ms | 345244 ms | 345246 ms | usage_incomplete |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | partial | deadline_reached | 388244 ms | 388244 ms | 388246 ms | usage_incomplete |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | partial | deadline_reached | 360518 ms | n/a | 360525 ms | usage_incomplete |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | useful_partial | done | completed | objective_met | 259942 ms | n/a | 259943 ms | self_declared_completed_but_unverified |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | deadline_reached | 365563 ms | n/a | 365571 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=3 (missing 0) min 345244 ms | median 388244 ms | max 492497 ms
- unverified attempt Answer latency: n=3 (missing 0) min 259942 ms | median 360518 ms | max 365563 ms
- full Run duration (attempted): n=6 (missing 0) min 259943 ms | median 360525 ms | max 492501 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 838209 ms | 464 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up not verified | no | n/a | 385 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): flash-orch-2--compatibility-pi-camera, flash-orch-2--historical-longitude-watch, flash-orch-2--rule-eurostar-luggage, flash-orch-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 66 | 1290.2351629998484 ms | 1290.2351629998484 ms | 6 |
| browser-safety | 2 | 1.4650759999931324 ms | 1.4650759999931324 ms | 1 |
| browser-settle | 174 | 22792.174248999894 ms | 22792.174248999894 ms | 6 |
| llm | 112 | 2032067.5995079996 ms | 2032067.5995079996 ms | 6 |
| tool | 109 | 129074.58614800006 ms | 129074.58614800006 ms | 6 |
| tts-synthesis | 8 | 3.5369689999497496 ms | 3.5369689999497496 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 112
- Subagents: 0 stopped (none delegated)
- vision: 5 request(s), 19657 ms over 3 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 45099 ms
- speech: synthesis 3.5369689999497496 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2098288 | 54145 | 112 | 105 | no | GLM-5.3-flash |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in flash-orch-2--compatibility-pi-camera: events(970eabbe), host_trace(84d9aff2), perf(0a81e71b), run_trace(40493461), screenshot(099d7b6a), usage_ledger(893c9ca9), events(a1c52d58), screenshot(9dd53793), stderr(6fea667d), events(970eabbe)
- compatibility-pi-camera--follow_up in flash-orch-2--compatibility-pi-camera: events(970eabbe), host_trace(84d9aff2), perf(0a81e71b), run_trace(40493461), screenshot(099d7b6a), usage_ledger(893c9ca9), events(a1c52d58), screenshot(9dd53793), stderr(6fea667d), events(a1c52d58)
- historical-longitude-watch--initial in flash-orch-2--historical-longitude-watch: events(4cc39f6f), host_trace(5e56509b), perf(a8c526cd), run_trace(0aea211c), screenshot(eca05664), usage_ledger(e55ce7af), stderr(94ac6fd2), events(4cc39f6f)
- rule-eurostar-luggage--initial in flash-orch-2--rule-eurostar-luggage: events(8f1b2ea9), host_trace(53ab0d4c), perf(fd58dbcf), run_trace(3457e275), screenshot(cb3ad6dc), usage_ledger(4df259f0), events(2d444060), stderr(1bec3785), events(8f1b2ea9)
- rule-eurostar-luggage--follow_up in flash-orch-2--rule-eurostar-luggage: events(8f1b2ea9), host_trace(53ab0d4c), perf(fd58dbcf), run_trace(3457e275), screenshot(cb3ad6dc), usage_ledger(4df259f0), events(2d444060), stderr(1bec3785), events(2d444060)
- superseded-voyager-interstellar--initial in flash-orch-2--superseded-voyager-interstellar: events(3e720c63), host_trace(0be93277), perf(965ee3bc), run_trace(be3a5171), screenshot(626980b4), usage_ledger(4543f51e), stderr(475a09d3), events(3e720c63)
