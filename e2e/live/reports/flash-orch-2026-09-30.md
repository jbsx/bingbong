# Live-web baseline summary — bingbong.live-web.information-hunts (3 passes)

Generated 2026-09-30T20:57:30.652Z over 3 passes, ordered by capture-set creation: flash-orch-1, flash-orch-2, flash-orch-3.

## Provenance

Shared by every input, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3-flash; subagent=GLM-5.3-flash; vision=GLM-4.6V
- reviewer(s): claude-opus-5 via live:grade
- study bingbong.live-web.information-hunts, protocol 1, mode measured, prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on

Per input, listed and never compared:

| pass | report | created | set state | commit(s) | dirty tree | grades revision |
| --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | e2e/live/reports/flash-orch-1.json | 2026-09-30T19:32:39.437Z | complete | f16dbd23 | no | 1 |
| flash-orch-2 | e2e/live/reports/flash-orch-2.json | 2026-09-30T20:09:51.125Z | complete | f16dbd23 | no | 1 |
| flash-orch-3 | e2e/live/reports/flash-orch-3.json | 2026-09-30T20:43:40.455Z | complete | f16dbd23 | no | 1 |

## Populations

Verified over scheduled, summed across passes, with each pass beside the sum. Verified success is the independent review, never the Run’s own claim.

| population | verified / scheduled | per pass | attempted | answered | not reached | unaccounted | acceptance unconfirmed | reviewed | pending | timed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 6/12 (50%) | flash-orch-1 1/4 · flash-orch-2 2/4 · flash-orch-3 3/4 | 12 | 12 | 0 | 0 | 0 | 12 | 0 | 6 |
| revised_objective | 3/6 (50%) | flash-orch-1 1/2 · flash-orch-2 1/2 · flash-orch-3 1/2 | 6 | 6 | 0 | 0 | 0 | 6 | 0 | 3 |
| both_step | 2/6 (33%) | flash-orch-1 0/2 · flash-orch-2 1/2 · flash-orch-3 1/2 | 6 | 6 | 0 | 0 | 0 | 6 | 0 | 2 |

## Tasks

One section per task (hunt × step), one row per pass. A Task Completion Time belongs to a verified Answer only; an unverified Answer keeps its latency as a measurement.

### compatibility-pi-camera / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | compatibility-pi-camera--initial | answered | useful_partial | deadline_reached | 509064 ms | n/a | 509083 ms | usage_incomplete |
| flash-orch-2 | compatibility-pi-camera--initial | answered | pass | deadline_reached | 492497 ms | 492497 ms | 492501 ms | usage_incomplete |
| flash-orch-3 | compatibility-pi-camera--initial | answered | unsuccessful | deadline_reached | 406555 ms | n/a | 406558 ms | deterministic_answer usage_incomplete |

- attempts 3, answered 3, verified 1 over 3 passes
- Task Completion Time (verified): n=1 of 3 passes: min 492497 ms | median 492497 ms | max 492497 ms
- Answer latency (unverified): n=2 of 3 passes: min 406555 ms | median 457809.5 ms | max 509064 ms
- full Run duration: n=3 of 3 passes: min 406558 ms | median 492501 ms | max 509083 ms
- finalization causes: deadline_reached 3
- flags: deterministic_answer 1, usage_incomplete 3

### compatibility-pi-camera / follow_up (revised_objective, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | compatibility-pi-camera--follow_up | answered | useful_partial | deadline_reached | 364762 ms | n/a | 364768 ms | truncated_tool_results usage_incomplete |
| flash-orch-2 | compatibility-pi-camera--follow_up | answered | pass | deadline_reached | 345244 ms | 345244 ms | 345246 ms | usage_incomplete |
| flash-orch-3 | compatibility-pi-camera--follow_up | answered | useful_partial | deadline_reached | 483206 ms | n/a | 483211 ms | usage_incomplete |

- attempts 3, answered 3, verified 1 over 3 passes
- Task Completion Time (verified): n=1 of 3 passes: min 345244 ms | median 345244 ms | max 345244 ms
- Answer latency (unverified): n=2 of 3 passes: min 364762 ms | median 423984 ms | max 483206 ms
- full Run duration: n=3 of 3 passes: min 345246 ms | median 364768 ms | max 483211 ms
- finalization causes: deadline_reached 3
- flags: truncated_tool_results 1, usage_incomplete 3

### historical-longitude-watch / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | historical-longitude-watch--initial | answered | pass | objective_met | 243719 ms | 243719 ms | 243722 ms | — |
| flash-orch-2 | historical-longitude-watch--initial | answered | pass | deadline_reached | 388244 ms | 388244 ms | 388246 ms | usage_incomplete |
| flash-orch-3 | historical-longitude-watch--initial | answered | pass | deadline_reached | 336076 ms | 336076 ms | 336080 ms | usage_incomplete |

- attempts 3, answered 3, verified 3 over 3 passes
- Task Completion Time (verified): n=3 of 3 passes: min 243719 ms | median 336076 ms | max 388244 ms
- Answer latency (unverified): no observations (n=0 of 3 passes)
- full Run duration: n=3 of 3 passes: min 243722 ms | median 336080 ms | max 388246 ms
- finalization causes: deadline_reached 2, objective_met 1
- flags: usage_incomplete 2

### rule-eurostar-luggage / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | rule-eurostar-luggage--initial | answered | useful_partial | deadline_reached | 466141 ms | n/a | 466144 ms | usage_incomplete |
| flash-orch-2 | rule-eurostar-luggage--initial | answered | useful_partial | deadline_reached | 360518 ms | n/a | 360525 ms | usage_incomplete |
| flash-orch-3 | rule-eurostar-luggage--initial | answered | pass | budget_exhausted | 333302 ms | 333302 ms | 333306 ms | — |

