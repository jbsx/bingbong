# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-14T15:42:04.590Z over fix-242-1, fix-242-2, fix-242-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 15 | 9 | 6 |
| 2 | answer omitted | 3 | 3 | 0 |
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
| fix-242-1 | 2026-09-14T14:36:31.124Z | complete | 680fe06b | no | 1 | 680fe06b |
| fix-242-2 | 2026-09-14T15:06:57.952Z | complete | 680fe06b | no | 1 | 680fe06b |
| fix-242-3 | 2026-09-14T15:33:51.734Z | complete | 680fe06b | no | 1 | 680fe06b |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 269 | 247 | 244 | 5 | 151 (61%) → 131 | 47 (19%) → 67 | 2 (1%) | 25 (10%) | 22 (9%) | 22 (8%) |
| follow_up | 6 | 6 | 66 | 60 | 60 | 0 | 15 (25%) → 19 | 11 (18%) → 7 | 2 (3%) | 32 (53%) | 0 (0%) | 6 (9%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 2 | 6 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 1 | 0 | 0 |
| answer omitted | 3 | 2 | 0 | 0 |
| failed rounds | 0 | 3 | 0 | 0 |

- initial: 97 Off-key round(s), 36 Search Loop round(s) by the reviewer (14 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 9 rejected Evidence Checkpoint(s), 2 walled round(s), 13 navigate(s) landed on a Not-found Page (9 judged Off-key), 43 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 1 Malformed Answer(s) (1 retried), 1 stopped early, 5 answer omitted, 42 overrule(s), 64 flag(s); Finalization Causes: budget_exhausted 6, deadline_reached 3, model_answered 1, objective_met 2
- follow_up: 3 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 1, replay 0, none 5), 7 inherited, 14 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 stopped early, 0 answer omitted, 4 overrule(s), 23 flag(s); Finalization Causes: model_answered 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 106 (43%) | 13 (22%) |
| read_page | 44 (18%) | 12 (20%) |
| record_evidence | 24 (10%) | 21 (35%) |
| scroll | 28 (11%) | 1 (2%) |
| record_candidate | 4 (2%) | 14 (23%) |
| report_run_plan | 12 (5%) | 6 (10%) |
| look | 17 (7%) | 0 |
| click | 15 (6%) | 0 |
| spawn_agent | 3 (1%) | 2 (3%) |
| agent_results | 2 (1%) | 2 (3%) |
| type | 4 (2%) | 0 |
| ground_visual | 2 (1%) | 0 |
| ask_user | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-242-1 | 4 | 4 | 88 | 81 | 81 | 3 | 47 (58%) → 41 | 20 (25%) → 26 | 1 (1%) | 4 (5%) | 9 (11%) | 7 (8%) |
| fix-242-2 | 4 | 4 | 96 | 88 | 87 | 1 | 57 (65%) → 44 | 13 (15%) → 26 | 0 (0%) | 10 (11%) | 8 (9%) | 8 (8%) |
| fix-242-3 | 4 | 4 | 85 | 78 | 76 | 1 | 47 (60%) → 46 | 14 (18%) → 15 | 1 (1%) | 11 (14%) | 5 (6%) | 7 (8%) |

| verdict | fix-242-1 primary | fix-242-1 secondary | fix-242-2 primary | fix-242-2 secondary | fix-242-3 primary | fix-242-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 3 | 1 | 2 | 1 |
| tier too small or never escalated | 0 | 1 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 1 | 0 | 0 |
| answer omitted | 0 | 1 | 1 | 1 | 2 | 0 |
| failed rounds | 0 | 1 | 0 | 1 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-242-1 | 2 | 2 | 18 | 16 | 16 | 0 | 5 (31%) | 3 (19%) | 0 (0%) | 8 (50%) | 0 (0%) | 2 (11%) |
| fix-242-2 | 2 | 2 | 21 | 19 | 19 | 0 | 4 (21%) → 6 | 5 (26%) → 3 | 1 (5%) | 9 (47%) | 0 (0%) | 2 (10%) |
| fix-242-3 | 2 | 2 | 27 | 25 | 25 | 0 | 6 (24%) → 8 | 3 (12%) → 1 | 1 (4%) | 15 (60%) | 0 (0%) | 2 (7%) |

| verdict | fix-242-1 primary | fix-242-1 secondary | fix-242-2 primary | fix-242-2 secondary | fix-242-3 primary | fix-242-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

