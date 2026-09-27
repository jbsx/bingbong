# Live-web report — bingbong.live-web.information-hunts (jev-on-3)

Generated 2026-09-27T05:26:13.898Z from a capture set created 2026-09-27T04:48:02.384Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): fda11fe4
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | decision seams: unset (every seam) | effort overrides: none | adblock: production_default | browser sub-spans: on

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 4 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | objective_met | 217703 ms | 217703 ms | 217707 ms | — |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 165220 ms | 165220 ms | 165222 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 106269 ms | 106269 ms | 106272 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | pass | done | completed | objective_met | 194548 ms | 194548 ms | 194551 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 57251 ms | 57251 ms | 57252 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | completed | objective_met | 309044 ms | 309044 ms | 309047 ms | — |

## Latency

- successful Task Completion Time: n=6 (missing 0) min 57251 ms | median 165220 ms | max 309044 ms
- unverified attempt Answer latency: no observations (missing 0)
- full Run duration (attempted): n=6 (missing 0) min 57252 ms | median 165222 ms | max 309047 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 383378 ms | 451 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 252203 ms | 401 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): jev-on-3--compatibility-pi-camera, jev-on-3--historical-longitude-watch, jev-on-3--rule-eurostar-luggage, jev-on-3--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 45 | 748.1657179998656 ms | 748.1657179998656 ms | 6 |
| browser-safety | 1 | 1.0618109999995795 ms | 1.0618109999995795 ms | 1 |
| browser-settle | 81 | 14781.044850999982 ms | 14781.044850999982 ms | 6 |
| llm | 82 | 876845.9548490001 ms | 876845.9548490001 ms | 6 |
| tool | 89 | 162035.24050799984 ms | 162035.24050799984 ms | 6 |
| tts-synthesis | 7 | 2.295066999984556 ms | 2.295066999984556 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 96
- Subagents: 0 stopped (none delegated)
- vision: 0 request(s), duration unavailable over 0 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.295066999984556 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1645011 | 50275 | 82 | 82 | yes | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in jev-on-3--compatibility-pi-camera: events(4d49b3f7), host_trace(17900b9b), perf(5f95716f), run_trace(212b3609), usage_ledger(faebd72f), events(8ab88316), stderr(5b6ecba7), events(4d49b3f7)
- compatibility-pi-camera--follow_up in jev-on-3--compatibility-pi-camera: events(4d49b3f7), host_trace(17900b9b), perf(5f95716f), run_trace(212b3609), usage_ledger(faebd72f), events(8ab88316), stderr(5b6ecba7), events(8ab88316)
- historical-longitude-watch--initial in jev-on-3--historical-longitude-watch: events(8aa1b700), host_trace(bc9d5b6e), perf(24700408), run_trace(604792b3), usage_ledger(08fc366f), stderr(fc3a2cc2), events(8aa1b700)
- rule-eurostar-luggage--initial in jev-on-3--rule-eurostar-luggage: events(b8e0bf00), host_trace(b858ae55), perf(2007d5a6), run_trace(23ee9576), usage_ledger(018130b7), events(9a4aa43b), stderr(e621d7cd), events(b8e0bf00)
- rule-eurostar-luggage--follow_up in jev-on-3--rule-eurostar-luggage: events(b8e0bf00), host_trace(b858ae55), perf(2007d5a6), run_trace(23ee9576), usage_ledger(018130b7), events(9a4aa43b), stderr(e621d7cd), events(9a4aa43b)
- superseded-voyager-interstellar--initial in jev-on-3--superseded-voyager-interstellar: events(3ad602f1), host_trace(54cee6d8), perf(e47435cd), run_trace(6a4fde83), usage_ledger(729d7f47), stderr(31b40ab0), events(3ad602f1)
