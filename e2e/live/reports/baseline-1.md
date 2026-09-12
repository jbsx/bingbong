# Live-web report — bingbong.live-web.information-hunts (baseline-1)

Generated 2026-09-12T17:11:36.484Z from a capture set created 2026-09-12T17:06:30.219Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): fbd2b865 (dirty tree)
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
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | budget_exhausted | 423977 ms | n/a | 423979 ms | self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | deadline_reached | 401948 ms | n/a | 401951 ms | usage_incomplete self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 178435 ms | n/a | 178437 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | — | model_answered | 231362 ms | n/a | 231365 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 288264 ms | 288264 ms | 288265 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | budget_exhausted | 388288 ms | n/a | 388291 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=1 (missing 0) min 288264 ms | median 288264 ms | max 288264 ms
- unverified attempt Answer latency: n=5 (missing 0) min 178435 ms | median 388288 ms | max 423977 ms
- full Run duration (attempted): n=6 (missing 0) min 178437 ms | median 288265 ms | max 423979 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 539 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 253 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline-1--compatibility-pi-camera, baseline-1--historical-longitude-watch, baseline-1--rule-eurostar-luggage, baseline-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| llm | 115 | 1780725.7289260002 ms | 1780725.7289260002 ms | 6 |
| subagent-llm | 13 | 65203.95434800003 ms | 65203.95434800003 ms | 1 |
| tool | 112 | 130971.22526900015 ms | 130971.22526900015 ms | 6 |
| tts-synthesis | 8 | 2.9891530000895727 ms | 2.9891530000895727 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 123
- Subagents: 1 stopped (budget_exhausted 1)
- vision: 6 request(s), 26519 ms over 3 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.9891530000895727 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1687081 | 60863 | 115 | 113 | no | GLM-5.3 |
| subagent | 1 | 0 | 5 | 78032 | 897 | 13 | 13 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline-1--compatibility-pi-camera: events(a16562f6), host_trace(ce936a8a), perf(c130992a), run_trace(b8eb7cb7), screenshot(d3d665a0), usage_ledger(534c9e4e), events(bd5b3d47), screenshot(8e872ace), stderr(ca393ef5), events(a16562f6)
- compatibility-pi-camera--follow_up in baseline-1--compatibility-pi-camera: events(a16562f6), host_trace(ce936a8a), perf(c130992a), run_trace(b8eb7cb7), screenshot(d3d665a0), usage_ledger(534c9e4e), events(bd5b3d47), screenshot(8e872ace), stderr(ca393ef5), events(bd5b3d47)
- historical-longitude-watch--initial in baseline-1--historical-longitude-watch: events(88879239), host_trace(66b35a2e), perf(d8ce79dc), run_trace(e846a1dc), screenshot(5aa5f7d8), usage_ledger(2d659bd2), stderr(80d3b453), events(88879239)
- rule-eurostar-luggage--initial in baseline-1--rule-eurostar-luggage: events(35d2371f), host_trace(d6dfe732), perf(d29b4075), run_trace(9bed191d), usage_ledger(8f9f0f86), events(4d3f6161), stderr(7fba6e14), events(35d2371f)
- rule-eurostar-luggage--follow_up in baseline-1--rule-eurostar-luggage: events(35d2371f), host_trace(d6dfe732), perf(d29b4075), run_trace(9bed191d), usage_ledger(8f9f0f86), events(4d3f6161), stderr(7fba6e14), events(4d3f6161)
- superseded-voyager-interstellar--initial in baseline-1--superseded-voyager-interstellar: events(2eafa145), host_trace(453cc5eb), perf(fc2a4931), run_trace(35b8903f), screenshot(34dec865), usage_ledger(3d1b9278), stderr(9e60f9dd), events(2eafa145)
