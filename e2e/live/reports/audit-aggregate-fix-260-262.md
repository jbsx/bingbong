# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-21T16:27:48.925Z over fix-260-262-1, fix-260-262-2, fix-260-262-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 11 | 6 | 5 |
| 2 | answer omitted | 6 | 5 | 1 |
| 3 | failed rounds | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | stopped early | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-260-262-1 | 2026-09-21T15:37:00.901Z | complete | 332cd7e0 | no | 1 | 8d716496 |
| fix-260-262-2 | 2026-09-21T15:55:43.407Z | complete | 332cd7e0 | yes | 1 | 8d716496 |
| fix-260-262-3 | 2026-09-21T16:18:06.521Z | complete | 332cd7e0 | yes | 1 | 8d716496 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 255 | 240 | 238 | 7 | 163 (68%) → 142 | 45 (19%) → 66 | 1 (0%) | 24 (10%) | 7 (3%) | 15 (6%) |
| follow_up | 6 | 6 | 66 | 60 | 58 | 0 | 17 (28%) → 18 | 15 (25%) → 14 | 1 (2%) | 25 (42%) | 2 (3%) | 6 (9%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 6 | 2 | 5 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 5 | 1 | 1 | 0 |
| failed rounds | 1 | 0 | 0 | 1 |

- initial: 89 Off-key round(s), 32 Search Loop round(s) by the reviewer (25 by the streak rule, heads included: 17 at streak 2 or beyond, 9 at 3 or beyond; attempts by search source rail 12, replay 0, none 0; navigate searches by Search URL form q 50, param 0, path 1; 4 Blocked Action(s) and 1 inert click(s), 0 inside a Search Loop streak; 1 Unavailable Landing(s) (1 by status, 0 by title), 1 followed by a search; 1 consent dismissal(s), 3 hand consent click(s), 2 blocked then hand consent), 0 inherited, 6 rejected Evidence Checkpoint(s), 6 walled round(s), 10 navigate(s) landed on a Not-found Page (9 judged Off-key), 14 Composed Address(es) rewritten into a site search (9 judged Off-key, 0 to an address the Run was shown), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 9 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 1 Malformed Answer(s) (1 retried), 3 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (1 after a first token, 1 silent); first-token latency p50 3176 ms, p90 5888 ms over 253 round(s), 12 declared Asked Items (5 with an unverified standing, 2 shape failure(s), 0 retried), 1 stopped early, 7 answer omitted, 23 overrule(s), 48 flag(s); Finalization Causes: budget_exhausted 7, none 1, objective_met 4
- follow_up: 5 Off-key round(s), 3 Search Loop round(s) by the reviewer (3 by the streak rule, heads included: 2 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 2, replay 0, none 4; navigate searches by Search URL form q 7, param 0, path 0; 0 Blocked Action(s) and 0 inert click(s), 0 inside a Search Loop streak; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 7 inherited, 7 rejected Evidence Checkpoint(s), 2 walled round(s), 2 navigate(s) landed on a Not-found Page (0 judged Off-key), 1 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 2 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5052 ms, p90 6399 ms over 66 round(s), 6 declared Asked Items (1 with an unverified standing, 1 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 3 overrule(s), 19 flag(s); Finalization Causes: deadline_reached 2, objective_met 4

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 105 (44%) | 20 (34%) |
| read_page | 47 (20%) | 11 (19%) |
| record_evidence | 29 (12%) | 17 (29%) |
| scroll | 26 (11%) | 0 |
| record_candidate | 9 (4%) | 16 (28%) |
| click | 20 (8%) | 1 (2%) |
| report_run_plan | 12 (5%) | 6 (10%) |
| look | 10 (4%) | 0 |
| type | 5 (2%) | 0 |
| agent_results | 1 (0%) | 1 (2%) |
| spawn_agent | 1 (0%) | 1 (2%) |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 3 | 2 |
| rule-eurostar-luggage | 1 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-260-262-1 | 4 | 4 | 78 | 74 | 73 | 2 | 53 (72%) → 43 | 10 (14%) → 20 | 0 (0%) | 8 (11%) | 3 (4%) | 4 (5%) |
| fix-260-262-2 | 4 | 4 | 82 | 77 | 77 | 2 | 50 (65%) → 43 | 19 (25%) → 26 | 0 (0%) | 6 (8%) | 2 (3%) | 5 (6%) |
| fix-260-262-3 | 4 | 4 | 95 | 89 | 88 | 3 | 60 (67%) → 56 | 16 (18%) → 20 | 1 (1%) | 10 (11%) | 2 (2%) | 6 (6%) |

| verdict | fix-260-262-1 primary | fix-260-262-1 secondary | fix-260-262-2 primary | fix-260-262-2 secondary | fix-260-262-3 primary | fix-260-262-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 2 | 3 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 1 | 1 | 2 | 0 |
| failed rounds | 1 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-260-262-1 | 2 | 2 | 21 | 19 | 18 | 0 | 5 (26%) → 7 | 4 (21%) → 2 | 0 (0%) | 9 (47%) | 1 (5%) | 2 (10%) |
| fix-260-262-2 | 2 | 2 | 17 | 15 | 15 | 0 | 3 (20%) | 3 (20%) | 0 (0%) | 9 (60%) | 0 (0%) | 2 (12%) |
| fix-260-262-3 | 2 | 2 | 28 | 26 | 25 | 0 | 9 (35%) → 8 | 8 (31%) → 9 | 1 (4%) | 7 (27%) | 1 (4%) | 2 (7%) |

| verdict | fix-260-262-1 primary | fix-260-262-1 secondary | fix-260-262-2 primary | fix-260-262-2 secondary | fix-260-262-3 primary | fix-260-262-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 1 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 0 |

