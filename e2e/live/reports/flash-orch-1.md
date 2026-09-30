# Live-web report — bingbong.live-web.information-hunts (flash-orch-1)

Generated 2026-09-30T20:48:38.123Z from a capture set created 2026-09-30T19:32:39.437Z.

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
| initial | 1/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 1 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | partial | deadline_reached | 509064 ms | n/a | 509083 ms | usage_incomplete |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | partial | deadline_reached | 364762 ms | n/a | 364768 ms | truncated_tool_results usage_incomplete |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 243719 ms | 243719 ms | 243722 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | partial | deadline_reached | 466141 ms | n/a | 466144 ms | usage_incomplete |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 246418 ms | 246418 ms | 246420 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | unsuccessful | failed | — | deadline_reached | 389509 ms | n/a | 389511 ms | deterministic_answer usage_incomplete |

## Latency

- successful Task Completion Time: n=2 (missing 0) min 243719 ms | median 243719 ms | max 246418 ms
- unverified attempt Answer latency: n=4 (missing 0) min 364762 ms | median 389509 ms | max 509064 ms
- full Run duration (attempted): n=6 (missing 0) min 243722 ms | median 364768 ms | max 509083 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 310 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 397 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): flash-orch-1--compatibility-pi-camera, flash-orch-1--historical-longitude-watch, flash-orch-1--rule-eurostar-luggage, flash-orch-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 46 | 513.4218399999882 ms | 513.4218399999882 ms | 6 |
| browser-safety | 2 | 2.151390999999421 ms | 2.151390999999421 ms | 2 |
| browser-settle | 88 | 15312.017426999908 ms | 15312.017426999908 ms | 6 |
| llm | 90 | 2090853.7259980002 ms | 2090853.7259980002 ms | 6 |
| tool | 89 | 125463.33425000029 ms | 125463.33425000029 ms | 6 |
| tts-synthesis | 9 | 4.712441999872681 ms | 4.712441999872681 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 90
- Subagents: 0 stopped (none delegated)
- vision: 2 request(s), 5050 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 4.712441999872681 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1790096 | 60826 | 90 | 83 | no | GLM-5.3-flash |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in flash-orch-1--compatibility-pi-camera: events(b0189dff), host_trace(b2d21a3d), perf(8df80cdd), run_trace(f7f42716), screenshot(8c0229d6), usage_ledger(31ff0420), events(11091f48), screenshot(9d1c7fbe), stderr(5217eead), events(b0189dff)
- compatibility-pi-camera--follow_up in flash-orch-1--compatibility-pi-camera: events(b0189dff), host_trace(b2d21a3d), perf(8df80cdd), run_trace(f7f42716), screenshot(8c0229d6), usage_ledger(31ff0420), events(11091f48), screenshot(9d1c7fbe), stderr(5217eead), events(11091f48)
- historical-longitude-watch--initial in flash-orch-1--historical-longitude-watch: events(2c6e6227), host_trace(9883d0a3), perf(3655b425), run_trace(b2a804b7), usage_ledger(49eacc64), stderr(d8b90296), events(2c6e6227)
- rule-eurostar-luggage--initial in flash-orch-1--rule-eurostar-luggage: events(35c3728e), host_trace(af667c75), perf(8f61b478), run_trace(b32e236e), screenshot(cb3ad6dc), usage_ledger(49653dfc), events(db109a87), stderr(2d7cde0d), events(35c3728e)
- rule-eurostar-luggage--follow_up in flash-orch-1--rule-eurostar-luggage: events(35c3728e), host_trace(af667c75), perf(8f61b478), run_trace(b32e236e), screenshot(cb3ad6dc), usage_ledger(49653dfc), events(db109a87), stderr(2d7cde0d), events(db109a87)
- superseded-voyager-interstellar--initial in flash-orch-1--superseded-voyager-interstellar: events(f6a3d711), host_trace(b9e35ff4), perf(de042c36), run_trace(88ab657a), screenshot(c54b5f5d), usage_ledger(7ded99ef), stderr(c2943f95), events(f6a3d711)
