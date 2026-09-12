# Live-web report — bingbong.live-web.information-hunts (baseline-2)

Generated 2026-09-12T18:13:36.161Z from a capture set created 2026-09-12T18:10:26.845Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): 6152d8dc (dirty tree)
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
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | budget_exhausted | 401397 ms | n/a | 401400 ms | self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | budget_exhausted | 355037 ms | n/a | 355038 ms | usage_incomplete self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 216818 ms | n/a | 216821 ms | usage_incomplete |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 382036 ms | n/a | 382039 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 297080 ms | 297080 ms | 297082 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | budget_exhausted | 452936 ms | n/a | 452939 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=1 (missing 0) min 297080 ms | median 297080 ms | max 297080 ms
- unverified attempt Answer latency: n=5 (missing 0) min 216818 ms | median 382036 ms | max 452936 ms
- full Run duration (attempted): n=6 (missing 0) min 216821 ms | median 355038 ms | max 452939 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 388 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 446 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline-2--compatibility-pi-camera, baseline-2--historical-longitude-watch, baseline-2--rule-eurostar-luggage, baseline-2--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| llm | 147 | 1983730.0037900005 ms | 1983730.0037900005 ms | 6 |
| tool | 139 | 121099.51662399984 ms | 121099.51662399984 ms | 6 |
| tts-synthesis | 11 | 3.8263179999339627 ms | 3.8263179999339627 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 153
- Subagents: 0 stopped (none delegated)
- vision: 6 request(s), 27823 ms over 5 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 3.8263179999339627 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 2100188 | 70845 | 147 | 144 | no | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline-2--compatibility-pi-camera: events(f5bf0cc1), host_trace(6eff2dd4), perf(a2325911), run_trace(52824db3), screenshot(aecfd33e), usage_ledger(3a730ae1), events(c1db3e55), screenshot(b1980008), stderr(7b462718), events(f5bf0cc1)
- compatibility-pi-camera--follow_up in baseline-2--compatibility-pi-camera: events(f5bf0cc1), host_trace(6eff2dd4), perf(a2325911), run_trace(52824db3), screenshot(aecfd33e), usage_ledger(3a730ae1), events(c1db3e55), screenshot(b1980008), stderr(7b462718), events(c1db3e55)
- historical-longitude-watch--initial in baseline-2--historical-longitude-watch: events(883c417b), host_trace(49a281bf), perf(efbab983), run_trace(e2ee4220), screenshot(5aa5f7d8), usage_ledger(dc6e1b24), stderr(89fb8ed3), events(883c417b)
- rule-eurostar-luggage--initial in baseline-2--rule-eurostar-luggage: events(18b77d20), host_trace(d01b519d), perf(96bb3033), run_trace(a7bc868f), usage_ledger(1ae6ffcd), events(90dc6124), stderr(cc60a66d), events(18b77d20)
- rule-eurostar-luggage--follow_up in baseline-2--rule-eurostar-luggage: events(18b77d20), host_trace(d01b519d), perf(96bb3033), run_trace(a7bc868f), usage_ledger(1ae6ffcd), events(90dc6124), stderr(cc60a66d), events(90dc6124)
- superseded-voyager-interstellar--initial in baseline-2--superseded-voyager-interstellar: events(039d6652), host_trace(70c4899c), perf(b6b4d30e), run_trace(c6982080), screenshot(e2334394), usage_ledger(0c6dad74), stderr(24427f73), events(039d6652)
