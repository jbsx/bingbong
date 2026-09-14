# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-14T17:23:58.004Z over fix-242r-1, fix-242r-2, fix-242r-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 13 | 9 | 4 |
| 2 | answer omitted | 4 | 3 | 1 |
| 3 | stopped early | 1 | 0 | 1 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default
- reviewer: claude-opus-5 at high, prompt audit-p2

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-242r-1 | 2026-09-14T16:29:18.859Z | complete | ebd583b5 | no | 1 | ebd583b5 |
| fix-242r-2 | 2026-09-14T16:51:57.935Z | complete | ebd583b5 | no | 1 | ebd583b5 |
| fix-242r-3 | 2026-09-14T17:16:11.268Z | complete | ebd583b5 | no | 1 | ebd583b5 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 253 | 235 | 234 | 5 | 139 (59%) → 136 | 33 (14%) → 36 | 2 (1%) | 37 (16%) | 24 (10%) | 18 (7%) |
| follow_up | 6 | 6 | 78 | 70 | 69 | 1 | 23 (33%) → 22 | 12 (17%) → 13 | 2 (3%) | 31 (44%) | 2 (3%) | 8 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 2 | 4 | 1 |
| tier too small or never escalated | 0 | 2 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| answer omitted | 3 | 1 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 66 Off-key round(s), 20 Search Loop round(s) by the reviewer (9 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 5 rejected Evidence Checkpoint(s), 1 walled round(s), 7 navigate(s) landed on a Not-found Page (7 judged Off-key), 53 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 stopped early, 4 answer omitted, 17 overrule(s), 57 flag(s); Finalization Causes: budget_exhausted 5, deadline_reached 1, model_answered 1, objective_met 5
- follow_up: 12 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 1, replay 0, none 5), 8 inherited, 14 rejected Evidence Checkpoint(s), 1 walled round(s), 2 navigate(s) landed on a Not-found Page (2 judged Off-key), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 1 stopped early, 1 answer omitted, 3 overrule(s), 22 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 1, objective_met 4

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 108 (46%) | 23 (33%) |
| record_evidence | 38 (16%) | 23 (33%) |
| read_page | 38 (16%) | 10 (14%) |
| record_candidate | 4 (2%) | 17 (25%) |
| report_run_plan | 12 (5%) | 6 (9%) |
| scroll | 17 (7%) | 1 (1%) |
| look | 14 (6%) | 0 |
| click | 9 (4%) | 1 (1%) |
| spawn_agent | 3 (1%) | 2 (3%) |
| type | 5 (2%) | 0 |
| agent_results | 2 (1%) | 2 (3%) |
| ask_user | 1 (0%) | 1 (1%) |
| back | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-242r-1 | 4 | 4 | 83 | 78 | 78 | 1 | 46 (59%) → 44 | 10 (13%) → 12 | 1 (1%) | 8 (10%) | 13 (17%) | 5 (6%) |
| fix-242r-2 | 4 | 4 | 89 | 82 | 81 | 2 | 46 (56%) → 47 | 13 (16%) → 12 | 1 (1%) | 14 (17%) | 8 (10%) | 7 (8%) |
| fix-242r-3 | 4 | 4 | 81 | 75 | 75 | 2 | 47 (63%) → 45 | 10 (13%) → 12 | 0 (0%) | 15 (20%) | 3 (4%) | 6 (7%) |

| verdict | fix-242r-1 primary | fix-242r-1 secondary | fix-242r-2 primary | fix-242r-2 secondary | fix-242r-3 primary | fix-242r-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 2 | 1 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 2 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 1 | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 1 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-242r-1 | 2 | 2 | 34 | 31 | 31 | 1 | 16 (52%) → 14 | 3 (10%) → 5 | 1 (3%) | 10 (32%) | 1 (3%) | 3 (9%) |
| fix-242r-2 | 2 | 2 | 14 | 12 | 12 | 0 | 2 (17%) → 3 | 4 (33%) → 3 | 0 (0%) | 6 (50%) | 0 (0%) | 2 (14%) |
| fix-242r-3 | 2 | 2 | 30 | 27 | 26 | 0 | 5 (19%) | 5 (19%) | 1 (4%) | 15 (56%) | 1 (4%) | 3 (10%) |

| verdict | fix-242r-1 primary | fix-242r-1 secondary | fix-242r-2 primary | fix-242r-2 secondary | fix-242r-3 primary | fix-242r-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 0 | 1 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-242r-2: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

