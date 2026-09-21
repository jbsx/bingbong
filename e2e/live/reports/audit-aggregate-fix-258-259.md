# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-21T01:51:17.018Z over fix-258-259-1, fix-258-259-2, fix-258-259-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 13 | 9 | 4 |
| 2 | answer omitted | 4 | 2 | 2 |
| 3 | tier too small or never escalated | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | stopped early | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-258-259-1 | 2026-09-20T15:18:35.496Z | complete | a7b87513 | no | 1 | e2b4c5d9 (dirty) |
| fix-258-259-2 | 2026-09-20T15:37:45.924Z | complete | a7b87513 | no | 1 | e2b4c5d9 (dirty) |
| fix-258-259-3 | 2026-09-20T15:56:57.058Z | complete | a7b87513 | no | 1 | e2b4c5d9 (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 236 | 220 | 218 | 4 | 145 (66%) → 143 | 48 (22%) | 2 (1%) | 21 (10%) → 23 | 4 (2%) | 16 (7%) |
| follow_up | 6 | 6 | 62 | 56 | 53 | 0 | 16 (29%) | 10 (18%) | 1 (2%) | 26 (46%) | 3 (5%) | 6 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 3 | 4 | 1 |
| tier too small or never escalated | 1 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 1 | 0 | 0 |
| answer omitted | 2 | 1 | 2 | 0 |
| failed rounds | 0 | 0 | 0 | 1 |

- initial: 69 Off-key round(s), 23 Search Loop round(s) by the reviewer (17 by the streak rule, heads included: 11 at streak 2 or beyond, 4 at 3 or beyond; attempts by search source rail 11, replay 0, none 1), 0 inherited, 5 rejected Evidence Checkpoint(s), 1 walled round(s), 8 navigate(s) landed on a Not-found Page (8 judged Off-key), 10 Composed Address(es) rewritten into a site search (10 judged Off-key, 0 to an address the Run was shown), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 10 Held Page round(s) without Progress, 10 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (2 retried), 3 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2889 ms, p90 5666 ms over 236 round(s), 12 declared Asked Items (7 with an unverified standing, 4 shape failure(s), 2 retried), 1 stopped early, 3 answer omitted, 29 overrule(s), 69 flag(s); Finalization Causes: budget_exhausted 4, deadline_reached 1, model_answered 1, no_progress 1, objective_met 5
- follow_up: 1 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 5), 7 inherited, 7 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 13 Subagent round(s), 1 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5194 ms, p90 7145 ms over 62 round(s), 6 declared Asked Items (0 with an unverified standing, 1 shape failure(s), 1 retried), 0 stopped early, 2 answer omitted, 4 overrule(s), 24 flag(s); Finalization Causes: deadline_reached 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 86 (39%) | 12 (23%) |
| read_page | 47 (22%) | 11 (21%) |
| record_evidence | 25 (11%) | 16 (30%) |
| scroll | 34 (16%) | 0 |
| record_candidate | 8 (4%) | 15 (28%) |
| report_run_plan | 13 (6%) | 6 (11%) |
| look | 13 (6%) | 2 (4%) |
| click | 10 (5%) | 0 |
| type | 6 (3%) | 0 |
| agent_results | 2 (1%) | 1 (2%) |
| spawn_agent | 2 (1%) | 1 (2%) |
| ground_visual | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-258-259-1 | 4 | 4 | 76 | 71 | 70 | 1 | 46 (65%) → 52 | 15 (21%) → 9 | 0 (0%) | 8 (11%) | 2 (3%) | 5 (7%) |
| fix-258-259-2 | 4 | 4 | 75 | 68 | 67 | 1 | 45 (66%) | 15 (22%) | 1 (2%) | 6 (9%) | 1 (2%) | 7 (9%) |
| fix-258-259-3 | 4 | 4 | 85 | 81 | 81 | 2 | 54 (67%) → 46 | 18 (22%) → 24 | 1 (1%) | 7 (9%) → 9 | 1 (1%) | 4 (5%) |

| verdict | fix-258-259-1 primary | fix-258-259-1 secondary | fix-258-259-2 primary | fix-258-259-2 secondary | fix-258-259-3 primary | fix-258-259-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 2 | 4 | 0 | 3 | 1 |
| tier too small or never escalated | 1 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 1 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 1 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-258-259-1 | 2 | 2 | 26 | 24 | 23 | 0 | 5 (21%) → 3 | 4 (17%) → 6 | 1 (4%) | 13 (54%) | 1 (4%) | 2 (8%) |
| fix-258-259-2 | 2 | 2 | 20 | 18 | 18 | 0 | 6 (33%) → 7 | 3 (17%) → 2 | 0 (0%) | 9 (50%) | 0 (0%) | 2 (10%) |
| fix-258-259-3 | 2 | 2 | 16 | 14 | 12 | 0 | 5 (36%) → 6 | 3 (21%) → 2 | 0 (0%) | 4 (29%) | 2 (14%) | 2 (13%) |

| verdict | fix-258-259-1 primary | fix-258-259-1 secondary | fix-258-259-2 primary | fix-258-259-2 secondary | fix-258-259-3 primary | fix-258-259-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 1 | 1 | 1 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 1 |

## Caveats

- fix-258-259-1: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

