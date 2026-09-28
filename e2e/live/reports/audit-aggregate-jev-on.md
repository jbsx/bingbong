# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-28T03:10:00.000Z over jev-on-1, jev-on-2, jev-on-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

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
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | 2026-09-27T03:32:26.417Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-on-2 | 2026-09-27T04:09:10.271Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-on-3 | 2026-09-27T04:48:02.384Z | complete | fda11fe4 | no | 1 | 03c966ef |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 230 | 217 | 217 | 3 | 143 (66%) → 144 | 34 (16%) → 33 | 0 (0%) | 36 (17%) | 4 (2%) | 13 (6%) |
| follow_up | 6 | 6 | 56 | 50 | 48 | 0 | 14 (28%) → 16 | 16 (32%) → 13 | 1 (2%) | 16 (32%) → 17 | 3 (6%) | 6 (11%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 10 | 1 | 5 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 1 |

- initial: 55 Off-key round(s), 25 Search Loop round(s) by the reviewer (19 by the streak rule, heads included: 10 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 12, replay 0, none 0; navigate searches by Search URL form q 38, param 0, path 8; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 1 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 1, none before 0), declined no_tier_above 3, 0 declined no_progress against the replay), 0 inherited, 8 rejected Evidence Checkpoint(s), 1 walled round(s), 9 navigate(s) landed on a Not-found Page (9 judged Off-key), 12 Composed Address(es) rewritten into a site search (7 judged Off-key, 0 to an address the Run was shown), 4 search(es) ran with an Unseen Phrase unquoted (4 judged Off-key), 2 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 5 Result Pick(s) against 45 listing(s) returned to the model, a search’s result opened in 2.2 round(s) on average (39 of 50 searches), 1 Run-made Evidence Checkpoint(s) from a Selected Passage (1 recorded again by the model from the same page, 1 with the same passage) against 49 record_evidence call(s) by the model and 36 bookkeeping-only round(s), Run-made checkpoints contained or cited not counted, 10 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 8 Held Page round(s) without Progress, 11 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 2 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2867 ms, p90 5497 ms over 230 round(s), 12 declared Asked Items (2 with an unverified standing, 1 shape failure(s), 0 retried), 0 stopped early, 2 answer omitted, 19 overrule(s), 69 flag(s); Finalization Causes: budget_exhausted 3, objective_met 9
- follow_up: 2 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 5; navigate searches by Search URL form q 1, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 11 inherited, 2 rejected Evidence Checkpoint(s), 1 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 0 listing(s) returned to the model, no search had a result opened (0 of 0 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 17 record_evidence call(s) by the model and 16 bookkeeping-only round(s), Run-made checkpoints contained or cited not counted, 9 accepted record(s) answered with the contradiction Note, 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 1 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 2 Malformed Answer(s) (2 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4426 ms, p90 5483 ms over 56 round(s), 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 5 overrule(s), 24 flag(s); Finalization Causes: objective_met 6

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 12 | 9 | 1 | 10 of 12 | 0 |
| initial: jev-on-1 | 4 | 3 | 1 | 4 of 4 | 0 |
| initial: jev-on-2 | 4 | 2 | 0 | 2 of 4 | 0 |
| initial: jev-on-3 | 4 | 4 | 0 | 4 of 4 | 0 |
| follow_up | 6 | 5 | 0 | 5 of 6 | 0 |
| follow_up: jev-on-1 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: jev-on-2 | 2 | 1 | 0 | 1 of 2 | 0 |
| follow_up: jev-on-3 | 2 | 2 | 0 | 2 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 103 (47%) | 17 (35%) |
| read_page | 50 (23%) | 13 (27%) |
| record_evidence | 42 (19%) | 11 (23%) |
| record_candidate | 8 (4%) | 12 (25%) |
| scroll | 18 (8%) | 1 (2%) |
| report_run_plan | 12 (6%) | 6 (13%) |
| click | 6 (3%) | 0 |
| type | 4 (2%) | 0 |
| agent_results | 0 | 1 (2%) |
| look | 1 (0%) | 0 |
| spawn_agent | 0 | 1 (2%) |

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
| compatibility-pi-camera | 0 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 6 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 1 |
| rule-eurostar-luggage | 1 | 0 | 1 |
| superseded-voyager-interstellar | 5 | 4 | 0 |

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
| jev-on-2 | 4 | 4 | 91 | 86 | 86 | 3 | 56 (65%) | 14 (16%) | 0 (0%) | 14 (16%) | 2 (2%) | 5 (6%) |
| jev-on-3 | 4 | 4 | 65 | 61 | 61 | 0 | 37 (61%) → 42 | 11 (18%) → 6 | 0 (0%) | 12 (20%) | 1 (2%) | 4 (6%) |

| verdict | jev-on-1 primary | jev-on-1 secondary | jev-on-2 primary | jev-on-2 secondary | jev-on-3 primary | jev-on-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 3 | 1 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-on-1 | 2 | 2 | 17 | 15 | 14 | 0 | 3 (20%) → 5 | 5 (33%) → 3 | 0 (0%) | 6 (40%) | 1 (7%) | 2 (12%) |
| jev-on-2 | 2 | 2 | 22 | 20 | 19 | 0 | 7 (35%) | 5 (25%) | 1 (5%) | 5 (25%) | 2 (10%) | 2 (9%) |
| jev-on-3 | 2 | 2 | 17 | 15 | 15 | 0 | 4 (27%) | 6 (40%) → 5 | 0 (0%) | 5 (33%) → 6 | 0 (0%) | 2 (12%) |

| verdict | jev-on-1 primary | jev-on-1 secondary | jev-on-2 primary | jev-on-2 secondary | jev-on-3 primary | jev-on-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 1 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 1 | 0 | 0 |

## Caveats

- jev-on-2: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

