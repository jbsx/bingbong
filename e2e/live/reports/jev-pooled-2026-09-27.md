# Live-web baseline summary — bingbong.live-web.information-hunts (6 passes)

Generated 2026-09-27T05:30:20.384Z over 6 passes, ordered by capture-set creation: jev-on-1, jev-off-1, jev-on-2, jev-off-2, jev-on-3, jev-off-3.

## Provenance

Shared by every input, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…
- routing differs, pooled by --allow-differs=routing: jev-on-1=decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-off-1=decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-on-2=decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-off-2=decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-on-3=decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-off-3=decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reviewer(s): claude-opus-5 via live:grade
- study bingbong.live-web.information-hunts, protocol 1, mode measured, prompt version(s) 1
- reasoning override: none | decision seams: unset (every seam) | effort overrides: none | adblock: production_default | browser sub-spans: on

Per input, listed and never compared:

| pass | report | created | set state | commit(s) | dirty tree | grades revision |
| --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | e2e/live/reports/jev-on-1.json | 2026-09-27T03:32:26.417Z | complete | fda11fe4 | no | 1 |
| jev-off-1 | e2e/live/reports/jev-off-1.json | 2026-09-27T03:50:35.741Z | complete | fda11fe4 | no | 1 |
| jev-on-2 | e2e/live/reports/jev-on-2.json | 2026-09-27T04:09:10.271Z | complete | fda11fe4 | no | 1 |
| jev-off-2 | e2e/live/reports/jev-off-2.json | 2026-09-27T04:30:12.583Z | complete | fda11fe4 | no | 1 |
| jev-on-3 | e2e/live/reports/jev-on-3.json | 2026-09-27T04:48:02.384Z | complete | fda11fe4 | no | 1 |
| jev-off-3 | e2e/live/reports/jev-off-3.json | 2026-09-27T05:05:35.175Z | complete | fda11fe4 | no | 1 |

## Populations

Verified over scheduled, summed across passes, with each pass beside the sum. Verified success is the independent review, never the Run’s own claim.

| population | verified / scheduled | per pass | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 18/24 (75%) | jev-on-1 3/4 · jev-off-1 2/4 · jev-on-2 2/4 · jev-off-2 3/4 · jev-on-3 4/4 · jev-off-3 4/4 | 24 | 24 | 0 | 0 | 0 | 24 | 0 | 18 |
| revised_objective | 11/12 (92%) | jev-on-1 2/2 · jev-off-1 2/2 · jev-on-2 1/2 · jev-off-2 2/2 · jev-on-3 2/2 · jev-off-3 2/2 | 12 | 12 | 0 | 0 | 0 | 12 | 0 | 11 |
| both_step | 8/12 (67%) | jev-on-1 1/2 · jev-off-1 1/2 · jev-on-2 1/2 · jev-off-2 1/2 · jev-on-3 2/2 · jev-off-3 2/2 | 12 | 12 | 0 | 0 | 0 | 12 | 0 | 8 |

## Tasks

One section per task (hunt × step), one row per pass. A Task Completion Time belongs to a verified Answer only; an unverified Answer keeps its latency as a measurement.

### compatibility-pi-camera / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | compatibility-pi-camera--initial | answered | pass | objective_met | 238561 ms | 238561 ms | 238563 ms | — |
| jev-off-1 | compatibility-pi-camera--initial | answered | pass | objective_met | 174701 ms | 174701 ms | 174704 ms | — |
| jev-on-2 | compatibility-pi-camera--initial | answered | unsuccessful | budget_exhausted | 172291 ms | n/a | 172293 ms | deterministic_answer |
| jev-off-2 | compatibility-pi-camera--initial | answered | useful_partial | objective_met | 289515 ms | n/a | 289517 ms | truncated_tool_results self_declared_completed_but_unverified |
| jev-on-3 | compatibility-pi-camera--initial | answered | pass | objective_met | 217703 ms | 217703 ms | 217707 ms | — |
| jev-off-3 | compatibility-pi-camera--initial | answered | pass | budget_exhausted | 198967 ms | 198967 ms | 198969 ms | — |

- attempts 6, answered 6, verified 4 over 6 passes
- Task Completion Time (verified): n=4 of 6 passes: min 174701 ms | median 208335 ms | max 238561 ms
- Answer latency (unverified): n=2 of 6 passes: min 172291 ms | median 230903 ms | max 289515 ms
- full Run duration: n=6 of 6 passes: min 172293 ms | median 208338 ms | max 289517 ms
- finalization causes: budget_exhausted 2, objective_met 4
- flags: deterministic_answer 1, self_declared_completed_but_unverified 1, truncated_tool_results 1

