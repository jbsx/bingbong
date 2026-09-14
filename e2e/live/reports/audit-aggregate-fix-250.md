# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-14T23:30:52.562Z over fix-250-1, fix-250-2, fix-250-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 11 | 8 | 3 |
| 2 | answer omitted | 5 | 3 | 2 |
| 3 | stopped early | 2 | 1 | 1 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p2

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-250-1 | 2026-09-14T22:31:57.642Z | complete | 17317ee0 | no | 1 | 3d03e9fe |
| fix-250-2 | 2026-09-14T22:53:26.672Z | complete | 17317ee0 | yes | 1 | 3d03e9fe |
| fix-250-3 | 2026-09-14T23:26:43.390Z | complete | 17317ee0 | yes | 1 | 3d03e9fe |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 246 | 224 | 219 | 5 | 135 (60%) → 114 | 40 (18%) → 61 | 4 (2%) | 26 (12%) | 19 (9%) | 22 (9%) |
| follow_up | 6 | 6 | 88 | 81 | 77 | 0 | 35 (43%) → 32 | 10 (12%) → 13 | 1 (1%) | 30 (37%) | 5 (6%) | 7 (8%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 8 | 3 | 3 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 1 | 0 |
| answer omitted | 3 | 2 | 2 | 1 |
| failed rounds | 0 | 0 | 0 | 0 |

- initial: 72 Off-key round(s), 25 Search Loop round(s) by the reviewer (8 by the streak rule; attempts by search source rail 11, replay 0, none 1), 0 inherited, 6 rejected Evidence Checkpoint(s), 0 walled round(s), 5 navigate(s) landed on a Not-found Page (4 judged Off-key), 63 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 9 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 1 Malformed Answer(s) (3 retried), 12 declared Asked Items (6 with an unverified standing, 3 shape failure(s), 2 retried), 1 stopped early, 5 answer omitted, 29 overrule(s), 59 flag(s); Finalization Causes: budget_exhausted 5, deadline_reached 3, no_progress 1, objective_met 3
- follow_up: 19 Off-key round(s), 3 Search Loop round(s) by the reviewer (2 by the streak rule; attempts by search source rail 4, replay 0, none 2), 8 inherited, 11 rejected Evidence Checkpoint(s), 1 walled round(s), 2 navigate(s) landed on a Not-found Page (1 judged Off-key), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 1 Malformed Answer(s) (3 retried), 6 declared Asked Items (0 with an unverified standing, 2 shape failure(s), 2 retried), 1 stopped early, 3 answer omitted, 3 overrule(s), 24 flag(s); Finalization Causes: deadline_reached 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 78 (36%) | 29 (38%) |
| read_page | 53 (24%) | 11 (14%) |
| record_evidence | 25 (11%) | 20 (26%) |
| record_candidate | 7 (3%) | 15 (19%) |
| report_run_plan | 12 (5%) | 7 (9%) |
| scroll | 18 (8%) | 1 (1%) |
| click | 12 (5%) | 4 (5%) |
| look | 16 (7%) | 0 |
| type | 7 (3%) | 0 |
| agent_results | 4 (2%) | 2 (3%) |
| spawn_agent | 4 (2%) | 2 (3%) |
| ask_user | 0 | 1 (1%) |
| ground_visual | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-250-1 | 4 | 4 | 90 | 83 | 82 | 2 | 53 (64%) → 44 | 16 (19%) → 25 | 2 (2%) | 4 (5%) | 8 (10%) | 7 (8%) |
| fix-250-2 | 4 | 4 | 74 | 65 | 64 | 2 | 36 (55%) → 27 | 14 (22%) → 23 | 1 (2%) | 9 (14%) | 5 (8%) | 9 (12%) |
| fix-250-3 | 4 | 4 | 82 | 76 | 73 | 1 | 46 (61%) → 43 | 10 (13%) → 13 | 1 (1%) | 13 (17%) | 6 (8%) | 6 (7%) |

| verdict | fix-250-1 primary | fix-250-1 secondary | fix-250-2 primary | fix-250-2 secondary | fix-250-3 primary | fix-250-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 1 | 2 | 3 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 | 0 | 0 |
| answer omitted | 0 | 1 | 2 | 1 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-250-1 | 2 | 2 | 32 | 30 | 28 | 0 | 14 (47%) → 12 | 3 (10%) → 5 | 0 (0%) | 11 (37%) | 2 (7%) | 2 (6%) |
| fix-250-2 | 2 | 2 | 28 | 26 | 25 | 0 | 9 (35%) | 5 (19%) | 0 (0%) | 11 (42%) | 1 (4%) | 2 (7%) |
| fix-250-3 | 2 | 2 | 28 | 25 | 24 | 0 | 12 (48%) → 11 | 2 (8%) → 3 | 1 (4%) | 8 (32%) | 2 (8%) | 3 (11%) |

| verdict | fix-250-1 primary | fix-250-1 secondary | fix-250-2 primary | fix-250-2 secondary | fix-250-3 primary | fix-250-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 0 | 0 | 1 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 0 | 1 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-250-3: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

