# Live-web report — bingbong.live-web.information-hunts (pilot-2)

Generated 2026-09-12T16:19:30.270Z from a capture set created 2026-09-10T09:37:25.743Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): 517a7417
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | effort overrides: none | adblock: production_default

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 0/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | budget_exhausted | 423302 ms | n/a | 423304 ms | truncated_tool_results self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | objective_met | 358340 ms | n/a | 358341 ms | self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 128456 ms | n/a | 128459 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 356737 ms | n/a | 356739 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 116795 ms | 116795 ms | 116796 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | completed | objective_met | 384888 ms | n/a | 384890 ms | self_declared_completed_but_unverified |

## Latency

- successful Task Completion Time: n=1 (missing 0) min 116795 ms | median 116795 ms | max 116795 ms
- unverified attempt Answer latency: n=5 (missing 0) min 128456 ms | median 358340 ms | max 423302 ms
- full Run duration (attempted): n=6 (missing 0) min 116796 ms | median 356739 ms | max 423304 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 530 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 286 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): pilot-2--compatibility-pi-camera, pilot-2--historical-longitude-watch, pilot-2--rule-eurostar-luggage, pilot-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| llm | 111 | 1646733.0904330004 ms | 1646733.0904330004 ms | 6 |
| subagent-llm | 13 | 85245.4401309999 ms | 85245.4401309999 ms | 1 |
| tool | 112 | 121363.27051899962 ms | 121363.27051899962 ms | 6 |
| tts-synthesis | 10 | 2.4770899998547975 ms | 2.4770899998547975 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 123
- Subagents: 1 stopped (budget_exhausted 1)
- vision: 2 request(s), 6521 ms over 2 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.4770899998547975 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1708538 | 69347 | 111 | 111 | yes | GLM-5.3 |
| subagent | 1 | 0 | 5 | 93213 | 1563 | 13 | 13 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in pilot-2--compatibility-pi-camera: events(3c5a0fd7), host_trace(b2338a56), perf(02e588a0), run_trace(82af45c0), screenshot(5a47527e), usage_ledger(b94a2ffa), events(9be1ceca), stderr(92a86d8f), events(3c5a0fd7)
- compatibility-pi-camera--follow_up in pilot-2--compatibility-pi-camera: events(3c5a0fd7), host_trace(b2338a56), perf(02e588a0), run_trace(82af45c0), screenshot(5a47527e), usage_ledger(b94a2ffa), events(9be1ceca), stderr(92a86d8f), events(9be1ceca)
- historical-longitude-watch--initial in pilot-2--historical-longitude-watch: events(070c8cf0), host_trace(20612539), perf(744791aa), run_trace(d738bd3c), screenshot(5aa5f7d8), usage_ledger(301b4644), stderr(7a222b5c), events(070c8cf0)
- rule-eurostar-luggage--initial in pilot-2--rule-eurostar-luggage: events(7824114c), host_trace(e87d569f), perf(e47acbf1), run_trace(25638f19), usage_ledger(1978ee19), events(e43c1b41), stderr(0416fda3), events(7824114c)
- rule-eurostar-luggage--follow_up in pilot-2--rule-eurostar-luggage: events(7824114c), host_trace(e87d569f), perf(e47acbf1), run_trace(25638f19), usage_ledger(1978ee19), events(e43c1b41), stderr(0416fda3), events(e43c1b41)
- superseded-voyager-interstellar--initial in pilot-2--superseded-voyager-interstellar: events(39c2d515), host_trace(d3e8e1b3), perf(c74c6d2f), run_trace(5e822a40), usage_ledger(51e85f5a), stderr(984f7a89), events(39c2d515)
