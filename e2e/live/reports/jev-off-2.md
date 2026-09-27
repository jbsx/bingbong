# Live-web report — bingbong.live-web.information-hunts (jev-off-2)

Generated 2026-09-27T05:22:43.048Z from a capture set created 2026-09-27T04:30:12.583Z.

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
| initial | 3/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 3 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | objective_met | 289515 ms | n/a | 289517 ms | truncated_tool_results self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 256582 ms | 256582 ms | 256584 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 136178 ms | 136178 ms | 136181 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | pass | done | completed | objective_met | 128475 ms | 128475 ms | 128477 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 89169 ms | 89169 ms | 89170 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | partial | deadline_reached | 341833 ms | 341833 ms | 341836 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=5 (missing 0) min 89169 ms | median 136178 ms | max 341833 ms
- unverified attempt Answer latency: n=1 (missing 0) min 289515 ms | median 289515 ms | max 289515 ms
- full Run duration (attempted): n=6 (missing 0) min 89170 ms | median 136181 ms | max 341836 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up pass | no | n/a | 604 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 218002 ms | 356 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): jev-off-2--compatibility-pi-camera, jev-off-2--historical-longitude-watch, jev-off-2--rule-eurostar-luggage, jev-off-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 56 | 793.7033070000416 ms | 793.7033070000416 ms | 6 |
| browser-safety | 2 | 2.1216940000012983 ms | 2.1216940000012983 ms | 2 |
| browser-settle | 170 | 22226.079431999926 ms | 22226.079431999926 ms | 6 |
| llm | 90 | 1005167.6995949999 ms | 1005167.6995949999 ms | 6 |
| subagent-llm | 37 | 321814.66399399994 ms | 204459.91831999997 ms | 2 |
| tool | 101 | 236080.11955799983 ms | 236080.11955799983 ms | 6 |
| tts-synthesis | 6 | 1.8124160000588745 ms | 1.8124160000588745 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 108
- Subagents: 3 stopped (budget_exhausted 2, model_answered 1), 1 bounded report(s)
- vision: 0 request(s), duration unavailable over 0 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 1.8124160000588745 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1725991 | 53686 | 90 | 89 | no | GLM-5.3 |
| subagent | 2 | 0 | 4 | 564661 | 5334 | 37 | 37 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in jev-off-2--compatibility-pi-camera: events(d519316a), host_trace(ad9ff1d6), perf(1cafc118), run_trace(29802c16), usage_ledger(bf8a4109), events(e644c87e), run_trace(28071eb4), stderr(f5788711), events(d519316a)
- compatibility-pi-camera--follow_up in jev-off-2--compatibility-pi-camera: events(d519316a), host_trace(ad9ff1d6), perf(1cafc118), run_trace(29802c16), usage_ledger(bf8a4109), events(e644c87e), run_trace(28071eb4), stderr(f5788711), events(e644c87e)
- historical-longitude-watch--initial in jev-off-2--historical-longitude-watch: events(adb20ecd), host_trace(b60cabf8), perf(3e095e2c), run_trace(c06e27b8), usage_ledger(065a085e), stderr(c90902f4), events(adb20ecd)
- rule-eurostar-luggage--initial in jev-off-2--rule-eurostar-luggage: events(9dccf8a3), host_trace(0a7049ea), perf(c32c5e0d), run_trace(e066986d), usage_ledger(961f9a75), events(61daa9e2), stderr(f266f207), events(9dccf8a3)
- rule-eurostar-luggage--follow_up in jev-off-2--rule-eurostar-luggage: events(9dccf8a3), host_trace(0a7049ea), perf(c32c5e0d), run_trace(e066986d), usage_ledger(961f9a75), events(61daa9e2), stderr(f266f207), events(61daa9e2)
- superseded-voyager-interstellar--initial in jev-off-2--superseded-voyager-interstellar: events(02398ac0), host_trace(44e1d2f9), perf(f95930a5), run_trace(8639a13f), screenshot(8c5997db), usage_ledger(e6d19057), stderr(5bdb2ef4), events(02398ac0)
