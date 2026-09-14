# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-14T20:26:53.272Z over baseline2-1, baseline2-2, baseline2-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 12 | 7 | 5 |
| 2 | answer omitted | 6 | 5 | 1 |
| 3 | budget too small for the Hunt | 0 | 0 | 0 |
| 4 | failed rounds | 0 | 0 | 0 |
| 5 | stopped early | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p2

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| baseline2-1 | 2026-09-14T19:11:32.158Z | complete | d683e814 | no | 1 | 60e93b03 |
| baseline2-2 | 2026-09-14T19:37:17.550Z | complete | d683e814 | no | 1 | 60e93b03 |
| baseline2-3 | 2026-09-14T20:04:20.037Z | complete | d683e814 | no | 1 | 60e93b03 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 281 | 265 | 264 | 4 | 154 (58%) → 137 | 29 (11%) → 46 | 6 (2%) | 59 (22%) | 17 (6%) | 16 (6%) |
| follow_up | 6 | 6 | 76 | 68 | 68 | 2 | 24 (35%) → 26 | 12 (18%) → 10 | 1 (2%) | 31 (46%) | 0 (0%) | 8 (11%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 7 | 1 | 5 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 1 | 0 | 0 |
| answer omitted | 5 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 55 Off-key round(s), 18 Search Loop round(s) by the reviewer (11 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 19 rejected Evidence Checkpoint(s), 2 walled round(s), 7 navigate(s) landed on a Not-found Page (6 judged Off-key), 96 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 5 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 1 Malformed Answer(s) (1 retried), 1 stopped early, 5 answer omitted, 23 overrule(s), 54 flag(s); Finalization Causes: budget_exhausted 4, objective_met 8
- follow_up: 8 Off-key round(s), 5 Search Loop round(s) by the reviewer (2 by the streak rule; attempts by search source rail 1, replay 0, none 5), 8 inherited, 11 rejected Evidence Checkpoint(s), 1 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 stopped early, 1 answer omitted, 6 overrule(s), 21 flag(s); Finalization Causes: budget_exhausted 2, objective_met 4

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 95 (36%) | 17 (25%) |
| record_evidence | 53 (20%) | 20 (29%) |
| read_page | 39 (15%) | 12 (18%) |
| scroll | 32 (12%) | 7 (10%) |
| record_candidate | 12 (5%) | 12 (18%) |
| report_run_plan | 12 (5%) | 6 (9%) |
| look | 17 (6%) | 0 |
| agent_results | 6 (2%) | 1 (1%) |
| click | 7 (3%) | 0 |
| spawn_agent | 4 (2%) | 1 (1%) |
| type | 5 (2%) | 0 |
| ground_visual | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline2-1 | 4 | 4 | 98 | 92 | 91 | 2 | 56 (61%) → 45 | 10 (11%) → 21 | 3 (3%) | 16 (17%) | 7 (8%) | 6 (6%) |
| baseline2-2 | 4 | 4 | 89 | 84 | 84 | 1 | 51 (61%) → 49 | 11 (13%) → 13 | 1 (1%) | 15 (18%) | 6 (7%) | 5 (6%) |
| baseline2-3 | 4 | 4 | 94 | 89 | 89 | 1 | 47 (53%) → 43 | 8 (9%) → 12 | 2 (2%) | 28 (32%) | 4 (5%) | 5 (5%) |

| verdict | baseline2-1 primary | baseline2-1 secondary | baseline2-2 primary | baseline2-2 secondary | baseline2-3 primary | baseline2-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 1 | 3 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 1 | 0 | 0 |
| answer omitted | 2 | 0 | 2 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline2-1 | 2 | 2 | 11 | 9 | 9 | 0 | 2 (22%) → 4 | 4 (44%) → 2 | 0 (0%) | 3 (33%) | 0 (0%) | 2 (18%) |
| baseline2-2 | 2 | 2 | 33 | 30 | 30 | 1 | 10 (33%) → 12 | 5 (17%) → 3 | 0 (0%) | 15 (50%) | 0 (0%) | 3 (9%) |
| baseline2-3 | 2 | 2 | 32 | 29 | 29 | 1 | 12 (41%) → 10 | 3 (10%) → 5 | 1 (3%) | 13 (45%) | 0 (0%) | 3 (9%) |

| verdict | baseline2-1 primary | baseline2-1 secondary | baseline2-2 primary | baseline2-2 secondary | baseline2-3 primary | baseline2-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

