# Live-web report — bingbong.live-web.information-hunts (main-4dc72e9-2)

Generated 2026-09-29T11:48:28.762Z from a capture set created 2026-09-29T11:17:58.098Z.

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
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | objective_met | 300800 ms | 300800 ms | 300827 ms | — |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 197890 ms | 197890 ms | 197895 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 176193 ms | 176193 ms | 176197 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | pass | done | completed | objective_met | 238048 ms | 238048 ms | 238052 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 47192 ms | 47192 ms | 47197 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | partial | deadline_reached | 367066 ms | 367066 ms | 367073 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=6 (missing 0) min 47192 ms | median 197890 ms | max 367066 ms
- unverified attempt Answer latency: no observations (missing 0)
- full Run duration (attempted): n=6 (missing 0) min 47197 ms | median 197895 ms | max 367073 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 499608 ms | 891 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 285560 ms | 316 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): main-4dc72e9-2--compatibility-pi-camera, main-4dc72e9-2--historical-longitude-watch, main-4dc72e9-2--rule-eurostar-luggage, main-4dc72e9-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 54 | 856.4627310000087 ms | 856.4627310000087 ms | 6 |
| browser-safety | 1 | 0.9844210000010207 ms | 0.9844210000010207 ms | 1 |
| browser-settle | 90 | 17140.64142199984 ms | 17140.64142199984 ms | 6 |
| llm | 87 | 1180691.995125 ms | 1180691.995125 ms | 6 |
| subagent-llm | 13 | 103486.55243600006 ms | 103486.55243600006 ms | 1 |
| tool | 91 | 141361.98692800006 ms | 141361.98692800006 ms | 6 |
| tts-synthesis | 8 | 3.6631620000407565 ms | 3.6631620000407565 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 94
- Subagents: 1 stopped (budget_exhausted 1)
- vision: 4 request(s), 10932 ms over 2 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 3.6631620000407565 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1824762 | 57647 | 87 | 86 | no | GLM-5.3 |
| subagent | 1 | 0 | 5 | 175932 | 2292 | 13 | 13 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in main-4dc72e9-2--compatibility-pi-camera: events(63ae6f24), host_trace(4fa72463), perf(ab627708), run_trace(23635857), run_trace(1f8e357a), usage_ledger(99f95165), events(6e15be9c), stderr(10fc24fd), events(63ae6f24)
- compatibility-pi-camera--follow_up in main-4dc72e9-2--compatibility-pi-camera: events(63ae6f24), host_trace(4fa72463), perf(ab627708), run_trace(23635857), run_trace(1f8e357a), usage_ledger(99f95165), events(6e15be9c), stderr(10fc24fd), events(6e15be9c)
- historical-longitude-watch--initial in main-4dc72e9-2--historical-longitude-watch: events(6ee3e78c), host_trace(1a66e189), perf(d5e1577f), run_trace(4ff64172), usage_ledger(0ce4fa44), stderr(fdaddd15), events(6ee3e78c)
- rule-eurostar-luggage--initial in main-4dc72e9-2--rule-eurostar-luggage: events(395ec689), host_trace(84d5f832), perf(302a4eed), run_trace(15eee4fb), usage_ledger(593b936e), events(247be8da), stderr(878d7c9b), events(395ec689)
- rule-eurostar-luggage--follow_up in main-4dc72e9-2--rule-eurostar-luggage: events(395ec689), host_trace(84d5f832), perf(302a4eed), run_trace(15eee4fb), usage_ledger(593b936e), events(247be8da), stderr(878d7c9b), events(247be8da)
- superseded-voyager-interstellar--initial in main-4dc72e9-2--superseded-voyager-interstellar: events(9f7b0626), host_trace(950ddf73), perf(db61c643), run_trace(8033f2db), screenshot(43f81135), usage_ledger(38717fff), stderr(fde5e8d9), events(9f7b0626)
