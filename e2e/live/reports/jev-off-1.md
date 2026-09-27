# Live-web report — bingbong.live-web.information-hunts (jev-off-1)

Generated 2026-09-27T05:13:40.331Z from a capture set created 2026-09-27T03:50:35.741Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): fda11fe4
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | decision seams: unset (every seam) | effort overrides: none | adblock: production_default | browser sub-spans: on

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 2/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 2 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | objective_met | 174701 ms | 174701 ms | 174704 ms | — |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 207929 ms | 207929 ms | 207930 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 97420 ms | 97420 ms | 97423 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | partial | model_answered | 179559 ms | n/a | 179562 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 79080 ms | 79080 ms | 79082 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | unsuccessful | failed | — | deadline_reached | 330387 ms | n/a | 330390 ms | deterministic_answer usage_incomplete |

## Latency

- successful Task Completion Time: n=4 (missing 0) min 79080 ms | median 97420 ms | max 207929 ms
- unverified attempt Answer latency: n=2 (missing 0) min 179559 ms | median 179559 ms | max 330387 ms
- full Run duration (attempted): n=6 (missing 0) min 79082 ms | median 174704 ms | max 330390 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 382962 ms | 329 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 460 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): jev-off-1--compatibility-pi-camera, jev-off-1--historical-longitude-watch, jev-off-1--rule-eurostar-luggage, jev-off-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 54 | 653.0470649999606 ms | 653.0470649999606 ms | 6 |
| browser-safety | 1 | 1.0791910000007192 ms | 1.0791910000007192 ms | 1 |
| browser-settle | 94 | 17320.279952999997 ms | 17320.279952999997 ms | 6 |
| llm | 108 | 999461.6365840001 ms | 999461.6365840001 ms | 6 |
| tool | 113 | 68870.73788999993 ms | 68870.73788999993 ms | 6 |
| tts-synthesis | 7 | 2.6814980000053765 ms | 2.6814980000053765 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 121
- Subagents: 0 stopped (none delegated)
- vision: 1 request(s), 3243 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.6814980000053765 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2310217 | 63390 | 108 | 106 | no | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in jev-off-1--compatibility-pi-camera: events(907a4448), host_trace(5f44a489), perf(184b169d), run_trace(ffeeb782), usage_ledger(57b948d9), events(659baf07), stderr(327345cb), events(907a4448)
- compatibility-pi-camera--follow_up in jev-off-1--compatibility-pi-camera: events(907a4448), host_trace(5f44a489), perf(184b169d), run_trace(ffeeb782), usage_ledger(57b948d9), events(659baf07), stderr(327345cb), events(659baf07)
- historical-longitude-watch--initial in jev-off-1--historical-longitude-watch: events(556a925e), host_trace(f36feb38), perf(b890f2de), run_trace(051c6937), usage_ledger(38cd2e6c), stderr(ade3d707), events(556a925e)
- rule-eurostar-luggage--initial in jev-off-1--rule-eurostar-luggage: events(f67d22c4), host_trace(d69adb78), perf(58d2951d), run_trace(fac242d2), usage_ledger(b0f08f02), events(bee58f73), stderr(64b6638f), events(f67d22c4)
- rule-eurostar-luggage--follow_up in jev-off-1--rule-eurostar-luggage: events(f67d22c4), host_trace(d69adb78), perf(58d2951d), run_trace(fac242d2), usage_ledger(b0f08f02), events(bee58f73), stderr(64b6638f), events(bee58f73)
- superseded-voyager-interstellar--initial in jev-off-1--superseded-voyager-interstellar: events(d43d573e), host_trace(f43c1cf2), perf(66ebbb49), run_trace(332d58d9), screenshot(2c0c8af7), usage_ledger(b14baaec), stderr(1ab4c24e), events(d43d573e)
