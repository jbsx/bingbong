# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-14T02:57:44.729Z over fix-239-1, fix-239-2, fix-239-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 16 | 11 | 5 |
| 2 | stopped early | 2 | 1 | 1 |
| 3 | budget too small for the Hunt | 0 | 0 | 0 |
| 4 | failed rounds | 0 | 0 | 0 |
| 5 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default
- reviewer: claude-opus-5 at high, prompt audit-p1

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-239-1 | 2026-09-14T01:33:38.905Z | complete | 8c48a4bb | no | 1 | 8c48a4bb |
| fix-239-2 | 2026-09-14T02:08:52.682Z | complete | 8c48a4bb | no | 1 | 8c48a4bb |
| fix-239-3 | 2026-09-14T02:32:45.452Z | complete | 8c48a4bb | no | 1 | 8c48a4bb |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 271 | 249 | 247 | 8 | 160 (64%) → 148 | 43 (17%) → 55 | 2 (1%) | 20 (8%) | 24 (10%) | 22 (8%) |
| follow_up | 6 | 6 | 95 | 87 | 87 | 2 | 37 (43%) | 20 (23%) | 1 (1%) | 25 (29%) | 4 (5%) | 8 (8%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 11 | 0 | 5 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 4 | 0 | 0 |

- initial: 91 Off-key round(s), 33 Search Loop round(s) by the reviewer (17 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 8 rejected Evidence Checkpoint(s), 1 walled round(s), 6 navigate(s) landed on a Not-found Page (4 judged Off-key), 52 Subagent round(s), 1 stopped early, 30 overrule(s), 61 flag(s); Finalization Causes: budget_exhausted 8, deadline_reached 2, objective_met 2
- follow_up: 20 Off-key round(s), 8 Search Loop round(s) by the reviewer (4 by the streak rule; attempts by search source rail 2, replay 0, none 4), 11 inherited, 14 rejected Evidence Checkpoint(s), 2 walled round(s), 5 navigate(s) landed on a Not-found Page (3 judged Off-key), 13 Subagent round(s), 1 stopped early, 2 overrule(s), 28 flag(s); Finalization Causes: budget_exhausted 1, model_answered 1, no_progress 1, objective_met 3

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 111 (45%) | 38 (44%) |
| read_page | 58 (23%) | 12 (14%) |
| scroll | 35 (14%) | 10 (11%) |
| record_evidence | 24 (10%) | 19 (22%) |
| report_run_plan | 12 (5%) | 6 (7%) |
| click | 12 (5%) | 1 (1%) |
| record_candidate | 3 (1%) | 10 (11%) |
| type | 8 (3%) | 0 |
| spawn_agent | 2 (1%) | 2 (2%) |
| agent_results | 2 (1%) | 1 (1%) |
| look | 2 (1%) | 0 |
| ground_visual | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-239-1 | 4 | 4 | 83 | 76 | 75 | 2 | 51 (67%) → 43 | 12 (16%) → 20 | 1 (1%) | 8 (11%) | 4 (5%) | 7 (8%) |
| fix-239-2 | 4 | 4 | 103 | 95 | 94 | 3 | 59 (62%) → 56 | 17 (18%) → 20 | 1 (1%) | 8 (8%) | 10 (11%) | 8 (8%) |
| fix-239-3 | 4 | 4 | 85 | 78 | 78 | 3 | 50 (64%) → 49 | 14 (18%) → 15 | 0 (0%) | 4 (5%) | 10 (13%) | 7 (8%) |

| verdict | fix-239-1 primary | fix-239-1 secondary | fix-239-2 primary | fix-239-2 secondary | fix-239-3 primary | fix-239-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 4 | 0 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 2 | 0 | 2 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-239-1 | 2 | 2 | 37 | 34 | 34 | 1 | 12 (35%) → 11 | 8 (24%) → 9 | 1 (3%) | 11 (32%) | 2 (6%) | 3 (8%) |
| fix-239-2 | 2 | 2 | 41 | 38 | 38 | 1 | 19 (50%) → 20 | 8 (21%) → 7 | 0 (0%) | 9 (24%) | 2 (5%) | 3 (7%) |
| fix-239-3 | 2 | 2 | 17 | 15 | 15 | 0 | 6 (40%) | 4 (27%) | 0 (0%) | 5 (33%) | 0 (0%) | 2 (12%) |

| verdict | fix-239-1 primary | fix-239-1 secondary | fix-239-2 primary | fix-239-2 secondary | fix-239-3 primary | fix-239-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 1 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