### compatibility-pi-camera / follow_up (revised_objective, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | compatibility-pi-camera--follow_up | answered | pass | objective_met | 197683 ms | 197683 ms | 197684 ms | — |
| jev-off-1 | compatibility-pi-camera--follow_up | answered | pass | objective_met | 207929 ms | 207929 ms | 207930 ms | — |
| jev-on-2 | compatibility-pi-camera--follow_up | answered | useful_partial | objective_met | 280758 ms | n/a | 280761 ms | self_declared_completed_but_unverified |
| jev-off-2 | compatibility-pi-camera--follow_up | answered | pass | objective_met | 256582 ms | 256582 ms | 256584 ms | — |
| jev-on-3 | compatibility-pi-camera--follow_up | answered | pass | objective_met | 165220 ms | 165220 ms | 165222 ms | — |
| jev-off-3 | compatibility-pi-camera--follow_up | answered | pass | objective_met | 140212 ms | 140212 ms | 140215 ms | — |

- attempts 6, answered 6, verified 5 over 6 passes
- Task Completion Time (verified): n=5 of 6 passes: min 140212 ms | median 197683 ms | max 256582 ms
- Answer latency (unverified): n=1 of 6 passes: min 280758 ms | median 280758 ms | max 280758 ms
- full Run duration: n=6 of 6 passes: min 140215 ms | median 202807 ms | max 280761 ms
- finalization causes: objective_met 6
- flags: self_declared_completed_but_unverified 1

### historical-longitude-watch / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | historical-longitude-watch--initial | answered | pass | objective_met | 96910 ms | 96910 ms | 96912 ms | — |
| jev-off-1 | historical-longitude-watch--initial | answered | pass | objective_met | 97420 ms | 97420 ms | 97423 ms | — |
| jev-on-2 | historical-longitude-watch--initial | answered | useful_partial | budget_exhausted | 134237 ms | n/a | 134239 ms | — |
| jev-off-2 | historical-longitude-watch--initial | answered | pass | objective_met | 136178 ms | 136178 ms | 136181 ms | — |
| jev-on-3 | historical-longitude-watch--initial | answered | pass | objective_met | 106269 ms | 106269 ms | 106272 ms | — |
| jev-off-3 | historical-longitude-watch--initial | answered | pass | budget_exhausted | 153374 ms | 153374 ms | 153376 ms | — |

- attempts 6, answered 6, verified 5 over 6 passes
- Task Completion Time (verified): n=5 of 6 passes: min 96910 ms | median 106269 ms | max 153374 ms
- Answer latency (unverified): n=1 of 6 passes: min 134237 ms | median 134237 ms | max 134237 ms
- full Run duration: n=6 of 6 passes: min 96912 ms | median 120255.5 ms | max 153376 ms
- finalization causes: budget_exhausted 2, objective_met 4
- flags: none

### rule-eurostar-luggage / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | rule-eurostar-luggage--initial | answered | useful_partial | objective_met | 120982 ms | n/a | 120985 ms | self_declared_completed_but_unverified |
| jev-off-1 | rule-eurostar-luggage--initial | answered | useful_partial | model_answered | 179559 ms | n/a | 179562 ms | — |
| jev-on-2 | rule-eurostar-luggage--initial | answered | pass | objective_met | 199301 ms | 199301 ms | 199305 ms | — |
| jev-off-2 | rule-eurostar-luggage--initial | answered | pass | objective_met | 128475 ms | 128475 ms | 128477 ms | — |
| jev-on-3 | rule-eurostar-luggage--initial | answered | pass | objective_met | 194548 ms | 194548 ms | 194551 ms | — |
| jev-off-3 | rule-eurostar-luggage--initial | answered | pass | objective_met | 135106 ms | 135106 ms | 135109 ms | — |

- attempts 6, answered 6, verified 4 over 6 passes
- Task Completion Time (verified): n=4 of 6 passes: min 128475 ms | median 164827 ms | max 199301 ms
- Answer latency (unverified): n=2 of 6 passes: min 120982 ms | median 150270.5 ms | max 179559 ms
- full Run duration: n=6 of 6 passes: min 120985 ms | median 157335.5 ms | max 199305 ms
- finalization causes: model_answered 1, objective_met 5
- flags: self_declared_completed_but_unverified 1

### rule-eurostar-luggage / follow_up (revised_objective, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 56042 ms | 56042 ms | 56044 ms | — |
| jev-off-1 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 79080 ms | 79080 ms | 79082 ms | — |
| jev-on-2 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 52529 ms | 52529 ms | 52531 ms | — |
| jev-off-2 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 89169 ms | 89169 ms | 89170 ms | — |
| jev-on-3 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 57251 ms | 57251 ms | 57252 ms | — |
| jev-off-3 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 64564 ms | 64564 ms | 64566 ms | — |

