# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-28T00:51:53.507Z over fix-283-1, fix-283-2, fix-283-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 14 | 9 | 5 |
| 2 | answer omitted | 3 | 3 | 0 |
| 3 | stopped early | 1 | 0 | 1 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: passage,result,tier | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-283-1 | 2026-09-27T23:22:42.422Z | complete | 3a172fe6 | no | 1 | 922b7bac |
| fix-283-2 | 2026-09-27T23:40:19.691Z | complete | 3a172fe6 | no | 1 | 922b7bac |
| fix-283-3 | 2026-09-27T23:58:20.941Z | complete | 3a172fe6 | no | 1 | 922b7bac |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 245 | 232 | 230 | 3 | 147 (63%) → 158 | 46 (20%) → 35 | 1 (0%) | 33 (14%) | 5 (2%) | 13 (5%) |
| follow_up | 6 | 6 | 62 | 56 | 54 | 0 | 23 (41%) | 12 (21%) | 0 (0%) | 17 (30%) | 4 (7%) | 6 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 2 | 5 | 1 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| answer omitted | 3 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 50 Off-key round(s), 30 Search Loop round(s) by the reviewer (28 by the streak rule, heads included: 15 at streak 2 or beyond, 2 at 3 or beyond; attempts by search source rail 10, replay 0, none 2; navigate searches by Search URL form q 36, param 0, path 16; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 7 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 4, 0 declined no_progress against the replay), 0 inherited, 0 rejected Evidence Checkpoint(s), 0 walled round(s), 5 navigate(s) landed on a Not-found Page (4 judged Off-key), 4 Composed Address(es) rewritten into a site search (2 judged Off-key, 0 to an address the Run was shown), 10 search(es) ran with an Unseen Phrase unquoted (9 judged Off-key), 3 search(es) ran on the Run Engine in place of another Web Engine (3 judged Off-key), 10 Result Pick(s) against 46 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (41 of 56 searches), 25 Run-made Evidence Checkpoint(s) from a Selected Passage (20 recorded again by the model from the same page, 10 with the same passage) against 51 record_evidence call(s) by the model and 33 bookkeeping-only round(s), of 25 Run-made Evidence Checkpoint(s), 13 whose passage a later record of the model's contains and 13 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 12 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 15 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 Malformed Answer(s) (1 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 3 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2447 ms, p90 5178 ms over 245 round(s), 12 declared Asked Items (0 with an unverified standing, 1 shape failure(s), 1 retried), 0 stopped early, 3 answer omitted, 25 overrule(s), 65 flag(s); Finalization Causes: budget_exhausted 3, deadline_reached 1, objective_met 8
- follow_up: 5 Off-key round(s), 3 Search Loop round(s) by the reviewer (2 by the streak rule, heads included: 1 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 2, replay 0, none 4; navigate searches by Search URL form q 5, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 1 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 8 inherited, 2 rejected Evidence Checkpoint(s), 1 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 1 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 1 Result Pick(s) against 3 listing(s) returned to the model, a search’s result opened in 1.7 round(s) on average (3 of 4 searches), 3 Run-made Evidence Checkpoint(s) from a Selected Passage (2 recorded again by the model from the same page, 2 with the same passage) against 12 record_evidence call(s) by the model and 17 bookkeeping-only round(s), of 3 Run-made Evidence Checkpoint(s), 2 whose passage a later record of the model's contains and 2 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 1 Malformed Answer(s) (2 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4483 ms, p90 5319 ms over 62 round(s), 6 declared Asked Items (0 with an unverified standing, 1 shape failure(s), 1 retried), 1 stopped early, 0 answer omitted, 4 overrule(s), 27 flag(s); Finalization Causes: objective_met 6

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 110 (48%) | 16 (30%) |
| read_page | 59 (26%) | 13 (24%) |
| record_evidence | 41 (18%) | 10 (19%) |
| record_candidate | 8 (3%) | 11 (20%) |
| report_run_plan | 12 (5%) | 6 (11%) |
| scroll | 14 (6%) | 3 (6%) |
| click | 5 (2%) | 5 (9%) |
| type | 4 (2%) | 0 |
| look | 3 (1%) | 0 |
| agent_results | 1 (0%) | 0 |
| spawn_agent | 1 (0%) | 0 |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 1 | 0 |
| historical-longitude-watch | 3 | 0 | 0 |
| rule-eurostar-luggage | 3 | 0 | 0 |
| superseded-voyager-interstellar | 1 | 0 | 0 |

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
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 1 | 0 | 1 |
| historical-longitude-watch | 0 | 1 | 1 |
| rule-eurostar-luggage | 3 | 0 | 0 |
| superseded-voyager-interstellar | 1 | 9 | 1 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 2 | 1 | 1 (100%) | 1 | 1 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 2 (67%) | 2 | 1 (50%) |
| historical-longitude-watch (initial) | 3 | 0 | 3 | 2 (67%) | 3 | 2 (67%) |
| rule-eurostar-luggage (initial) | 3 | 1 | 2 | 2 (100%) | 2 | 2 (100%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 1 | 2 | 2 (100%) | 2 | 2 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 3 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 2 | 0 (0%) |
| historical-longitude-watch (initial) | budget_exhausted | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 2 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | objective_met | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | budget_exhausted | 1 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-283-1 | 4 | 4 | 76 | 72 | 72 | 1 | 46 (64%) → 55 | 12 (17%) → 3 | 0 (0%) | 13 (18%) | 1 (1%) | 4 (5%) |
| fix-283-2 | 4 | 4 | 76 | 71 | 70 | 1 | 42 (59%) → 45 | 19 (27%) → 16 | 0 (0%) | 8 (11%) | 2 (3%) | 5 (7%) |
| fix-283-3 | 4 | 4 | 93 | 89 | 88 | 1 | 59 (66%) → 58 | 15 (17%) → 16 | 1 (1%) | 12 (14%) | 2 (2%) | 4 (4%) |

| verdict | fix-283-1 primary | fix-283-1 secondary | fix-283-2 primary | fix-283-2 secondary | fix-283-3 primary | fix-283-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 3 | 0 | 3 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-283-1 | 2 | 2 | 23 | 21 | 21 | 0 | 11 (52%) | 5 (24%) | 0 (0%) | 4 (19%) | 1 (5%) | 2 (9%) |
| fix-283-2 | 2 | 2 | 14 | 12 | 11 | 0 | 2 (17%) | 1 (8%) | 0 (0%) | 8 (67%) | 1 (8%) | 2 (14%) |
| fix-283-3 | 2 | 2 | 25 | 23 | 22 | 0 | 10 (44%) | 6 (26%) | 0 (0%) | 5 (22%) | 2 (9%) | 2 (8%) |

| verdict | fix-283-1 primary | fix-283-1 secondary | fix-283-2 primary | fix-283-2 secondary | fix-283-3 primary | fix-283-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 1 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

