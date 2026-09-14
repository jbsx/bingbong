# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-14T13:24:38.303Z over baseline-1, baseline-2, baseline-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 10 | 6 | 4 |
| 2 | answer omitted | 7 | 5 | 2 |
| 3 | failed rounds | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
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
| baseline-1 | 2026-09-12T17:06:30.219Z | complete | fbd2b865 | yes | 1 | 2299991a |
| baseline-2 | 2026-09-12T18:10:26.845Z | complete | 6152d8dc | yes | 1 | 2299991a |
| baseline-3 | 2026-09-12T18:57:29.347Z | complete | 59bdf48b | yes | 1 | 2299991a |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 246 | 225 | 224 | 8 | 145 (64%) → 131 | 37 (16%) → 51 | 2 (1%) | 18 (8%) | 23 (10%) | 21 (9%) |
| follow_up | 6 | 6 | 127 | 117 | 116 | 3 | 70 (60%) → 63 | 20 (17%) → 27 | 1 (1%) | 19 (16%) | 7 (6%) | 10 (8%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 6 | 2 | 4 | 2 |
| tier too small or never escalated | 0 | 2 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 5 | 3 | 2 | 1 |
| failed rounds | 1 | 0 | 0 | 0 |

- initial: 55 Off-key round(s), 11 Search Loop round(s) by the reviewer (8 by the streak rule; attempts by search source rail 0, replay 8, none 4), 0 inherited, 9 rejected Evidence Checkpoint(s), 2 walled round(s), 9 navigate(s) landed on a Not-found Page (8 judged Off-key), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, Identity Slips not recorded, 0 stopped early, 8 answer omitted, 16 overrule(s), 57 flag(s); Finalization Causes: budget_exhausted 8, deadline_reached 1, model_answered 1, objective_met 2
- follow_up: 15 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 0, replay 3, none 3), 9 inherited, 9 rejected Evidence Checkpoint(s), 0 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 6 Held Page round(s) without Progress, Identity Slips not recorded, 0 stopped early, 3 answer omitted, 7 overrule(s), 29 flag(s); Finalization Causes: budget_exhausted 3, deadline_reached 1, objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 80 (36%) | 31 (27%) |
| scroll | 64 (29%) | 40 (34%) |
| record_evidence | 21 (9%) | 14 (12%) |
| look | 18 (8%) | 13 (11%) |
| read_page | 13 (6%) | 6 (5%) |
| report_run_plan | 11 (5%) | 6 (5%) |
| click | 13 (6%) | 3 (3%) |
| type | 14 (6%) | 1 (1%) |
| record_candidate | 0 | 10 (9%) |
| agent_results | 2 (1%) | 1 (1%) |
| ground_visual | 1 (0%) | 2 (2%) |
| spawn_agent | 2 (1%) | 1 (1%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline-1 | 4 | 4 | 73 | 66 | 66 | 3 | 41 (62%) → 37 | 16 (24%) → 20 | 1 (2%) | 4 (6%) | 4 (6%) | 7 (10%) |
| baseline-2 | 4 | 4 | 102 | 95 | 95 | 3 | 66 (70%) → 63 | 11 (12%) → 14 | 0 (0%) | 6 (6%) | 12 (13%) | 7 (7%) |
| baseline-3 | 4 | 4 | 71 | 64 | 63 | 2 | 38 (59%) → 31 | 10 (16%) → 17 | 1 (2%) | 8 (13%) | 7 (11%) | 7 (10%) |

| verdict | baseline-1 primary | baseline-1 secondary | baseline-2 primary | baseline-2 secondary | baseline-3 primary | baseline-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 2 | 1 | 1 | 1 |
| tier too small or never escalated | 0 | 1 | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 1 | 2 | 1 | 2 | 1 |
| failed rounds | 0 | 0 | 0 | 0 | 1 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline-1 | 2 | 2 | 42 | 39 | 38 | 0 | 19 (49%) → 16 | 11 (28%) → 14 | 0 (0%) | 7 (18%) | 2 (5%) | 3 (7%) |
| baseline-2 | 2 | 2 | 45 | 42 | 42 | 1 | 28 (67%) → 27 | 5 (12%) → 6 | 0 (0%) | 7 (17%) | 2 (5%) | 3 (7%) |
| baseline-3 | 2 | 2 | 40 | 36 | 36 | 2 | 23 (64%) → 20 | 4 (11%) → 7 | 1 (3%) | 5 (14%) | 3 (8%) | 4 (10%) |

| verdict | baseline-1 primary | baseline-1 secondary | baseline-2 primary | baseline-2 secondary | baseline-3 primary | baseline-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 1 | 2 | 0 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 1 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

