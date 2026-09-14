# Live-web report — bingbong.live-web.information-hunts (baseline2-1)

Generated 2026-09-14T20:16:08.963Z from a capture set created 2026-09-14T19:11:32.158Z.

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
| initial | 0/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | objective_met | 305191 ms | n/a | 305193 ms | self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 165734 ms | 165734 ms | 165736 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 179401 ms | n/a | 179404 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 367783 ms | n/a | 367786 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 79945 ms | 79945 ms | 79947 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | budget_exhausted | 309390 ms | n/a | 309392 ms | — |

## Latency

- successful Task Completion Time: n=2 (missing 0) min 79945 ms | median 79945 ms | max 165734 ms
- unverified attempt Answer latency: n=4 (missing 0) min 179401 ms | median 305191 ms | max 367783 ms
- full Run duration (attempted): n=6 (missing 0) min 79947 ms | median 179404 ms | max 367786 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up pass | no | n/a | 679 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 480 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline2-1--compatibility-pi-camera, baseline2-1--historical-longitude-watch, baseline2-1--rule-eurostar-luggage, baseline2-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 47 | 599.7768410000099 ms | 599.7768410000099 ms | 6 |
| browser-safety | 6 | 3.285346999989997 ms | 3.285346999989997 ms | 3 |
| browser-settle | 101 | 15526.498549999975 ms | 15526.498549999975 ms | 6 |
| llm | 109 | 1320472.723348 ms | 1320472.723348 ms | 6 |
| subagent-llm | 31 | 203069.07007199997 ms | 84985.90939300001 ms | 1 |
| tool | 109 | 86348.77121199993 ms | 86348.77121199993 ms | 6 |
| tts-synthesis | 7 | 2.0946030000341125 ms | 2.0946030000341125 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 120
- Subagents: 3 stopped (budget_exhausted 1, model_answered 2), 1 bounded report(s)
- vision: 10 request(s), 31379 ms over 3 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.0946030000341125 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1851267 | 72574 | 109 | 109 | yes | GLM-5.3 |
| subagent | 1 | 0 | 5 | 439376 | 3805 | 31 | 31 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline2-1--compatibility-pi-camera: events(de222fd7), host_trace(2aee17c3), perf(343a4ab9), run_trace(0ce935dd), usage_ledger(c37a6f88), events(5630d12c), stderr(d50af5ce), events(de222fd7)
- compatibility-pi-camera--follow_up in baseline2-1--compatibility-pi-camera: events(de222fd7), host_trace(2aee17c3), perf(343a4ab9), run_trace(0ce935dd), usage_ledger(c37a6f88), events(5630d12c), stderr(d50af5ce), events(5630d12c)
- historical-longitude-watch--initial in baseline2-1--historical-longitude-watch: events(37e9ae51), host_trace(9c5febff), perf(f3641c2a), run_trace(8ec15f10), screenshot(8d3c0ba4), usage_ledger(2d9de4ab), stderr(2b05ac8c), events(37e9ae51)
- rule-eurostar-luggage--initial in baseline2-1--rule-eurostar-luggage: events(633381e5), host_trace(02efedd9), perf(41fc56ec), run_trace(d19f6e44), usage_ledger(23ac469e), events(51437b42), stderr(2d2ce39c), events(633381e5)
- rule-eurostar-luggage--follow_up in baseline2-1--rule-eurostar-luggage: events(633381e5), host_trace(02efedd9), perf(41fc56ec), run_trace(d19f6e44), usage_ledger(23ac469e), events(51437b42), stderr(2d2ce39c), events(51437b42)
- superseded-voyager-interstellar--initial in baseline2-1--superseded-voyager-interstellar: events(f5cbd6b0), host_trace(ed4ae0f4), perf(7e49f1db), run_trace(71439f92), screenshot(ed8fc763), usage_ledger(f3c85fde), stderr(3b50b27b), events(f5cbd6b0)
