# Live-web report — bingbong.live-web.information-hunts (jev-on-1)

Generated 2026-09-27T05:09:20.193Z from a capture set created 2026-09-27T03:32:26.417Z.

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
| initial | 3/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 3 |
| revised_objective | 2/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 2 |
| both_step | 1/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 1 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | pass | done | completed | objective_met | 238561 ms | 238561 ms | 238563 ms | — |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | pass | done | completed | objective_met | 197683 ms | 197683 ms | 197684 ms | — |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | pass | done | completed | objective_met | 96910 ms | 96910 ms | 96912 ms | — |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 120982 ms | n/a | 120985 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 56042 ms | 56042 ms | 56044 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | pass | done | completed | objective_met | 184988 ms | 184988 ms | 184992 ms | — |

## Latency

- successful Task Completion Time: n=5 (missing 0) min 56042 ms | median 184988 ms | max 238561 ms
- unverified attempt Answer latency: n=1 (missing 0) min 120982 ms | median 120982 ms | max 120982 ms
- full Run duration (attempted): n=6 (missing 0) min 56044 ms | median 120985 ms | max 238563 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 436732 ms | 486 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 313 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): jev-on-1--compatibility-pi-camera, jev-on-1--historical-longitude-watch, jev-on-1--rule-eurostar-luggage, jev-on-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| browser-recollection | 52 | 1044.4234670000587 ms | 1044.4234670000587 ms | 6 |
| browser-safety | 4 | 3.808982999980799 ms | 3.808982999980799 ms | 2 |
| browser-settle | 127 | 18023.344324999933 ms | 18023.344324999933 ms | 6 |
| llm | 91 | 807852.7956870003 ms | 807852.7956870003 ms | 6 |
| tool | 94 | 77002.88943800013 ms | 77002.88943800013 ms | 6 |
| tts-synthesis | 8 | 2.3293500000145286 ms | 2.3293500000145286 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 99
- Subagents: 0 stopped (none delegated)
- vision: 1 request(s), 3117 ms over 1 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 2.3293500000145286 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1668875 | 47757 | 91 | 91 | yes | GLM-5.3 |
| subagent | 0 | 0 | 6 | 0 | 0 | 0 | 0 | no | — |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in jev-on-1--compatibility-pi-camera: events(bf7f09f0), host_trace(31b19f36), perf(31de4f90), run_trace(2a3a2aca), usage_ledger(b40dc67a), events(f80afacc), stderr(b345d4ef), events(bf7f09f0)
- compatibility-pi-camera--follow_up in jev-on-1--compatibility-pi-camera: events(bf7f09f0), host_trace(31b19f36), perf(31de4f90), run_trace(2a3a2aca), usage_ledger(b40dc67a), events(f80afacc), stderr(b345d4ef), events(f80afacc)
- historical-longitude-watch--initial in jev-on-1--historical-longitude-watch: events(f063c61b), host_trace(4ca7bf58), perf(3f812ab9), run_trace(ae48ce61), usage_ledger(cd9c57b5), stderr(bc7a28c4), events(f063c61b)
- rule-eurostar-luggage--initial in jev-on-1--rule-eurostar-luggage: events(2404a1bb), host_trace(8ea3ba99), perf(516ff7f2), run_trace(85e93c0c), usage_ledger(db5135b6), events(8864904f), stderr(8791c62b), events(2404a1bb)
- rule-eurostar-luggage--follow_up in jev-on-1--rule-eurostar-luggage: events(2404a1bb), host_trace(8ea3ba99), perf(516ff7f2), run_trace(85e93c0c), usage_ledger(db5135b6), events(8864904f), stderr(8791c62b), events(8864904f)
- superseded-voyager-interstellar--initial in jev-on-1--superseded-voyager-interstellar: events(8575b364), host_trace(3d809912), perf(ad1de58f), run_trace(80b279a3), usage_ledger(f7d1bb26), stderr(2ec77718), events(8575b364)
