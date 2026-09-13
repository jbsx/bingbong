# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-13T22:07:58.138Z over fix-237-1, fix-237-2, fix-237-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 16 | 11 | 5 |
| 2 | stopped early | 1 | 0 | 1 |
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
| fix-237-1 | 2026-09-13T21:05:55.265Z | measurement_failed | d997ace2 | no | 1 | d997ace2 |
| fix-237-2 | 2026-09-13T21:30:26.350Z | complete | d997ace2 | no | 1 | d997ace2 |
| fix-237-3 | 2026-09-13T21:48:02.446Z | complete | d997ace2 | no | 1 | d997ace2 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 11 | 11 | 218 | 201 | 201 | 6 | 126 (63%) → 142 | 32 (16%) → 16 | 3 (2%) | 33 (16%) | 7 (4%) | 17 (8%) |
| follow_up | 6 | 6 | 58 | 52 | 52 | 0 | 13 (25%) → 16 | 11 (21%) → 8 | 1 (2%) | 27 (52%) → 26 | 0 (0%) → 1 | 6 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 11 | 0 | 5 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 72 Off-key round(s), 20 Search Loop round(s) by the reviewer (1 by the streak rule), 0 inherited, 4 rejected Evidence Checkpoint(s), 0 walled round(s), 39 Subagent round(s), 0 stopped early, 20 overrule(s), 54 flag(s); Finalization Causes: budget_exhausted 6, objective_met 5
- follow_up: 0 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule), 6 inherited, 10 rejected Evidence Checkpoint(s), 0 walled round(s), 13 Subagent round(s), 1 stopped early, 6 overrule(s), 23 flag(s); Finalization Causes: model_answered 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 77 (38%) | 10 (19%) |
| read_page | 52 (26%) | 13 (25%) |
| record_evidence | 31 (15%) | 21 (40%) |
| report_run_plan | 11 (5%) | 6 (12%) |
| record_candidate | 5 (2%) | 10 (19%) |
| scroll | 14 (7%) | 0 |
| click | 13 (6%) | 0 |
| type | 6 (3%) | 0 |
| spawn_agent | 4 (2%) | 1 (2%) |
| agent_results | 3 (1%) | 1 (2%) |
| look | 1 (0%) | 1 (2%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-237-1 | 3 | 3 | 49 | 44 | 44 | 2 | 26 (59%) → 30 | 7 (16%) → 3 | 1 (2%) | 8 (18%) | 2 (5%) | 5 (10%) |
| fix-237-2 | 4 | 4 | 89 | 82 | 82 | 3 | 50 (61%) → 54 | 11 (13%) → 7 | 1 (1%) | 16 (20%) | 4 (5%) | 7 (8%) |
| fix-237-3 | 4 | 4 | 80 | 75 | 75 | 1 | 50 (67%) → 58 | 14 (19%) → 6 | 1 (1%) | 9 (12%) | 1 (1%) | 5 (6%) |

| verdict | fix-237-1 primary | fix-237-1 secondary | fix-237-2 primary | fix-237-2 secondary | fix-237-3 primary | fix-237-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 4 | 0 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-237-1 | 2 | 2 | 25 | 23 | 23 | 0 | 8 (35%) | 4 (17%) | 1 (4%) | 10 (44%) | 0 (0%) | 2 (8%) |
| fix-237-2 | 2 | 2 | 17 | 15 | 15 | 0 | 3 (20%) → 4 | 3 (20%) → 2 | 0 (0%) | 9 (60%) → 8 | 0 (0%) → 1 | 2 (12%) |
| fix-237-3 | 2 | 2 | 16 | 14 | 14 | 0 | 2 (14%) → 4 | 4 (29%) → 2 | 0 (0%) | 8 (57%) | 0 (0%) | 2 (13%) |

| verdict | fix-237-1 primary | fix-237-1 secondary | fix-237-2 primary | fix-237-2 secondary | fix-237-3 primary | fix-237-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-237-1: superseded-voyager-interstellar--initial was not dispatched and has no rounds to audit

