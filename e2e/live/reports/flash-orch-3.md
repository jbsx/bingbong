# Live-web report — bingbong.live-web.information-hunts (flash-orch-3)

Generated 2026-09-30T20:57:30.327Z from a capture set created 2026-09-30T20:43:40.455Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): f16dbd23
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3-flash; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 3/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 3 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | unsuccessful | failed | — | deadline_reached | 406555 ms | n/a | 406558 ms | deterministic_answer usage_incomplete |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | partial | deadline_reached | 483206 ms | n/a | 483211 ms | usage_incomplete |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | partial | deadline_reached | 336076 ms | 336076 ms | 336080 ms | usage_incomplete |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | pass | done | partial | budget_exhausted | 333302 ms | 333302 ms | 333306 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 102330 ms | 102330 ms | 102331 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | partial | deadline_reached | 346997 ms | 346997 ms | 347000 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=4 (missing 0) min 102330 ms | median 333302 ms | max 346997 ms
- unverified attempt Answer latency: n=2 (missing 0) min 406555 ms | median 406555 ms | max 483206 ms
- full Run duration (attempted): n=6 (missing 0) min 102331 ms | median 336080 ms | max 483211 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 579 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 435984 ms | 348 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): flash-orch-3--compatibility-pi-camera, flash-orch-3--historical-longitude-watch, flash-orch-3--rule-eurostar-luggage, flash-orch-3--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 70 | 1127.8032630000453 ms | 1127.8032630000453 ms | 6 |
| browser-safety | 9 | 8.192680999956792 ms | 8.192680999956792 ms | 5 |
| browser-settle | 245 | 29691.415338999726 ms | 29691.415338999726 ms | 6 |
| llm | 110 | 1861152.7736559997 ms | 1861152.7736559997 ms | 6 |
| subagent-llm | 5 | 50011.61774399999 ms | 50011.61774399999 ms | 1 |
| tool | 118 | 120635.34684799988 ms | 120635.34684799988 ms | 6 |
| tts-synthesis | 7 | 3.8594599998323247 ms | 3.8594599998323247 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 121
- Subagents: 1 stopped (deadline_reached 1)
- vision: 1 request(s), 3953 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 3.8594599998323247 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2046250 | 59423 | 110 | 104 | no | GLM-5.3-flash |
| subagent | 1 | 0 | 5 | 28638 | 960 | 5 | 5 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in flash-orch-3--compatibility-pi-camera: events(a34dc049), host_trace(451ac4bc), perf(0579d26c), run_trace(be46381c), screenshot(f42402a4), usage_ledger(f7813b73), events(e9eecda1), screenshot(02ee5d85), stderr(ebd9f07d), events(a34dc049)
- compatibility-pi-camera--follow_up in flash-orch-3--compatibility-pi-camera: events(a34dc049), host_trace(451ac4bc), perf(0579d26c), run_trace(be46381c), screenshot(f42402a4), usage_ledger(f7813b73), events(e9eecda1), screenshot(02ee5d85), stderr(ebd9f07d), events(e9eecda1)
- historical-longitude-watch--initial in flash-orch-3--historical-longitude-watch: events(f53d4b5d), host_trace(7c2331e9), perf(1c973993), run_trace(81e31fa7), screenshot(5aa5f7d8), usage_ledger(1ec94c8e), stderr(5614ee0b), events(f53d4b5d)
- rule-eurostar-luggage--initial in flash-orch-3--rule-eurostar-luggage: events(7b4cc363), host_trace(c30e5d27), perf(f1343362), run_trace(35f52a8d), screenshot(cb3ad6dc), usage_ledger(9339cb75), events(1d6830f7), stderr(335d9dc7), events(7b4cc363)
- rule-eurostar-luggage--follow_up in flash-orch-3--rule-eurostar-luggage: events(7b4cc363), host_trace(c30e5d27), perf(f1343362), run_trace(35f52a8d), screenshot(cb3ad6dc), usage_ledger(9339cb75), events(1d6830f7), stderr(335d9dc7), events(1d6830f7)
- superseded-voyager-interstellar--initial in flash-orch-3--superseded-voyager-interstellar: events(ae4f9b05), host_trace(5561afce), perf(b6d99fa9), run_trace(def6d2a8), screenshot(6bd13c9c), usage_ledger(e61924ff), stderr(5fe9e45f), events(ae4f9b05)
