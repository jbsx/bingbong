# Live-web report — bingbong.live-web.information-hunts (baseline2-3)

Generated 2026-09-14T20:16:17.704Z from a capture set created 2026-09-14T20:04:20.037Z.

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
| initial | 3/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 3 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | budget_exhausted | 369888 ms | 369888 ms | 369892 ms | truncated_tool_results usage_incomplete |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | budget_exhausted | 401086 ms | n/a | 401088 ms | truncated_tool_results usage_incomplete self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 263051 ms | 263051 ms | 263054 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 210070 ms | n/a | 210072 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 85842 ms | 85842 ms | 85843 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | completed | objective_met | 269242 ms | 269242 ms | 269245 ms | — |

## Latency

- successful Task Completion Time: n=4 (missing 0) min 85842 ms | median 263051 ms | max 369888 ms
- unverified attempt Answer latency: n=2 (missing 0) min 210070 ms | median 210070 ms | max 401086 ms
- full Run duration (attempted): n=6 (missing 0) min 85843 ms | median 263054 ms | max 401088 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up not verified | no | n/a | 1074 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 305 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline2-3--compatibility-pi-camera, baseline2-3--historical-longitude-watch, baseline2-3--rule-eurostar-luggage, baseline2-3--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 50 | 690.6135849997663 ms | 690.6135849997663 ms | 6 |
| browser-settle | 76 | 13889.641012000095 ms | 13889.641012000095 ms | 6 |
| llm | 126 | 1422995.9193630004 ms | 1422995.9193630004 ms | 6 |
| subagent-llm | 52 | 287159.141679 ms | 171753.96227599992 ms | 2 |
| tool | 134 | 175728.99026899965 ms | 175728.99026899965 ms | 6 |
| tts-synthesis | 6 | 2.0926810000964906 ms | 2.0926810000964906 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 144
- Subagents: 4 stopped (budget_exhausted 4), 1 bounded report(s)
- vision: 8 request(s), 26989 ms over 3 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.0926810000964906 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2208136 | 73752 | 126 | 124 | no | GLM-5.3 |
| subagent | 2 | 0 | 4 | 600364 | 7399 | 52 | 52 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline2-3--compatibility-pi-camera: events(64a05a17), host_trace(cb55a7a5), perf(daacfb8f), run_trace(561fe390), run_trace(937fd049), screenshot(020d4f0e), usage_ledger(d9f93a3e), events(c42c9e5f), run_trace(a4204fe8), screenshot(09bb2d3c), stderr(7be7dc4a), events(64a05a17)
- compatibility-pi-camera--follow_up in baseline2-3--compatibility-pi-camera: events(64a05a17), host_trace(cb55a7a5), perf(daacfb8f), run_trace(561fe390), run_trace(937fd049), screenshot(020d4f0e), usage_ledger(d9f93a3e), events(c42c9e5f), run_trace(a4204fe8), screenshot(09bb2d3c), stderr(7be7dc4a), events(c42c9e5f)
- historical-longitude-watch--initial in baseline2-3--historical-longitude-watch: events(bba779bf), host_trace(326514d1), perf(3283c9a6), run_trace(80c9db9c), usage_ledger(b10b64e3), stderr(4a280156), events(bba779bf)
- rule-eurostar-luggage--initial in baseline2-3--rule-eurostar-luggage: events(419910aa), host_trace(98956af0), perf(bb9632a4), run_trace(5c41e26b), usage_ledger(bd60141a), events(e54c918a), stderr(bee7c018), events(419910aa)
- rule-eurostar-luggage--follow_up in baseline2-3--rule-eurostar-luggage: events(419910aa), host_trace(98956af0), perf(bb9632a4), run_trace(5c41e26b), usage_ledger(bd60141a), events(e54c918a), stderr(bee7c018), events(e54c918a)
- superseded-voyager-interstellar--initial in baseline2-3--superseded-voyager-interstellar: events(a40115ad), host_trace(e2e317b8), perf(a8dc7906), run_trace(b097af6e), usage_ledger(465b0915), stderr(b852c2c4), events(a40115ad)
