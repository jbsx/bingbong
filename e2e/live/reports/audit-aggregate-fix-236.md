# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-13T04:57:39.661Z over fix-236-1, fix-236-2, fix-236-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 16 | 11 | 5 |
| 2 | stopped early | 1 | 0 | 1 |
| 3 | tier too small or never escalated | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default
- reviewer: claude-opus-5 at high, prompt audit-p1

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-236-1 | 2026-09-13T03:50:05.762Z | complete | 053e00b5 | no | 1 | 28b234df (dirty) |
| fix-236-2 | 2026-09-13T04:15:18.565Z | complete | 053e00b5 | no | 1 | 28b234df (dirty) |
| fix-236-3 | 2026-09-13T04:40:17.490Z | complete | 053e00b5 | no | 1 | 28b234df (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 274 | 251 | 251 | 11 | 195 (78%) → 165 | 27 (11%) → 57 | 0 (0%) | 18 (7%) | 11 (4%) | 23 (8%) |
| follow_up | 6 | 6 | 110 | 102 | 102 | 2 | 63 (62%) → 47 | 19 (19%) → 35 | 2 (2%) | 17 (17%) | 1 (1%) | 8 (7%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 11 | 1 | 5 | 0 |
| tier too small or never escalated | 1 | 4 | 0 | 2 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 2 | 0 | 0 |

- initial: 64 Off-key round(s), 27 Search Loop round(s) by the reviewer (2 by the streak rule), 0 inherited, 5 rejected Evidence Checkpoint(s), 2 walled round(s), 0 Subagent round(s), 0 stopped early, 36 overrule(s), 62 flag(s); Finalization Causes: budget_exhausted 11, objective_met 1
- follow_up: 6 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule), 12 inherited, 10 rejected Evidence Checkpoint(s), 1 walled round(s), 26 Subagent round(s), 1 stopped early, 16 overrule(s), 30 flag(s); Finalization Causes: budget_exhausted 2, model_answered 1, objective_met 3

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| scroll | 95 (38%) | 32 (31%) |
| navigate | 87 (35%) | 24 (24%) |
| look | 23 (9%) | 22 (22%) |
| record_evidence | 19 (8%) | 16 (16%) |
| report_run_plan | 12 (5%) | 6 (6%) |
| click | 10 (4%) | 2 (2%) |
| read_page | 8 (3%) | 3 (3%) |
| type | 9 (4%) | 0 |
| record_candidate | 0 | 8 (8%) |
| agent_results | 0 | 2 (2%) |
| ground_visual | 2 (1%) | 0 |
| spawn_agent | 0 | 2 (2%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-236-1 | 4 | 4 | 80 | 72 | 72 | 4 | 58 (81%) → 50 | 8 (11%) → 16 | 0 (0%) | 3 (4%) | 3 (4%) | 8 (10%) |
| fix-236-2 | 4 | 4 | 102 | 95 | 95 | 3 | 74 (78%) → 64 | 9 (10%) → 19 | 0 (0%) | 9 (10%) | 3 (3%) | 7 (7%) |
| fix-236-3 | 4 | 4 | 92 | 84 | 84 | 4 | 63 (75%) → 51 | 10 (12%) → 22 | 0 (0%) | 6 (7%) | 5 (6%) | 8 (9%) |

| verdict | fix-236-1 primary | fix-236-1 secondary | fix-236-2 primary | fix-236-2 secondary | fix-236-3 primary | fix-236-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 3 | 1 | 4 | 0 |
| tier too small or never escalated | 0 | 2 | 1 | 1 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-236-1 | 2 | 2 | 35 | 33 | 33 | 0 | 18 (55%) → 16 | 7 (21%) → 9 | 1 (3%) | 7 (21%) | 0 (0%) | 2 (6%) |
| fix-236-2 | 2 | 2 | 38 | 35 | 35 | 1 | 17 (49%) → 10 | 10 (29%) → 17 | 1 (3%) | 6 (17%) | 1 (3%) | 3 (8%) |
| fix-236-3 | 2 | 2 | 37 | 34 | 34 | 1 | 28 (82%) → 21 | 2 (6%) → 9 | 0 (0%) | 4 (12%) | 0 (0%) | 3 (8%) |

| verdict | fix-236-1 primary | fix-236-1 secondary | fix-236-2 primary | fix-236-2 secondary | fix-236-3 primary | fix-236-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 1 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

