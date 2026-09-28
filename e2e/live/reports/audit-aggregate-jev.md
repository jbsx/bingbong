# Round Audit — aggregate over 6 sets (bingbong.live-web.information-hunts)

Generated 2026-09-27T17:59:28.951Z over jev-on-1, jev-off-1, jev-on-2, jev-off-2, jev-on-3, jev-off-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 30 | 19 | 11 |
| 2 | answer omitted | 5 | 4 | 1 |
| 3 | stopped early | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing differs, pooled by --allow-differs=routing: jev-on-1=decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-off-1=decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-on-2=decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-off-2=decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-on-3=decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V, jev-off-3=decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V
- mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | 2026-09-27T03:32:26.417Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-off-1 | 2026-09-27T03:50:35.741Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-on-2 | 2026-09-27T04:09:10.271Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-off-2 | 2026-09-27T04:30:12.583Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-on-3 | 2026-09-27T04:48:02.384Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-off-3 | 2026-09-27T05:05:35.175Z | complete | fda11fe4 | no | 1 | 03c966ef |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 24 | 24 | 476 | 448 | 443 | 5 | 285 (64%) → 290 | 80 (18%) → 75 | 1 (0%) | 68 (15%) | 14 (3%) | 28 (6%) |
| follow_up | 12 | 12 | 107 | 95 | 93 | 0 | 28 (30%) → 32 | 27 (28%) → 21 | 2 (2%) | 35 (37%) → 37 | 3 (3%) | 12 (11%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 19 | 4 | 11 | 1 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 |
| answer omitted | 4 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 1 |

- initial: 104 Off-key round(s), 55 Search Loop round(s) by the reviewer (49 by the streak rule, heads included: 29 at streak 2 or beyond, 8 at 3 or beyond; attempts by search source rail 24, replay 0, none 0; navigate searches by Search URL form q 83, param 0, path 15; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 14 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 1 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 1, none before 0), declined no_tier_above 8, 0 declined no_progress against the replay), 0 inherited, 16 rejected Evidence Checkpoint(s), 2 walled round(s), 19 navigate(s) landed on a Not-found Page (19 judged Off-key), 25 Composed Address(es) rewritten into a site search (17 judged Off-key, 0 to an address the Run was shown), 11 search(es) ran with an Unseen Phrase unquoted (10 judged Off-key), 4 search(es) ran on the Run Engine in place of another Web Engine (3 judged Off-key), 5 Result Pick(s) against 101 listing(s) returned to the model, a search’s result opened in 2.4 round(s) on average (75 of 106 searches), 1 Run-made Evidence Checkpoint(s) from a Selected Passage (1 recorded again by the model from the same page, 1 with the same passage) against 95 record_evidence call(s) by the model and 68 bookkeeping-only round(s), 17 accepted record(s) answered with the contradiction Note, 24 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 12 Held Page round(s) without Progress, 23 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 1 while running, 0 while finished and uncollected, 0 after collection, 1 Malformed Answer(s) (2 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 4 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (0 after a first token, 2 silent); first-token latency p50 2839 ms, p90 5513 ms over 473 round(s), 24 declared Asked Items (3 with an unverified standing, 2 shape failure(s), 1 retried), 1 stopped early, 4 answer omitted, 39 overrule(s), 138 flag(s); Finalization Causes: budget_exhausted 5, deadline_reached 3, model_answered 1, objective_met 15
- follow_up: 5 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 2, replay 0, none 10; navigate searches by Search URL form q 3, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 3 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 19 inherited, 6 rejected Evidence Checkpoint(s), 2 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 1 search(es) ran with an Unseen Phrase unquoted (1 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 2 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (2 of 2 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 34 record_evidence call(s) by the model and 35 bookkeeping-only round(s), 17 accepted record(s) answered with the contradiction Note, 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 8 Held Page round(s) without Progress, 8 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 1 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 1 while running, 0 while finished and uncollected, 0 after collection, 2 Malformed Answer(s) (2 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4491 ms, p90 6022 ms over 107 round(s), 12 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 10 overrule(s), 46 flag(s); Finalization Causes: objective_met 12

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 24 | 18 | 1 | 19 of 24 | 0 |
| initial: jev-on-1 | 4 | 3 | 1 | 4 of 4 | 0 |
| initial: jev-off-1 | 4 | 2 | 0 | 2 of 4 | 0 |
| initial: jev-on-2 | 4 | 2 | 0 | 2 of 4 | 0 |
| initial: jev-off-2 | 4 | 3 | 0 | 3 of 4 | 0 |
| initial: jev-on-3 | 4 | 4 | 0 | 4 of 4 | 0 |
| initial: jev-off-3 | 4 | 4 | 0 | 4 of 4 | 0 |
| follow_up | 12 | 11 | 0 | 11 of 12 | 0 |
| follow_up: jev-on-1 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: jev-off-1 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: jev-on-2 | 2 | 1 | 0 | 1 of 2 | 0 |
| follow_up: jev-off-2 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: jev-on-3 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: jev-off-3 | 2 | 2 | 0 | 2 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 221 (50%) | 31 (33%) |
| read_page | 103 (23%) | 24 (26%) |
| record_evidence | 73 (16%) | 26 (28%) |
| record_candidate | 23 (5%) | 24 (26%) |
| report_run_plan | 24 (5%) | 12 (13%) |
| scroll | 34 (8%) | 1 (1%) |
| type | 8 (2%) | 0 |
| click | 6 (1%) | 0 |
| agent_results | 1 (0%) | 2 (2%) |
| look | 3 (1%) | 0 |
| spawn_agent | 1 (0%) | 2 (2%) |
| back | 1 (0%) | 0 |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 6 | 0 | 0 |
| rule-eurostar-luggage | 6 | 0 | 0 |
| superseded-voyager-interstellar | 2 | 0 | 0 |

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
| compatibility-pi-camera | 0 | 3 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 1 | 0 | 1 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 11 | 1 | 0 |
| historical-longitude-watch | 0 | 0 | 1 |
| rule-eurostar-luggage | 2 | 1 | 2 |
| superseded-voyager-interstellar | 12 | 10 | 1 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 1 (33%) | 3 | 1 (33%) |
| historical-longitude-watch (initial) | 3 | 0 | 3 | 2 (67%) | 3 | 2 (67%) |
| rule-eurostar-luggage (initial) | 3 | 0 | 3 | 2 (67%) | 2 | 2 (100%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 1 | 2 | 2 (100%) | 2 | 2 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 2 | 0 (0%) |
| compatibility-pi-camera (initial) | budget_exhausted | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 3 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 2 | 0 (0%) |
| historical-longitude-watch (initial) | budget_exhausted | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 3 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | objective_met | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | budget_exhausted | 1 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | 4 | 4 | 74 | 70 | 70 | 0 | 50 (71%) → 46 | 9 (13%) → 13 | 0 (0%) | 10 (14%) | 1 (1%) | 4 (5%) |
| jev-off-1 | 4 | 4 | 89 | 84 | 82 | 0 | 49 (58%) → 53 | 18 (21%) → 14 | 0 (0%) | 13 (16%) | 4 (5%) | 5 (6%) |
| jev-on-2 | 4 | 4 | 91 | 86 | 86 | 3 | 56 (65%) | 14 (16%) | 0 (0%) | 14 (16%) | 2 (2%) | 5 (6%) |
| jev-off-2 | 4 | 4 | 71 | 66 | 64 | 0 | 42 (64%) → 41 | 13 (20%) → 14 | 1 (2%) | 7 (11%) | 3 (5%) | 5 (7%) |
| jev-on-3 | 4 | 4 | 65 | 61 | 61 | 0 | 37 (61%) → 42 | 11 (18%) → 6 | 0 (0%) | 12 (20%) | 1 (2%) | 4 (6%) |
| jev-off-3 | 4 | 4 | 86 | 81 | 80 | 2 | 51 (63%) → 52 | 15 (19%) → 14 | 0 (0%) | 12 (15%) | 3 (4%) | 5 (6%) |

| verdict | jev-on-1 primary | jev-on-1 secondary | jev-off-1 primary | jev-off-1 secondary | jev-on-2 primary | jev-on-2 secondary | jev-off-2 primary | jev-off-2 secondary | jev-on-3 primary | jev-on-3 secondary | jev-off-3 primary | jev-off-3 secondary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 2 | 2 | 3 | 1 | 3 | 1 | 4 | 0 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | 2 | 2 | 17 | 15 | 14 | 0 | 3 (20%) → 5 | 5 (33%) → 3 | 0 (0%) | 6 (40%) | 1 (7%) | 2 (12%) |
| jev-off-1 | 2 | 2 | 19 | 17 | 17 | 0 | 2 (12%) → 4 | 6 (35%) → 3 | 0 (0%) | 9 (53%) → 10 | 0 (0%) | 2 (11%) |
| jev-on-2 | 2 | 2 | 22 | 20 | 19 | 0 | 7 (35%) | 5 (25%) | 1 (5%) | 5 (25%) | 2 (10%) | 2 (9%) |
| jev-off-2 | 2 | 2 | 19 | 17 | 17 | 0 | 10 (59%) → 9 | 1 (6%) → 2 | 1 (6%) | 5 (29%) | 0 (0%) | 2 (11%) |
| jev-on-3 | 2 | 2 | 17 | 15 | 15 | 0 | 4 (27%) | 6 (40%) → 5 | 0 (0%) | 5 (33%) → 6 | 0 (0%) | 2 (12%) |
| jev-off-3 | 2 | 2 | 13 | 11 | 11 | 0 | 2 (18%) → 3 | 4 (36%) → 3 | 0 (0%) | 5 (46%) | 0 (0%) | 2 (15%) |

| verdict | jev-on-1 primary | jev-on-1 secondary | jev-off-1 primary | jev-off-1 secondary | jev-on-2 primary | jev-on-2 secondary | jev-off-2 primary | jev-off-2 secondary | jev-on-3 primary | jev-on-3 secondary | jev-off-3 primary | jev-off-3 secondary |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 1 | 1 | 2 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- jev-on-2: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