- attempts 6, answered 6, verified 6 over 6 passes
- Task Completion Time (verified): n=6 of 6 passes: min 52529 ms | median 60907.5 ms | max 89169 ms
- Answer latency (unverified): no observations (n=0 of 6 passes)
- full Run duration: n=6 of 6 passes: min 52531 ms | median 60909 ms | max 89170 ms
- finalization causes: objective_met 6
- flags: none

### superseded-voyager-interstellar / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | superseded-voyager-interstellar--initial | answered | pass | objective_met | 184988 ms | 184988 ms | 184992 ms | — |
| jev-off-1 | superseded-voyager-interstellar--initial | answered | unsuccessful | deadline_reached | 330387 ms | n/a | 330390 ms | deterministic_answer usage_incomplete |
| jev-on-2 | superseded-voyager-interstellar--initial | answered | pass | budget_exhausted | 255319 ms | 255319 ms | 255323 ms | — |
| jev-off-2 | superseded-voyager-interstellar--initial | answered | pass | deadline_reached | 341833 ms | 341833 ms | 341836 ms | usage_incomplete |
| jev-on-3 | superseded-voyager-interstellar--initial | answered | pass | objective_met | 309044 ms | 309044 ms | 309047 ms | — |
| jev-off-3 | superseded-voyager-interstellar--initial | answered | pass | deadline_reached | 341315 ms | 341315 ms | 341318 ms | usage_incomplete |

- attempts 6, answered 6, verified 5 over 6 passes
- Task Completion Time (verified): n=5 of 6 passes: min 184988 ms | median 309044 ms | max 341833 ms
- Answer latency (unverified): n=1 of 6 passes: min 330387 ms | median 330387 ms | max 330387 ms
- full Run duration: n=6 of 6 passes: min 184992 ms | median 319718.5 ms | max 341836 ms
- finalization causes: budget_exhausted 1, deadline_reached 3, objective_met 2
- flags: deterministic_answer 1, usage_incomplete 3

## Both-step sequences

Per hunt with a follow-up: initial acceptance to the follow-up’s Answer, over the pairs both steps of which verified.

### compatibility-pi-camera

| pass | initial | follow-up | both verified | sequence elapsed |
| --- | --- | --- | --- | --- |
| jev-on-1 | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 436732 ms |
| jev-off-1 | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 382962 ms |
| jev-on-2 | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a |
| jev-off-2 | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up pass | no | n/a |
| jev-on-3 | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 383378 ms |
| jev-off-3 | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 339525 ms |

- both-step sequence elapsed: n=4 of 6 passes: min 339525 ms | median 383170 ms | max 436732 ms

### rule-eurostar-luggage

| pass | initial | follow-up | both verified | sequence elapsed |
| --- | --- | --- | --- | --- |
| jev-on-1 | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a |
| jev-off-1 | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a |
| jev-on-2 | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 252284 ms |
| jev-off-2 | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 218002 ms |
| jev-on-3 | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 252203 ms |
| jev-off-3 | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 200025 ms |

- both-step sequence elapsed: n=4 of 6 passes: min 200025 ms | median 235102.5 ms | max 252284 ms

## Statistics

Min, median and max only, over 6 passes. 6 repeats do not support a p95, a mean or a confidence interval, and none is offered. A median of an even count is the mean of its two middle values.

No attribution here: the per-set reports keep the stage tables, and nothing about where the time went is derived across Passes.

## Usage

Summed across passes per role. A role incomplete in any pass is incomplete here.

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 36 | 0 | 0 | 11508499 | 325250 | 583 | 578 | no (jev-off-1, jev-off-2, jev-off-3) | GLM-5.3 |
| subagent | 3 | 0 | 33 | 724933 | 7594 | 50 | 50 | no (jev-on-1, jev-off-1, jev-on-3, jev-off-3) | GLM-5.3-flash |
| vision | 0 | 36 | 0 | 0 | 0 | 0 | 0 | no (jev-on-1, jev-off-1, jev-on-2, jev-off-2, jev-on-3, jev-off-3) | — |

- Tokens are summed per role across Passes, not per model: a role that used several models has no per-model split, and none is inferred.
- Vision usage is unavailable by construction — vision records carry request duration and never tokens.
- No cost estimate is produced here; a priced estimate belongs to a single report with an explicit dated price list.
- orchestrator: incomplete in jev-off-1, jev-off-2, jev-off-3, so its tokens are a floor.
- subagent: incomplete in jev-on-1, jev-off-1, jev-on-3, jev-off-3, so its tokens are a floor.
