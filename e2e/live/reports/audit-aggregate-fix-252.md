# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-15T05:02:34.382Z over fix-252-1, fix-252-2, fix-252-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 14 | 9 | 5 |
| 2 | answer omitted | 4 | 3 | 1 |
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
| fix-252-1 | 2026-09-15T03:55:53.177Z | complete | 185686d6 | no | 1 | b5506051 |
| fix-252-2 | 2026-09-15T04:17:08.785Z | complete | 185686d6 | no | 1 | b5506051 |
| fix-252-3 | 2026-09-15T04:38:41.824Z | complete | 185686d6 | no | 1 | b5506051 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 274 | 255 | 254 | 7 | 144 (56%) → 131 | 47 (18%) → 60 | 1 (0%) | 33 (13%) | 30 (12%) | 19 (7%) |
| follow_up | 6 | 6 | 85 | 76 | 73 | 0 | 30 (40%) | 14 (18%) | 1 (1%) | 26 (34%) | 5 (7%) | 9 (11%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 2 | 5 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 3 | 0 | 1 | 0 |
| failed rounds | 0 | 4 | 0 | 0 |

- initial: 68 Off-key round(s), 23 Search Loop round(s) by the reviewer (11 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 9 rejected Evidence Checkpoint(s), 1 walled round(s), 10 navigate(s) landed on a Not-found Page (9 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 5 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 12 declared Asked Items (5 with an unverified standing, 1 shape failure(s), 1 retried), 0 stopped early, 3 answer omitted, 35 overrule(s), 57 flag(s); Finalization Causes: budget_exhausted 7, objective_met 5
- follow_up: 18 Off-key round(s), 5 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 3, replay 0, none 3), 8 inherited, 9 rejected Evidence Checkpoint(s), 1 walled round(s), 2 navigate(s) landed on a Not-found Page (1 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 6 declared Asked Items (2 with an unverified standing, 2 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 6 overrule(s), 23 flag(s); Finalization Causes: deadline_reached 3, objective_met 3

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 96 (38%) | 24 (33%) |
| read_page | 48 (19%) | 15 (21%) |
| record_evidence | 27 (11%) | 14 (19%) |
| click | 26 (10%) | 4 (5%) |
| scroll | 28 (11%) | 1 (1%) |
| record_candidate | 6 (2%) | 15 (21%) |
| report_run_plan | 12 (5%) | 6 (8%) |
| look | 12 (5%) | 2 (3%) |
| type | 7 (3%) | 0 |
| agent_results | 1 (0%) | 1 (1%) |
| back | 2 (1%) | 0 |
| spawn_agent | 1 (0%) | 1 (1%) |
| ground_visual | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-252-1 | 4 | 4 | 94 | 88 | 87 | 2 | 45 (51%) → 40 | 19 (22%) → 24 | 0 (0%) | 12 (14%) | 12 (14%) | 6 (6%) |
| fix-252-2 | 4 | 4 | 95 | 88 | 88 | 3 | 53 (60%) → 47 | 12 (14%) → 18 | 1 (1%) | 11 (13%) | 11 (13%) | 7 (7%) |
| fix-252-3 | 4 | 4 | 85 | 79 | 79 | 2 | 46 (58%) → 44 | 16 (20%) → 18 | 0 (0%) | 10 (13%) | 7 (9%) | 6 (7%) |

| verdict | fix-252-1 primary | fix-252-1 secondary | fix-252-2 primary | fix-252-2 secondary | fix-252-3 primary | fix-252-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 3 | 1 | 3 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 2 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-252-1 | 2 | 2 | 20 | 17 | 16 | 0 | 5 (29%) → 6 | 4 (24%) → 3 | 0 (0%) | 7 (41%) | 1 (6%) | 3 (15%) |
| fix-252-2 | 2 | 2 | 32 | 29 | 28 | 0 | 14 (48%) → 11 | 4 (14%) → 7 | 1 (3%) | 7 (24%) | 3 (10%) | 3 (9%) |
| fix-252-3 | 2 | 2 | 33 | 30 | 29 | 0 | 11 (37%) → 13 | 6 (20%) → 4 | 0 (0%) | 12 (40%) | 1 (3%) | 3 (9%) |

| verdict | fix-252-1 primary | fix-252-1 secondary | fix-252-2 primary | fix-252-2 secondary | fix-252-3 primary | fix-252-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 1 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

