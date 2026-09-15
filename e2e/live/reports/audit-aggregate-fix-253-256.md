# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-15T18:06:19.857Z over fix-253-256-1, fix-253-256-2, fix-253-256-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 12 | 8 | 4 |
| 2 | answer omitted | 6 | 4 | 2 |
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
| fix-253-256-1 | 2026-09-15T16:59:46.740Z | complete | 4d5f8755 | no | 1 | 6cccafbe (dirty) |
| fix-253-256-2 | 2026-09-15T17:21:51.539Z | complete | 4d5f8755 | no | 1 | 6cccafbe (dirty) |
| fix-253-256-3 | 2026-09-15T17:43:26.205Z | complete | 4d5f8755 | no | 1 | 6cccafbe (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 294 | 275 | 272 | 6 | 174 (63%) → 179 | 61 (22%) → 56 | 0 (0%) | 26 (10%) → 25 | 14 (5%) → 15 | 19 (7%) |
| follow_up | 6 | 6 | 86 | 79 | 77 | 1 | 39 (49%) → 43 | 13 (17%) → 9 | 0 (0%) | 22 (28%) | 5 (6%) | 7 (8%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 8 | 3 | 4 | 2 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 4 | 0 | 2 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 111 Off-key round(s), 41 Search Loop round(s) by the reviewer (23 by the streak rule; attempts by search source rail 11, replay 0, none 1), 0 inherited, 9 rejected Evidence Checkpoint(s), 3 walled round(s), 8 navigate(s) landed on a Not-found Page (7 judged Off-key), 16 Composed Address(es) rewritten into a site search (16 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 10 Held Page round(s) without Progress, 5 bundled checkpoint round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 2 skipped bookkeeping round(s), 4 Finalization round(s) cut by the Allowance, 12 declared Asked Items (6 with an unverified standing, 2 shape failure(s), 0 retried), 0 stopped early, 4 answer omitted, 30 overrule(s), 64 flag(s); Finalization Causes: budget_exhausted 5, deadline_reached 3, hard_limit 1, objective_met 3
- follow_up: 18 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 3, replay 0, none 3), 9 inherited, 5 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 6 bundled checkpoint round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 1 Malformed Answer(s) (1 retried), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance, 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 2 answer omitted, 4 overrule(s), 22 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 1, objective_met 4

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 116 (43%) | 29 (38%) |
| read_page | 63 (23%) | 17 (22%) |
| record_evidence | 27 (10%) | 20 (26%) |
| click | 31 (11%) | 2 (3%) |
| scroll | 21 (8%) | 5 (6%) |
| report_run_plan | 12 (4%) | 7 (9%) |
| record_candidate | 6 (2%) | 11 (14%) |
| look | 8 (3%) | 2 (3%) |
| type | 8 (3%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-253-256-1 | 4 | 4 | 96 | 91 | 88 | 0 | 60 (66%) → 61 | 12 (13%) → 11 | 0 (0%) | 11 (12%) | 8 (9%) | 5 (5%) |
| fix-253-256-2 | 4 | 4 | 97 | 90 | 90 | 3 | 51 (57%) → 57 | 26 (29%) → 20 | 0 (0%) | 9 (10%) → 8 | 4 (4%) → 5 | 7 (7%) |
| fix-253-256-3 | 4 | 4 | 101 | 94 | 94 | 3 | 63 (67%) → 61 | 23 (25%) → 25 | 0 (0%) | 6 (6%) | 2 (2%) | 7 (7%) |

| verdict | fix-253-256-1 primary | fix-253-256-1 secondary | fix-253-256-2 primary | fix-253-256-2 secondary | fix-253-256-3 primary | fix-253-256-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 2 | 2 | 3 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 2 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-253-256-1 | 2 | 2 | 31 | 28 | 27 | 0 | 12 (43%) → 14 | 6 (21%) → 4 | 0 (0%) | 7 (25%) | 3 (11%) | 3 (10%) |
| fix-253-256-2 | 2 | 2 | 32 | 30 | 30 | 1 | 20 (67%) | 2 (7%) | 0 (0%) | 7 (23%) | 1 (3%) | 2 (6%) |
| fix-253-256-3 | 2 | 2 | 23 | 21 | 20 | 0 | 7 (33%) → 9 | 5 (24%) → 3 | 0 (0%) | 8 (38%) | 1 (5%) | 2 (9%) |

| verdict | fix-253-256-1 primary | fix-253-256-1 secondary | fix-253-256-2 primary | fix-253-256-2 secondary | fix-253-256-3 primary | fix-253-256-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 1 | 1 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

