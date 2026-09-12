# Live-web report — bingbong.live-web.information-hunts (pilot-1)

Generated 2026-09-12T16:19:28.485Z from a capture set created 2026-09-10T01:20:08.960Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): 17cb176f
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- routing: orchestrator=GLM-5.3-flash; subagent=GLM-5.3-flash; vision=GLM-4.6V
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
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | deadline_reached | 439859 ms | n/a | 439862 ms | usage_incomplete self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | unsuccessful | failed | — | deadline_reached | 458757 ms | n/a | 458761 ms | deterministic_answer usage_incomplete |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 380259 ms | n/a | 380262 ms | usage_incomplete |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 398919 ms | n/a | 398921 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | pass | done | completed | objective_met | 106202 ms | 106202 ms | 106204 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | deadline_reached | 442643 ms | n/a | 442646 ms | usage_incomplete |

## Latency

- successful Task Completion Time: n=1 (missing 0) min 106202 ms | median 106202 ms | max 106202 ms
- unverified attempt Answer latency: n=5 (missing 0) min 380259 ms | median 439859 ms | max 458757 ms
- full Run duration (attempted): n=6 (missing 0) min 106204 ms | median 398921 ms | max 458761 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 389 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a | 303 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): pilot-1--compatibility-pi-camera, pilot-1--historical-longitude-watch, pilot-1--rule-eurostar-luggage, pilot-1--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| llm | 127 | 2101086.692055 ms | 2101086.692055 ms | 6 |
| subagent-llm | 13 | 87907.64611600013 ms | 87907.64611600013 ms | 1 |
| tool | 117 | 125096.80901599968 ms | 125096.80901599968 ms | 6 |
| tts-synthesis | 7 | 3.8667310000455473 ms | 3.8667310000455473 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 132
- Subagents: 1 stopped (budget_exhausted 1)
- vision: 2 request(s), 12463 ms over 2 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 3.8667310000455473 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1782834 | 66497 | 127 | 121 | no | GLM-5.3-flash |
| subagent | 1 | 0 | 5 | 127786 | 1874 | 13 | 13 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in pilot-1--compatibility-pi-camera: events(1dc554eb), host_trace(9cf209dc), perf(cde1a421), run_trace(bbedd72b), screenshot(dc136715), usage_ledger(a4416852), events(51bcba9e), screenshot(020d4f0e), stderr(2bce5f1e), events(1dc554eb)
- compatibility-pi-camera--follow_up in pilot-1--compatibility-pi-camera: events(1dc554eb), host_trace(9cf209dc), perf(cde1a421), run_trace(bbedd72b), screenshot(dc136715), usage_ledger(a4416852), events(51bcba9e), screenshot(020d4f0e), stderr(2bce5f1e), events(51bcba9e)
- historical-longitude-watch--initial in pilot-1--historical-longitude-watch: events(0d64083b), host_trace(debbc446), perf(92467caa), run_trace(803bf26e), screenshot(eca05664), usage_ledger(6d31c875), stderr(20283f36), events(0d64083b)
- rule-eurostar-luggage--initial in pilot-1--rule-eurostar-luggage: events(46bf30f8), host_trace(18c70473), perf(f138508c), run_trace(b804406e), usage_ledger(291575b4), events(c72fc588), stderr(ae7f54bc), events(46bf30f8)
- rule-eurostar-luggage--follow_up in pilot-1--rule-eurostar-luggage: events(46bf30f8), host_trace(18c70473), perf(f138508c), run_trace(b804406e), usage_ledger(291575b4), events(c72fc588), stderr(ae7f54bc), events(c72fc588)
- superseded-voyager-interstellar--initial in pilot-1--superseded-voyager-interstellar: events(19d8c0df), host_trace(2b3ace5e), perf(e222737c), run_trace(e958f71f), screenshot(85e9a4fc), usage_ledger(07cc50a6), stderr(01fe211f), events(19d8c0df)
