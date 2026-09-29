# Live-web report — bingbong.live-web.information-hunts (main-4dc72e9-1)

Generated 2026-09-29T11:44:02.195Z from a capture set created 2026-09-29T10:55:29.409Z.

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
| initial | 3/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 3 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | budget_exhausted | 281498 ms | 281498 ms | 281525 ms | usage_incomplete |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | objective_met | 160782 ms | n/a | 160785 ms | self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 164426 ms | 164426 ms | 164431 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 231118 ms | n/a | 231120 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 45344 ms | 45344 ms | 45346 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | completed | deadline_reached | 347480 ms | 347480 ms | 347483 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=4 (missing 0) min 45344 ms | median 164426 ms | max 347480 ms
- unverified attempt Answer latency: n=2 (missing 0) min 160782 ms | median 160782 ms | max 231118 ms
- full Run duration (attempted): n=6 (missing 0) min 45346 ms | median 164431 ms | max 347483 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up not verified | no | n/a | 537 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 469 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): main-4dc72e9-1--compatibility-pi-camera, main-4dc72e9-1--historical-longitude-watch, main-4dc72e9-1--rule-eurostar-luggage, main-4dc72e9-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 61 | 1096.6226539999916 ms | 1096.6226539999916 ms | 6 |
| browser-safety | 1 | 1.069523999998637 ms | 1.069523999998637 ms | 1 |
| browser-settle | 113 | 19581.557793999993 ms | 19581.557793999993 ms | 6 |
| llm | 86 | 1113854.0534700002 ms | 1113854.0534700002 ms | 6 |
| tool | 92 | 110904.03529300007 ms | 110904.03529300007 ms | 6 |
| tts-synthesis | 7 | 4.4194830000342336 ms | 4.4194830000342336 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 92
- Subagents: 0 stopped (none delegated)
- vision: 0 request(s), duration unavailable over 0 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 4.4194830000342336 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1762483 | 49041 | 86 | 84 | no | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in main-4dc72e9-1--compatibility-pi-camera: events(00e7779d), host_trace(cb719739), perf(04e900de), run_trace(0951b8f5), screenshot(4c45a8b7), usage_ledger(209050cf), events(332acc20), stderr(16dc374e), events(00e7779d)
- compatibility-pi-camera--follow_up in main-4dc72e9-1--compatibility-pi-camera: events(00e7779d), host_trace(cb719739), perf(04e900de), run_trace(0951b8f5), screenshot(4c45a8b7), usage_ledger(209050cf), events(332acc20), stderr(16dc374e), events(332acc20)
- historical-longitude-watch--initial in main-4dc72e9-1--historical-longitude-watch: events(ed793540), host_trace(a6585606), perf(512e5e0b), run_trace(90b7c8b5), usage_ledger(136908c2), stderr(626e5094), events(ed793540)
- rule-eurostar-luggage--initial in main-4dc72e9-1--rule-eurostar-luggage: events(bc22a487), host_trace(b34d5472), perf(89b762f9), run_trace(164e3bd4), usage_ledger(7c09be80), events(89bc79c9), stderr(90e47be3), events(bc22a487)
- rule-eurostar-luggage--follow_up in main-4dc72e9-1--rule-eurostar-luggage: events(bc22a487), host_trace(b34d5472), perf(89b762f9), run_trace(164e3bd4), usage_ledger(7c09be80), events(89bc79c9), stderr(90e47be3), events(89bc79c9)
- superseded-voyager-interstellar--initial in main-4dc72e9-1--superseded-voyager-interstellar: events(fbcbb068), host_trace(fd810d8e), perf(47772d7d), run_trace(1a25432c), screenshot(6357d701), usage_ledger(c4333fbb), stderr(1e40c6e0), events(fbcbb068)
