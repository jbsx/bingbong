# Live-web report — bingbong.live-web.information-hunts (baseline-3)

Generated 2026-09-12T19:00:51.098Z from a capture set created 2026-09-12T18:57:29.347Z.

## Provenance

- mode: measured | set state: complete | protocol 1
- commit(s): 59bdf48b (dirty tree)
- prompt version(s): 1
- key 2.2.2.2, manifest sha256:faa25d04…, grades revision 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reasoning override: none | effort overrides: none | adblock: production_default

## Populations

Verified success is an independent review of the Answer against a private key. A Run that ended, or proposed `completed`, is not counted here.

| population | verified / scheduled | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 0/4 | 4 | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| revised_objective | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| both_step | 0/2 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |

## Attempts

| slot | hunt/step | disposition | grade | outcome | proposed | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera--initial | compatibility-pi-camera/initial | answered | useful_partial | done | completed | budget_exhausted | 266322 ms | n/a | 266324 ms | self_declared_completed_but_unverified |
| compatibility-pi-camera--follow_up | compatibility-pi-camera/follow_up | answered | useful_partial | done | completed | budget_exhausted | 443817 ms | n/a | 443819 ms | usage_incomplete self_declared_completed_but_unverified |
| historical-longitude-watch--initial | historical-longitude-watch/initial | answered | useful_partial | done | partial | budget_exhausted | 186555 ms | n/a | 186557 ms | usage_incomplete |
| rule-eurostar-luggage--initial | rule-eurostar-luggage/initial | answered | useful_partial | done | completed | objective_met | 310480 ms | n/a | 310484 ms | self_declared_completed_but_unverified |
| rule-eurostar-luggage--follow_up | rule-eurostar-luggage/follow_up | answered | useful_partial | done | partial | budget_exhausted | 119618 ms | n/a | 119619 ms | — |
| superseded-voyager-interstellar--initial | superseded-voyager-interstellar/initial | answered | useful_partial | done | partial | deadline_reached | 368438 ms | n/a | 368440 ms | usage_incomplete |

## Latency

- successful Task Completion Time: no observations (missing 0)
- unverified attempt Answer latency: n=6 (missing 0) min 119618 ms | median 266322 ms | max 443817 ms
- full Run duration (attempted): n=6 (missing 0) min 119619 ms | median 266324 ms | max 443819 ms

Min, median and max only. A pilot of three repeats per task does not support a p95, and none is offered.

## Initial and follow-up pairs

| hunt | initial | follow-up | both verified | sequence elapsed | inter-command gap |
| --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a | 791 ms |
| rule-eurostar-luggage | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up not verified | no | n/a | 375 ms |

## Where the time went

Stage totals are not additive: tool spans contain browser sub-spans and Subagent rounds overlap the tools they drive. No exclusive wall-time split or unexplained remainder is derived from them.

Span coverage: 6 attempt(s) with perf spans, 0 without. Clock origin(s): baseline-3--compatibility-pi-camera, baseline-3--historical-longitude-watch, baseline-3--rule-eurostar-luggage, baseline-3--superseded-voyager-interstellar.

| stage | spans | total (non-additive) | union | attempts |
| --- | --- | --- | --- | --- |
| llm | 111 | 1559245.2843960002 ms | 1559245.2843960002 ms | 6 |
| subagent-llm | 26 | 165201.7795270002 ms | 165201.7795270002 ms | 2 |
| tool | 102 | 135503.89208599966 ms | 135503.89208599966 ms | 5 |
| tts-synthesis | 9 | 3.610787999932654 ms | 3.610787999932654 ms | 6 |

- retries observed: 0 (counted, never timed) | tool calls: 112
- Subagents: 2 stopped (budget_exhausted 2)
- vision: 9 request(s), 19477 ms over 3 attempt(s)
- user waiting: n=6 (missing 0) min 0 ms | median 0 ms | max 0 ms
- speech: synthesis 3.610787999932654 ms, playback unavailable, voice input latency n/a (typed capture)

## Usage

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 6 | 0 | 0 | 1527257 | 46172 | 111 | 107 | no | GLM-5.3 |
| subagent | 2 | 0 | 4 | 179858 | 3441 | 26 | 26 | yes | GLM-5.3-flash |
| vision | 0 | 6 | 0 | 0 | 0 | 0 | 0 | no | — |

No cost estimate: none is produced without an explicit dated price list.

## Retained artifacts

Identities only; the files stay local and are never published through this report.

- compatibility-pi-camera--initial in baseline-3--compatibility-pi-camera: events(4702df5d), host_trace(056b1ace), perf(b0820e94), run_trace(2f4b21f9), screenshot(bc9a4c80), usage_ledger(39bae7d8), events(c317cc04), run_trace(18375c1b), screenshot(4d813d37), stderr(abeefcde), events(4702df5d)
- compatibility-pi-camera--follow_up in baseline-3--compatibility-pi-camera: events(4702df5d), host_trace(056b1ace), perf(b0820e94), run_trace(2f4b21f9), screenshot(bc9a4c80), usage_ledger(39bae7d8), events(c317cc04), run_trace(18375c1b), screenshot(4d813d37), stderr(abeefcde), events(c317cc04)
- historical-longitude-watch--initial in baseline-3--historical-longitude-watch: events(857f3da1), host_trace(b0dd915e), perf(6a4b0d47), run_trace(b2a98cb2), screenshot(5aa5f7d8), usage_ledger(81eb25ac), stderr(8ac93817), events(857f3da1)
- rule-eurostar-luggage--initial in baseline-3--rule-eurostar-luggage: events(f42a25ee), host_trace(b1c93ba7), perf(a02a287b), run_trace(0b20b93a), usage_ledger(2e707974), events(e26e9ef2), screenshot(4b4e6bcb), stderr(157657a3), events(f42a25ee)
- rule-eurostar-luggage--follow_up in baseline-3--rule-eurostar-luggage: events(f42a25ee), host_trace(b1c93ba7), perf(a02a287b), run_trace(0b20b93a), usage_ledger(2e707974), events(e26e9ef2), screenshot(4b4e6bcb), stderr(157657a3), events(e26e9ef2)
- superseded-voyager-interstellar--initial in baseline-3--superseded-voyager-interstellar: events(a81b1380), host_trace(c58d66c6), perf(c810ea2f), run_trace(7e283352), screenshot(5403e059), usage_ledger(ffd93480), stderr(06aa0361), events(a81b1380)
