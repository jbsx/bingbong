# Live-web report — bingbong.live-web.information-hunts (baseline3-1)

Generated 2026-09-21T23:17:22.353Z from a capture set created 2026-09-21T22:43:12.488Z.

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
| initial | 1/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 1 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | budget_exhausted | 277514 ms | n/a | 277516 ms | self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | objective_met | 145502 ms | n/a | 145504 ms | self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 191045 ms | n/a | 191048 ms | truncated_tool_results |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 251090 ms | n/a | 251092 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 41581 ms | 41581 ms | 41582 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | completed | budget_exhausted | 226716 ms | 226716 ms | 226719 ms | — |

## Latency

- successful Task Completion Time: n=2 (missing 0) min 41581 ms | median 41581 ms | max 226716 ms
- unverified attempt Answer latency: n=4 (missing 0) min 145502 ms | median 191045 ms | max 277514 ms
- full Run duration (attempted): n=6 (missing 0) min 41582 ms | median 191048 ms | max 277516 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 566 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 432 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline3-1--compatibility-pi-camera, baseline3-1--historical-longitude-watch, baseline3-1--rule-eurostar-luggage, baseline3-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 59 | 1190.3418619999466 ms | 1190.3418619999466 ms | 6 |
| browser-safety | 3 | 2.87967499998922 ms | 2.87967499998922 ms | 2 |
| browser-settle | 73 | 17159.905326000116 ms | 17159.905326000116 ms | 6 |
| llm | 107 | 985483.6578990002 ms | 985483.6578990002 ms | 6 |
| tool | 111 | 87195.58053699994 ms | 87195.58053699994 ms | 6 |
| tts-synthesis | 7 | 2.236968999990495 ms | 2.236968999990495 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 120
- Subagents: 0 stopped (none delegated)
- vision: 9 request(s), 25242 ms over 3 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 60096 ms
- speech: synthesis 2.236968999990495 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2294957 | 48891 | 107 | 107 | yes | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline3-1--compatibility-pi-camera: events(4c3c4942), host_trace(d69b55ff), perf(1df5b838), run_trace(a19729bc), screenshot(d25c5b39), usage_ledger(f611d522), events(cc1a4ffc), stderr(7ec4ebf3), events(4c3c4942)
- compatibility-pi-camera--follow_up in baseline3-1--compatibility-pi-camera: events(4c3c4942), host_trace(d69b55ff), perf(1df5b838), run_trace(a19729bc), screenshot(d25c5b39), usage_ledger(f611d522), events(cc1a4ffc), stderr(7ec4ebf3), events(cc1a4ffc)
- historical-longitude-watch--initial in baseline3-1--historical-longitude-watch: events(7d7ce301), host_trace(6c007a9e), perf(6cb5f90f), run_trace(3bf980b2), screenshot(781868cd), usage_ledger(9d2699b8), stderr(dc1128fb), events(7d7ce301)
- rule-eurostar-luggage--initial in baseline3-1--rule-eurostar-luggage: events(78db88a1), host_trace(ee80b76b), perf(73bebb20), run_trace(7f8939ed), usage_ledger(9aa2b4f9), events(2ae0eb63), stderr(639f3579), events(78db88a1)
- rule-eurostar-luggage--follow_up in baseline3-1--rule-eurostar-luggage: events(78db88a1), host_trace(ee80b76b), perf(73bebb20), run_trace(7f8939ed), usage_ledger(9aa2b4f9), events(2ae0eb63), stderr(639f3579), events(2ae0eb63)
- superseded-voyager-interstellar--initial in baseline3-1--superseded-voyager-interstellar: events(75a145ae), host_trace(7cb1c972), perf(e48fdc25), run_trace(025c66d1), screenshot(4dd06dc6), usage_ledger(6dce417b), stderr(3497e5b5), events(75a145ae)
