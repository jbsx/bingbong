# Live-web report — bingbong.live-web.information-hunts (baseline3-3)

Generated 2026-09-21T23:21:57.830Z from a capture set created 2026-09-21T23:15:05.370Z.

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
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | partial | budget_exhausted | 189472 ms | 189472 ms | 189475 ms | truncated_tool_results |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 162948 ms | 162948 ms | 162950 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 132154 ms | n/a | 132158 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 130897 ms | n/a | 130899 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 88177 ms | 88177 ms | 88178 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | unsuccessful | failed | — | budget_exhausted | 289239 ms | n/a | 289242 ms | deterministic_answer usage_incomplete |

## Latency

- successful Task Completion Time: n=3 (missing 0) min 88177 ms | median 162948 ms | max 189472 ms
- unverified attempt Answer latency: n=3 (missing 0) min 130897 ms | median 132154 ms | max 289239 ms
- full Run duration (attempted): n=6 (missing 0) min 88178 ms | median 132158 ms | max 289242 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 353114 ms | 691 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 377 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline3-3--compatibility-pi-camera, baseline3-3--historical-longitude-watch, baseline3-3--rule-eurostar-luggage, baseline3-3--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 48 | 902.4016689999298 ms | 902.4016689999298 ms | 6 |
| browser-safety | 1 | 1.3341749999999593 ms | 1.3341749999999593 ms | 1 |
| browser-settle | 94 | 13934.345375999987 ms | 13934.345375999987 ms | 6 |
| llm | 101 | 816996.0798809998 ms | 816996.0798809998 ms | 6 |
| subagent-llm | 13 | 102526.437675 ms | 102526.437675 ms | 1 |
| tool | 99 | 175251.01963400014 ms | 175251.01963400014 ms | 6 |
| tts-synthesis | 6 | 2.054485000029672 ms | 2.054485000029672 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 108
- Subagents: 1 stopped (budget_exhausted 1)
- vision: 4 request(s), 7157 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.054485000029672 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1796267 | 48405 | 101 | 100 | no | GLM-5.3 |
| subagent | 1 | 0 | 5 | 231706 | 2448 | 13 | 13 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline3-3--compatibility-pi-camera: events(37bfb046), host_trace(0c8b7495), perf(cc850ede), run_trace(2bba9859), screenshot(bd803f85), usage_ledger(a58e24c2), events(f5179a8b), stderr(f636b5e7), events(37bfb046)
- compatibility-pi-camera--follow_up in baseline3-3--compatibility-pi-camera: events(37bfb046), host_trace(0c8b7495), perf(cc850ede), run_trace(2bba9859), screenshot(bd803f85), usage_ledger(a58e24c2), events(f5179a8b), stderr(f636b5e7), events(f5179a8b)
- historical-longitude-watch--initial in baseline3-3--historical-longitude-watch: events(f099e121), host_trace(2b77b160), perf(1dcb6a32), run_trace(3ec160d2), screenshot(446ee52c), usage_ledger(c56d3625), stderr(739b52e1), events(f099e121)
- rule-eurostar-luggage--initial in baseline3-3--rule-eurostar-luggage: events(28e7d609), host_trace(692c31fc), perf(b312e926), run_trace(4871738e), usage_ledger(0a6b2c14), events(7d41105f), stderr(e4eeb93a), events(28e7d609)
- rule-eurostar-luggage--follow_up in baseline3-3--rule-eurostar-luggage: events(28e7d609), host_trace(692c31fc), perf(b312e926), run_trace(4871738e), usage_ledger(0a6b2c14), events(7d41105f), stderr(e4eeb93a), events(7d41105f)
- superseded-voyager-interstellar--initial in baseline3-3--superseded-voyager-interstellar: events(0db6b890), host_trace(f7fb3e34), perf(4e7e75f9), run_trace(134fe5f8), screenshot(406035f8), usage_ledger(e8a6072f), stderr(091476cf), events(0db6b890)