- attempts 3, answered 3, verified 1 over 3 passes
- Task Completion Time (verified): n=1 of 3 passes: min 333302 ms | median 333302 ms | max 333302 ms
- Answer latency (unverified): n=2 of 3 passes: min 360518 ms | median 413329.5 ms | max 466141 ms
- full Run duration: n=3 of 3 passes: min 333306 ms | median 360525 ms | max 466144 ms
- finalization causes: budget_exhausted 1, deadline_reached 2
- flags: usage_incomplete 2

### rule-eurostar-luggage / follow_up (revised_objective, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 246418 ms | 246418 ms | 246420 ms | — |
| flash-orch-2 | rule-eurostar-luggage--follow_up | answered | useful_partial | objective_met | 259942 ms | n/a | 259943 ms | self_declared_completed_but_unverified |
| flash-orch-3 | rule-eurostar-luggage--follow_up | answered | pass | objective_met | 102330 ms | 102330 ms | 102331 ms | — |

- attempts 3, answered 3, verified 2 over 3 passes
- Task Completion Time (verified): n=2 of 3 passes: min 102330 ms | median 174374 ms | max 246418 ms
- Answer latency (unverified): n=1 of 3 passes: min 259942 ms | median 259942 ms | max 259942 ms
- full Run duration: n=3 of 3 passes: min 102331 ms | median 246420 ms | max 259943 ms
- finalization causes: objective_met 3
- flags: self_declared_completed_but_unverified 1

### superseded-voyager-interstellar / initial (initial, prompt 1)

| pass | slot | disposition | grade | cause | answer latency | task completion | run duration | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | superseded-voyager-interstellar--initial | answered | unsuccessful | deadline_reached | 389509 ms | n/a | 389511 ms | deterministic_answer usage_incomplete |
| flash-orch-2 | superseded-voyager-interstellar--initial | answered | useful_partial | deadline_reached | 365563 ms | n/a | 365571 ms | usage_incomplete |
| flash-orch-3 | superseded-voyager-interstellar--initial | answered | pass | deadline_reached | 346997 ms | 346997 ms | 347000 ms | usage_incomplete |

- attempts 3, answered 3, verified 1 over 3 passes
- Task Completion Time (verified): n=1 of 3 passes: min 346997 ms | median 346997 ms | max 346997 ms
- Answer latency (unverified): n=2 of 3 passes: min 365563 ms | median 377536 ms | max 389509 ms
- full Run duration: n=3 of 3 passes: min 347000 ms | median 365571 ms | max 389511 ms
- finalization causes: deadline_reached 3
- flags: deterministic_answer 1, usage_incomplete 3

## Both-step sequences

Per hunt with a follow-up: initial acceptance to the follow-up’s Answer, over the pairs both steps of which verified.

### compatibility-pi-camera

| pass | initial | follow-up | both verified | sequence elapsed |
| --- | --- | --- | --- | --- |
| flash-orch-1 | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a |
| flash-orch-2 | compatibility-pi-camera--initial pass | compatibility-pi-camera--follow_up pass | yes | 838209 ms |
| flash-orch-3 | compatibility-pi-camera--initial not verified | compatibility-pi-camera--follow_up not verified | no | n/a |

- both-step sequence elapsed: n=1 of 3 passes: min 838209 ms | median 838209 ms | max 838209 ms

### rule-eurostar-luggage

| pass | initial | follow-up | both verified | sequence elapsed |
| --- | --- | --- | --- | --- |
| flash-orch-1 | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up pass | no | n/a |
| flash-orch-2 | rule-eurostar-luggage--initial not verified | rule-eurostar-luggage--follow_up not verified | no | n/a |
| flash-orch-3 | rule-eurostar-luggage--initial pass | rule-eurostar-luggage--follow_up pass | yes | 435984 ms |

- both-step sequence elapsed: n=1 of 3 passes: min 435984 ms | median 435984 ms | max 435984 ms

## Statistics

Min, median and max only, over 3 passes. 3 repeats do not support a p95, a mean or a confidence interval, and none is offered. A median of an even count is the mean of its two middle values.

No attribution here: the per-set reports keep the stage tables, and nothing about where the time went is derived across Passes.

## Usage

Summed across passes per role. A role incomplete in any pass is incomplete here.

| role | attempts observed | unavailable | n/a | prompt | completion | rounds | with usage | complete | models |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| orchestrator | 18 | 0 | 0 | 5934634 | 174394 | 312 | 292 | no (flash-orch-1, flash-orch-2, flash-orch-3) | GLM-5.3-flash |
| subagent | 1 | 0 | 17 | 28638 | 960 | 5 | 5 | no (flash-orch-1, flash-orch-2) | GLM-5.3-flash |
| vision | 0 | 18 | 0 | 0 | 0 | 0 | 0 | no (flash-orch-1, flash-orch-2, flash-orch-3) | — |

- Tokens are summed per role across Passes, not per model: a role that used several models has no per-model split, and none is inferred.
- Vision usage is unavailable by construction — vision records carry request duration and never tokens.
- No cost estimate is produced here; a priced estimate belongs to a single report with an explicit dated price list.
- orchestrator: incomplete in flash-orch-1, flash-orch-2, flash-orch-3, so its tokens are a floor.
- subagent: incomplete in flash-orch-1, flash-orch-2, so its tokens are a floor.
