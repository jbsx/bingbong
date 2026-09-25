# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-25T23:35:19.976Z over fix-270-1, fix-270-2, fix-270-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 15 | 10 | 5 |
| 2 | answer omitted | 3 | 2 | 1 |
| 3 | budget too small for the Hunt | 0 | 0 | 0 |
| 4 | failed rounds | 0 | 0 | 0 |
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
| fix-270-1 | 2026-09-25T22:15:13.312Z | complete | b23e1b26 | no | 1 | 8bddd58f |
| fix-270-2 | 2026-09-25T22:33:24.404Z | complete | b23e1b26 | no | 1 | 8bddd58f |
| fix-270-3 | 2026-09-25T22:51:19.137Z | complete | b23e1b26 | no | 1 | 8bddd58f |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 219 | 205 | 201 | 1 | 112 (55%) → 114 | 50 (24%) → 48 | 1 (1%) | 35 (17%) | 7 (3%) | 14 (6%) |
| follow_up | 6 | 6 | 56 | 50 | 50 | 0 | 18 (36%) → 20 | 14 (28%) → 12 | 0 (0%) | 17 (34%) | 1 (2%) | 6 (11%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 10 | 2 | 5 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 1 | 0 | 0 |
| answer omitted | 2 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 60 Off-key round(s), 32 Search Loop round(s) by the reviewer (32 by the streak rule, heads included: 23 at streak 2 or beyond, 14 at 3 or beyond; attempts by search source rail 11, replay 0, none 1; navigate searches by Search URL form q 41, param 1, path 4; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 1 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 1, none before 0), declined no_tier_above 3, 0 declined no_progress against the replay), 0 inherited, 6 rejected Evidence Checkpoint(s), 1 walled round(s), 9 navigate(s) landed on a Not-found Page (9 judged Off-key), 13 Composed Address(es) rewritten into a site search (12 judged Off-key, 0 to an address the Run was shown), 9 search(es) ran with an Unseen Phrase unquoted (8 judged Off-key), 2 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 6 Held Page round(s) without Progress, 9 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 3 while running, 1 while finished and uncollected, 3 after collection, 0 Malformed Answer(s) (3 retried), 1 Transport Failure attempt(s) (1 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2958 ms, p90 5557 ms over 219 round(s), 12 declared Asked Items (2 with an unverified standing, 3 shape failure(s), 3 retried), 1 stopped early, 2 answer omitted, 22 overrule(s), 68 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 2, objective_met 9
- follow_up: 10 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 5; navigate searches by Search URL form q 4, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 8 inherited, 2 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 5 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4892 ms, p90 5636 ms over 56 round(s), 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 4 overrule(s), 21 flag(s); Finalization Causes: objective_met 6

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 93 (46%) | 15 (30%) |
| read_page | 50 (25%) | 14 (28%) |
| record_evidence | 37 (18%) | 9 (18%) |
| record_candidate | 10 (5%) | 12 (24%) |
| report_run_plan | 12 (6%) | 6 (12%) |
| click | 10 (5%) | 0 |
| scroll | 7 (3%) | 2 (4%) |
| look | 2 (1%) | 2 (4%) |
| type | 4 (2%) | 0 |
| agent_results | 1 (0%) | 0 |
| spawn_agent | 1 (0%) | 0 |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 3 | 0 | 0 |
| rule-eurostar-luggage | 3 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 |

## Blocked Actions by hunt

Covered and Not Shown outcomes (ADR 0062; pre-#264 heads named no kind), Look or visual grounding rounds within two rounds of one, and the rounds from each to the next round whose action landed or that answered.

| hunt | covered | not shown | pre-#264 | post-block vision rounds | recovery rounds | recovered | never recovered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Tier Escalations by hunt

Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.

| hunt | budget arm | deadline arm | Progress before | no Progress before | declined no_rail | declined no_tier_above | declined once_spent | declined hard_ceiling | declined no_progress | against the replay | not recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 1 | 0 | 0 |
| historical-longitude-watch | 1 | 1 | 1 |
| rule-eurostar-luggage | 5 | 0 | 0 |
| superseded-voyager-interstellar | 6 | 8 | 1 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-270-1 | 4 | 4 | 71 | 66 | 64 | 1 | 38 (58%) → 36 | 17 (26%) → 19 | 0 (0%) | 7 (11%) | 4 (6%) | 5 (7%) |
| fix-270-2 | 4 | 4 | 72 | 68 | 67 | 0 | 38 (56%) → 41 | 16 (24%) → 13 | 1 (2%) | 11 (16%) | 2 (3%) | 4 (6%) |
| fix-270-3 | 4 | 4 | 76 | 71 | 70 | 0 | 36 (51%) → 37 | 17 (24%) → 16 | 0 (0%) | 17 (24%) | 1 (1%) | 5 (7%) |

| verdict | fix-270-1 primary | fix-270-1 secondary | fix-270-2 primary | fix-270-2 secondary | fix-270-3 primary | fix-270-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 2 | 2 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 1 | 0 | 0 |
| answer omitted | 0 | 0 | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-270-1 | 2 | 2 | 11 | 9 | 9 | 0 | 2 (22%) → 3 | 3 (33%) → 2 | 0 (0%) | 4 (44%) | 0 (0%) | 2 (18%) |
| fix-270-2 | 2 | 2 | 28 | 26 | 26 | 0 | 14 (54%) → 13 | 7 (27%) → 8 | 0 (0%) | 5 (19%) | 0 (0%) | 2 (7%) |
| fix-270-3 | 2 | 2 | 17 | 15 | 15 | 0 | 2 (13%) → 4 | 4 (27%) → 2 | 0 (0%) | 8 (53%) | 1 (7%) | 2 (12%) |

| verdict | fix-270-1 primary | fix-270-1 secondary | fix-270-2 primary | fix-270-2 secondary | fix-270-3 primary | fix-270-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-270-3: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

