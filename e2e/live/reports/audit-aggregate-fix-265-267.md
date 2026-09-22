# Round Audit — aggregate over 5 sets (bingbong.live-web.information-hunts)

Generated 2026-09-22T02:09:22.133Z over fix-265-267-1, fix-265-267-2, fix-265-267-3, fix-265-267-4, fix-265-267-5, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 25 | 15 | 10 |
| 2 | answer omitted | 4 | 4 | 0 |
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
| fix-265-267-1 | 2026-09-22T00:04:49.523Z | complete | b44d9dc6 | no | 1 | da049891 |
| fix-265-267-2 | 2026-09-22T00:19:11.929Z | complete | b44d9dc6 | no | 1 | da049891 |
| fix-265-267-3 | 2026-09-22T00:35:47.807Z | complete | b44d9dc6 | no | 1 | da049891 |
| fix-265-267-4 | 2026-09-22T00:55:04.787Z | complete | b44d9dc6 | no | 1 | da049891 |
| fix-265-267-5 | 2026-09-22T01:18:24.274Z | complete | b44d9dc6 | no | 1 | da049891 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 20 | 20 | 380 | 358 | 353 | 5 | 198 (55%) → 215 | 71 (20%) → 54 | 1 (0%) | 78 (22%) | 10 (3%) | 22 (6%) |
| follow_up | 10 | 10 | 84 | 74 | 73 | 0 | 18 (24%) → 22 | 18 (24%) → 14 | 0 (0%) | 37 (50%) | 1 (1%) | 10 (12%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 15 | 2 | 10 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 1 | 0 | 0 |
| answer omitted | 4 | 0 | 0 | 0 |
| failed rounds | 1 | 0 | 0 | 0 |

- initial: 85 Off-key round(s), 35 Search Loop round(s) by the reviewer (33 by the streak rule, heads included: 22 at streak 2 or beyond, 11 at 3 or beyond; attempts by search source rail 19, replay 0, none 1; navigate searches by Search URL form q 61, param 3, path 9; 1 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 1 inert click(s), 1 inside a Search Loop streak, 0 post-block vision round(s), 1 recovery round(s) over 1 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 11 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 1 budget-armed and 1 deadline-armed Tier Escalation(s) (replay found Progress before 1, none before 0), declined no_tier_above 6, 0 declined no_progress against the replay), 0 inherited, 21 rejected Evidence Checkpoint(s), 1 walled round(s), 15 navigate(s) landed on a Not-found Page (10 judged Off-key), 27 Composed Address(es) rewritten into a site search (22 judged Off-key, 0 to an address the Run was shown), 11 search(es) ran with an Unseen Phrase unquoted (7 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 8 Held Page round(s) without Progress, 22 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 4 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2871 ms, p90 7420 ms over 377 round(s), 20 declared Asked Items (3 with an unverified standing, 2 shape failure(s), 1 retried), 1 stopped early, 4 answer omitted, 35 overrule(s), 78 flag(s); Finalization Causes: budget_exhausted 4, deadline_reached 3, none 1, objective_met 12
- follow_up: 3 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 0, replay 0, none 10; navigate searches by Search URL form q 0, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 13 inherited, 5 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 5 Held Page round(s) without Progress, 6 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 1 Malformed Answer(s) (1 retried), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4640 ms, p90 8246 ms over 84 round(s), 10 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 0 answer omitted, 4 overrule(s), 28 flag(s); Finalization Causes: objective_met 10

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 150 (42%) | 19 (26%) |
| record_evidence | 77 (22%) | 25 (34%) |
| read_page | 74 (21%) | 17 (23%) |
| record_candidate | 25 (7%) | 20 (27%) |
| report_run_plan | 20 (6%) | 11 (15%) |
| scroll | 23 (7%) | 0 |
| click | 15 (4%) | 0 |
| type | 9 (3%) | 0 |
| look | 3 (1%) | 0 |
| agent_results | 1 (0%) | 0 |
| spawn_agent | 1 (0%) | 0 |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 5 | 0 | 0 |
| rule-eurostar-luggage | 5 | 0 | 0 |
| superseded-voyager-interstellar | 1 | 0 | 0 |

## Blocked Actions by hunt

Covered and Not Shown outcomes (ADR 0062; pre-#264 heads named no kind), Look or visual grounding rounds within two rounds of one, and the rounds from each to the next round whose action landed or that answered.

| hunt | covered | not shown | pre-#264 | post-block vision rounds | recovery rounds | recovered | never recovered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 1 | 0 | 0 | 0 | 1 | 1 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Tier Escalations by hunt

Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.

| hunt | budget arm | deadline arm | Progress before | no Progress before | declined no_rail | declined no_tier_above | declined once_spent | declined hard_ceiling | declined no_progress | against the replay | not recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055) and searches that ran with an Unseen Phrase unquoted (ADR 0064), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases |
| --- | --- | --- |
| compatibility-pi-camera | 8 | 0 |
| historical-longitude-watch | 0 | 0 |
| rule-eurostar-luggage | 9 | 0 |
| superseded-voyager-interstellar | 10 | 11 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-265-267-1 | 4 | 4 | 83 | 79 | 79 | 1 | 41 (52%) | 9 (11%) | 1 (1%) | 28 (35%) | 0 (0%) | 4 (5%) |
| fix-265-267-2 | 4 | 4 | 80 | 75 | 75 | 2 | 48 (64%) → 50 | 14 (19%) → 12 | 0 (0%) | 12 (16%) | 1 (1%) | 5 (6%) |
| fix-265-267-3 | 4 | 4 | 75 | 71 | 71 | 1 | 39 (55%) → 43 | 16 (23%) → 12 | 0 (0%) | 16 (23%) | 0 (0%) | 4 (5%) |
| fix-265-267-4 | 4 | 4 | 79 | 73 | 70 | 0 | 41 (56%) → 46 | 19 (26%) → 14 | 0 (0%) | 9 (12%) | 4 (6%) | 6 (8%) |
| fix-265-267-5 | 4 | 4 | 63 | 60 | 58 | 1 | 29 (48%) → 35 | 13 (22%) → 7 | 0 (0%) | 13 (22%) | 5 (8%) | 3 (5%) |

| verdict | fix-265-267-1 primary | fix-265-267-1 secondary | fix-265-267-2 primary | fix-265-267-2 secondary | fix-265-267-3 primary | fix-265-267-3 secondary | fix-265-267-4 primary | fix-265-267-4 secondary | fix-265-267-5 primary | fix-265-267-5 secondary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 3 | 1 | 3 | 0 | 3 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| answer omitted | 0 | 0 | 1 | 0 | 1 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-265-267-1 | 2 | 2 | 17 | 15 | 14 | 0 | 2 (13%) | 3 (20%) | 0 (0%) | 9 (60%) | 1 (7%) | 2 (12%) |
| fix-265-267-2 | 2 | 2 | 20 | 18 | 18 | 0 | 3 (17%) → 5 | 5 (28%) → 3 | 0 (0%) | 10 (56%) | 0 (0%) | 2 (10%) |
| fix-265-267-3 | 2 | 2 | 13 | 11 | 11 | 0 | 3 (27%) → 4 | 3 (27%) → 2 | 0 (0%) | 5 (46%) | 0 (0%) | 2 (15%) |
| fix-265-267-4 | 2 | 2 | 17 | 15 | 15 | 0 | 5 (33%) | 3 (20%) | 0 (0%) | 7 (47%) | 0 (0%) | 2 (12%) |
| fix-265-267-5 | 2 | 2 | 17 | 15 | 15 | 0 | 5 (33%) → 6 | 4 (27%) → 3 | 0 (0%) | 6 (40%) | 0 (0%) | 2 (12%) |

| verdict | fix-265-267-1 primary | fix-265-267-1 secondary | fix-265-267-2 primary | fix-265-267-2 secondary | fix-265-267-3 primary | fix-265-267-3 secondary | fix-265-267-4 primary | fix-265-267-4 secondary | fix-265-267-5 primary | fix-265-267-5 secondary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-265-267-1: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text
- fix-265-267-4: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

