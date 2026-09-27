# Live-web report — bingbong.live-web.information-hunts (jev-off-3)

Generated 2026-09-27T05:30:18.886Z from a capture set created 2026-09-27T05:05:35.175Z.

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
| initial | 4/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 4 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | budget_exhausted | 198967 ms | 198967 ms | 198969 ms | — |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 140212 ms | 140212 ms | 140215 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | budget_exhausted | 153374 ms | 153374 ms | 153376 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | pass | done | completed | objective_met | 135106 ms | 135106 ms | 135109 ms | — |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 64564 ms | 64564 ms | 64566 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | completed | deadline_reached | 341315 ms | 341315 ms | 341318 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=6 (missing 0) min 64564 ms | median 140212 ms | max 341315 ms
- unverified attempt Answer latency: no observations (missing 0)
- full Run duration (attempted): n=6 (missing 0) min 64566 ms | median 140215 ms | max 341318 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 339525 ms | 344 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 200025 ms | 352 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): jev-off-3--compatibility-pi-camera, jev-off-3--historical-longitude-watch, jev-off-3--rule-eurostar-luggage, jev-off-3--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 53 | 1021.3620879999562 ms | 1021.3620879999562 ms | 6 |
| browser-safety | 1 | 1.055597000002308 ms | 1.055597000002308 ms | 1 |
| browser-settle | 95 | 16923.26571900007 ms | 16923.26571900007 ms | 6 |
| llm | 99 | 903587.4916440002 ms | 903587.4916440002 ms | 6 |
| tool | 101 | 129308.326714 ms | 129308.326714 ms | 6 |
| tts-synthesis | 6 | 2.036673999973573 ms | 2.036673999973573 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 109
- Subagents: 0 stopped (none delegated)
- vision: 2 request(s), 2987 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.036673999973573 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1917061 | 50446 | 99 | 97 | no | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in jev-off-3--compatibility-pi-camera: events(4b216fbf), host_trace(44807398), perf(64c085a4), run_trace(70fe5956), screenshot(99c04aa6), usage_ledger(c9bf5469), events(88d9511f), stderr(4ef77924), events(4b216fbf)
- compatibility-pi-camera--follow_up in jev-off-3--compatibility-pi-camera: events(4b216fbf), host_trace(44807398), perf(64c085a4), run_trace(70fe5956), screenshot(99c04aa6), usage_ledger(c9bf5469), events(88d9511f), stderr(4ef77924), events(88d9511f)
- historical-longitude-watch--initial in jev-off-3--historical-longitude-watch: events(0d28b54e), host_trace(076aa12e), perf(06f9c3ac), run_trace(314a23d1), screenshot(eca05664), usage_ledger(a17dddb3), stderr(41cd1220), events(0d28b54e)
- rule-eurostar-luggage--initial in jev-off-3--rule-eurostar-luggage: events(1d843b47), host_trace(cb765676), perf(848d0a32), run_trace(57afdd68), usage_ledger(b9c64577), events(2f2f8b81), stderr(947e5bbf), events(1d843b47)
- rule-eurostar-luggage--follow_up in jev-off-3--rule-eurostar-luggage: events(1d843b47), host_trace(cb765676), perf(848d0a32), run_trace(57afdd68), usage_ledger(b9c64577), events(2f2f8b81), stderr(947e5bbf), events(2f2f8b81)
- superseded-voyager-interstellar--initial in jev-off-3--superseded-voyager-interstellar: events(a18c811f), host_trace(559f15f4), perf(f235295e), run_trace(94ebb794), screenshot(e5341796), usage_ledger(49bbe178), stderr(70afa267), events(a18c811f)
