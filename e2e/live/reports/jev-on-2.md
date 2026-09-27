# Live-web report — bingbong.live-web.information-hunts (jev-on-2)

Generated 2026-09-27T05:18:48.947Z from a capture set created 2026-09-27T04:09:10.271Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): fda11fe4
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- reviewer(s): claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | decision seams: unset (every seam) | effort overrides: none | adblock: production_default | browser sub-spans: on

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 2/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 2 |
| revised_objective | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | unsuccessful | failed | — | budget_exhausted | 172291 ms | n/a | 172293 ms | deterministic_answer |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | objective_met | 280758 ms | n/a | 280761 ms | self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 134237 ms | n/a | 134239 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | pass | done | completed | objective_met | 199301 ms | 199301 ms | 199305 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 52529 ms | 52529 ms | 52531 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | completed | budget_exhausted | 255319 ms | 255319 ms | 255323 ms | — |

## Latency

- successful Task Completion Time: n=3 (missing 0) min 52529 ms | median 199301 ms | max 255319 ms
- unverified attempt Answer latency: n=3 (missing 0) min 134237 ms | median 172291 ms | max 280758 ms
- full Run duration (attempted): n=6 (missing 0) min 52531 ms | median 172293 ms | max 280761 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 482 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 252284 ms | 450 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): jev-on-2--compatibility-pi-camera, jev-on-2--historical-longitude-watch, jev-on-2--rule-eurostar-luggage, jev-on-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 66 | 853.1309269999656 ms | 853.1309269999656 ms | 6 |
| browser-safety | 5 | 4.829743000016606 ms | 4.829743000016606 ms | 2 |
| browser-settle | 112 | 21620.711324999902 ms | 21620.711324999902 ms | 6 |
| llm | 113 | 880537.6902650001 ms | 880537.6902650001 ms | 6 |
| subagent-llm | 13 | 109730.60691600008 ms | 109730.60691600008 ms | 1 |
| tool | 120 | 198046.02276900015 ms | 198046.02276900015 ms | 6 |
| tts-synthesis | 6 | 2.078672000032384 ms | 2.078672000032384 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 126
- Subagents: 1 stopped (budget_exhausted 1)
- vision: 1 request(s), 3236 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.078672000032384 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2241344 | 59696 | 113 | 113 | yes | GLM-5.3 |
| subagent | 1 | 0 | 5 | 160272 | 2260 | 13 | 13 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in jev-on-2--compatibility-pi-camera: events(d3387887), host_trace(ba2e7afe), perf(b3c0479e), run_trace(5626b349), screenshot(4b61b136), usage_ledger(d3cf9283), events(51ff298b), stderr(f795a50e), events(d3387887)
- compatibility-pi-camera--follow_up in jev-on-2--compatibility-pi-camera: events(d3387887), host_trace(ba2e7afe), perf(b3c0479e), run_trace(5626b349), screenshot(4b61b136), usage_ledger(d3cf9283), events(51ff298b), stderr(f795a50e), events(51ff298b)
- historical-longitude-watch--initial in jev-on-2--historical-longitude-watch: events(2c202442), host_trace(a626a307), perf(1b4e76f4), run_trace(4908eb35), screenshot(7db845d1), usage_ledger(43dff270), stderr(d2704231), events(2c202442)
- rule-eurostar-luggage--initial in jev-on-2--rule-eurostar-luggage: events(68fbe2b6), host_trace(882855ba), perf(e02d1356), run_trace(6df04270), usage_ledger(76b9f64f), events(d94ce9bc), stderr(9adba3d1), events(68fbe2b6)
- rule-eurostar-luggage--follow_up in jev-on-2--rule-eurostar-luggage: events(68fbe2b6), host_trace(882855ba), perf(e02d1356), run_trace(6df04270), usage_ledger(76b9f64f), events(d94ce9bc), stderr(9adba3d1), events(d94ce9bc)
- superseded-voyager-interstellar--initial in jev-on-2--superseded-voyager-interstellar: events(997b3511), host_trace(f3fab8eb), perf(afcba27d), run_trace(32851890), screenshot(9bee5bfb), usage_ledger(e738c509), stderr(267b2987), events(997b3511)
