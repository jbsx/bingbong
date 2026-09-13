# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-13T14:09:35.241Z over fix-235-1, fix-235-2, fix-235-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 17 | 11 | 6 |
| 2 | stopped early | 1 | 1 | 0 |
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
| fix-235-1 | 2026-09-13T12:53:13.577Z | complete | 7b6e2727 | no | 1 | 7b6e2727 (dirty) |
| fix-235-2 | 2026-09-13T13:24:22.486Z | complete | 7b6e2727 | no | 1 | 7b6e2727 (dirty) |
| fix-235-3 | 2026-09-13T13:51:29.248Z | complete | 7b6e2727 | no | 1 | 7b6e2727 (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 272 | 254 | 252 | 4 | 156 (61%) → 155 | 44 (17%) → 45 | 0 (0%) | 38 (15%) | 16 (6%) | 18 (7%) |
| follow_up | 6 | 6 | 81 | 74 | 73 | 0 | 33 (45%) → 32 | 13 (18%) → 14 | 2 (3%) | 24 (32%) | 2 (3%) | 7 (9%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 11 | 1 | 6 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 2 | 0 | 0 |

- initial: 101 Off-key round(s), 26 Search Loop round(s) by the reviewer (5 by the streak rule), 0 inherited, 12 rejected Evidence Checkpoint(s), 3 walled round(s), 0 Subagent round(s), 1 stopped early, 27 overrule(s), 65 flag(s); Finalization Causes: budget_exhausted 4, deadline_reached 2, objective_met 6
- follow_up: 13 Off-key round(s), 9 Search Loop round(s) by the reviewer (0 by the streak rule), 9 inherited, 10 rejected Evidence Checkpoint(s), 0 walled round(s), 44 Subagent round(s), 0 stopped early, 5 overrule(s), 25 flag(s); Finalization Causes: deadline_reached 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 107 (42%) | 24 (33%) |
| read_page | 52 (21%) | 16 (22%) |
| record_evidence | 34 (13%) | 17 (23%) |
| report_run_plan | 13 (5%) | 6 (8%) |
| scroll | 14 (6%) | 4 (5%) |
| type | 17 (7%) | 1 (1%) |
| click | 16 (6%) | 1 (1%) |
| record_candidate | 7 (3%) | 10 (14%) |
| look | 9 (4%) | 2 (3%) |
| agent_results | 0 | 3 (4%) |
| spawn_agent | 0 | 3 (4%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-235-1 | 4 | 4 | 91 | 85 | 84 | 1 | 56 (66%) → 53 | 10 (12%) → 13 | 0 (0%) | 14 (17%) | 5 (6%) | 6 (7%) |
| fix-235-2 | 4 | 4 | 97 | 91 | 90 | 1 | 56 (62%) | 17 (19%) | 0 (0%) | 11 (12%) | 7 (8%) | 6 (6%) |
| fix-235-3 | 4 | 4 | 84 | 78 | 78 | 2 | 44 (56%) → 46 | 17 (22%) → 15 | 0 (0%) | 13 (17%) | 4 (5%) | 6 (7%) |

| verdict | fix-235-1 primary | fix-235-1 secondary | fix-235-2 primary | fix-235-2 secondary | fix-235-3 primary | fix-235-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 4 | 0 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-235-1 | 2 | 2 | 28 | 25 | 24 | 0 | 13 (52%) → 10 | 5 (20%) → 8 | 1 (4%) | 5 (20%) | 1 (4%) | 3 (11%) |
| fix-235-2 | 2 | 2 | 29 | 27 | 27 | 0 | 15 (56%) | 3 (11%) | 0 (0%) | 8 (30%) | 1 (4%) | 2 (7%) |
| fix-235-3 | 2 | 2 | 24 | 22 | 22 | 0 | 5 (23%) → 7 | 5 (23%) → 3 | 1 (5%) | 11 (50%) | 0 (0%) | 2 (8%) |

| verdict | fix-235-1 primary | fix-235-1 secondary | fix-235-2 primary | fix-235-2 secondary | fix-235-3 primary | fix-235-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-235-2: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

