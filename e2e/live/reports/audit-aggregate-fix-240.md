# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-14T14:25:38.168Z over fix-240-1, fix-240-2, fix-240-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 11 | 5 | 6 |
| 2 | answer omitted | 7 | 7 | 0 |
| 3 | budget too small for the Hunt | 0 | 0 | 0 |
| 4 | failed rounds | 0 | 0 | 0 |
| 5 | stopped early | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default
- reviewer: claude-opus-5 at high, prompt audit-p2

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-240-1 | 2026-09-14T12:47:44.666Z | complete | 3d764c9b | no | 1 | 680fe06b |
| fix-240-2 | 2026-09-14T13:25:27.861Z | complete | 3d764c9b | no | 1 | 680fe06b |
| fix-240-3 | 2026-09-14T14:09:41.103Z | complete | 3d764c9b | no | 1 | 680fe06b |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 273 | 252 | 247 | 4 | 165 (66%) → 154 | 41 (16%) → 52 | 0 (0%) | 24 (10%) | 22 (9%) | 21 (8%) |
| follow_up | 6 | 6 | 57 | 48 | 45 | 0 | 21 (44%) | 8 (17%) | 2 (4%) | 14 (29%) | 3 (6%) | 9 (16%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 5 | 3 | 6 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 1 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 7 | 1 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 80 Off-key round(s), 25 Search Loop round(s) by the reviewer (15 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 5 rejected Evidence Checkpoint(s), 3 walled round(s), 8 navigate(s) landed on a Not-found Page (4 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, Identity Slips not recorded, 0 Malformed Answer(s) (0 retried), 0 stopped early, 8 answer omitted, 25 overrule(s), 55 flag(s); Finalization Causes: budget_exhausted 4, deadline_reached 5, model_answered 1, objective_met 2
- follow_up: 8 Off-key round(s), 2 Search Loop round(s) by the reviewer (2 by the streak rule; attempts by search source rail 2, replay 0, none 4), 6 inherited, 3 rejected Evidence Checkpoint(s), 4 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, Identity Slips not recorded, 0 Malformed Answer(s) (0 retried), 0 stopped early, 0 answer omitted, 0 overrule(s), 21 flag(s); Finalization Causes: deadline_reached 3, model_answered 1, objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 103 (42%) | 19 (42%) |
| read_page | 51 (21%) | 9 (20%) |
| record_evidence | 21 (9%) | 11 (24%) |
| click | 27 (11%) | 0 |
| scroll | 25 (10%) | 0 |
| report_run_plan | 12 (5%) | 5 (11%) |
| record_candidate | 4 (2%) | 6 (13%) |
| type | 9 (4%) | 0 |
| look | 8 (3%) | 0 |
| spawn_agent | 0 | 3 (7%) |
| agent_results | 0 | 2 (4%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-240-1 | 4 | 4 | 88 | 82 | 81 | 1 | 55 (67%) → 52 | 14 (17%) → 17 | 0 (0%) | 9 (11%) | 4 (5%) | 6 (7%) |
| fix-240-2 | 4 | 4 | 104 | 96 | 95 | 3 | 64 (67%) → 59 | 16 (17%) → 21 | 0 (0%) | 7 (7%) | 9 (9%) | 8 (8%) |
| fix-240-3 | 4 | 4 | 81 | 74 | 71 | 0 | 46 (62%) → 43 | 11 (15%) → 14 | 0 (0%) | 8 (11%) | 9 (12%) | 7 (9%) |

| verdict | fix-240-1 primary | fix-240-1 secondary | fix-240-2 primary | fix-240-2 secondary | fix-240-3 primary | fix-240-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 1 | 2 | 1 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 2 | 1 | 3 | 0 |
| failed rounds | 0 | 0 | 0 | 1 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-240-1 | 2 | 2 | 21 | 18 | 17 | 0 | 10 (56%) | 5 (28%) | 0 (0%) | 2 (11%) | 1 (6%) | 3 (14%) |
| fix-240-2 | 2 | 2 | 15 | 12 | 11 | 0 | 4 (33%) | 2 (17%) | 1 (8%) | 4 (33%) | 1 (8%) | 3 (20%) |
| fix-240-3 | 2 | 2 | 21 | 18 | 17 | 0 | 7 (39%) | 1 (6%) | 1 (6%) | 8 (44%) | 1 (6%) | 3 (14%) |

| verdict | fix-240-1 primary | fix-240-1 secondary | fix-240-2 primary | fix-240-2 secondary | fix-240-3 primary | fix-240-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 1 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

