# Live-web report — bingbong.live-web.information-hunts (main-4dc72e9-3)

Generated 2026-09-29T11:52:52.361Z from a capture set created 2026-09-29T11:39:57.863Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): 4dc72e9d
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on

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
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | objective_met | 283760 ms | 283760 ms | 283763 ms | truncated_tool_results |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 183960 ms | 183960 ms | 183969 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 143442 ms | 143442 ms | 143445 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | pass | done | completed | objective_met | 234796 ms | 234796 ms | 234800 ms | usage_incomplete |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 93092 ms | 93092 ms | 93094 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | partial | deadline_reached | 360732 ms | 360732 ms | 360741 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=6 (missing 0) min 93092 ms | median 183960 ms | max 360732 ms
- unverified attempt Answer latency: no observations (missing 0)
- full Run duration (attempted): n=6 (missing 0) min 93094 ms | median 183969 ms | max 360741 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 468280 ms | 557 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 328188 ms | 296 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): main-4dc72e9-3--compatibility-pi-camera, main-4dc72e9-3--historical-longitude-watch, main-4dc72e9-3--rule-eurostar-luggage, main-4dc72e9-3--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 41 | 553.3171210000583 ms | 553.3171210000583 ms | 6 |
| browser-safety | 2 | 2.0798350000113714 ms | 2.0798350000113714 ms | 2 |
| browser-settle | 49 | 13169.363349 ms | 13169.363349 ms | 6 |
| llm | 70 | 1189927.6903650002 ms | 1189927.6903650002 ms | 6 |
| subagent-llm | 13 | 94379.41223100002 ms | 94379.41223100002 ms | 1 |
| tool | 76 | 106177.78763100028 ms | 106177.78763100028 ms | 6 |
| tts-synthesis | 6 | 3.412571000022581 ms | 3.412571000022581 ms | 6 |

- retries observed: 1 (counted, never timed) | tool calls: 77
- Subagents: 1 stopped (budget_exhausted 1)
- vision: 0 request(s), duration unavailable over 0 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 3.412571000022581 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1311174 | 66188 | 71 | 68 | no | GLM-5.3 |
| subagent | 1 | 0 | 5 | 259284 | 2556 | 13 | 13 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in main-4dc72e9-3--compatibility-pi-camera: events(e1ee9865), host_trace(ccca5715), perf(9dc8b3e1), run_trace(2f385ba2), usage_ledger(f3c13953), events(22b7c40e), stderr(4a81cf03), events(e1ee9865)
- compatibility-pi-camera--follow_up in main-4dc72e9-3--compatibility-pi-camera: events(e1ee9865), host_trace(ccca5715), perf(9dc8b3e1), run_trace(2f385ba2), usage_ledger(f3c13953), events(22b7c40e), stderr(4a81cf03), events(22b7c40e)
- historical-longitude-watch--initial in main-4dc72e9-3--historical-longitude-watch: events(afc28e03), host_trace(3f56b279), perf(8f8ed1f1), run_trace(d7fe2500), usage_ledger(41804348), stderr(f5c3912e), events(afc28e03)
- rule-eurostar-luggage--initial in main-4dc72e9-3--rule-eurostar-luggage: events(b779836a), host_trace(af648738), perf(ef572995), run_trace(51d2a411), usage_ledger(88ce0a91), events(b407d2f2), stderr(1a46a9e4), events(b779836a)
- rule-eurostar-luggage--follow_up in main-4dc72e9-3--rule-eurostar-luggage: events(b779836a), host_trace(af648738), perf(ef572995), run_trace(51d2a411), usage_ledger(88ce0a91), events(b407d2f2), stderr(1a46a9e4), events(b407d2f2)
- superseded-voyager-interstellar--initial in main-4dc72e9-3--superseded-voyager-interstellar: events(054a7f00), host_trace(1146091a), perf(7534267c), run_trace(192b1d8e), screenshot(b1505b4a), usage_ledger(96048d9c), stderr(755fc4ce), events(054a7f00)
