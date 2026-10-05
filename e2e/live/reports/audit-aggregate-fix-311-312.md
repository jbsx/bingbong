# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-10-05T18:53:41.644Z over fix-311-312-1, fix-311-312-2, fix-311-312-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 16 | 11 | 5 |
| 2 | answer omitted | 2 | 1 | 1 |
| 3 | budget too small for the Hunt | 0 | 0 | 0 |
| 4 | failed rounds | 0 | 0 | 0 |
| 5 | stopped early | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p4

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-311-312-1 | 2026-10-05T17:42:09.400Z | complete | 2d2900e6 | no | 1 | 2d2900e6 (dirty) |
| fix-311-312-2 | 2026-10-05T18:02:07.451Z | complete | 2d2900e6 | no | 1 | 2d2900e6 (dirty) |
| fix-311-312-3 | 2026-10-05T18:20:31.029Z | complete | 2d2900e6 | no | 1 | 2d2900e6 (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 193 | 180 | 179 | 1 | 120 (67%) → 122 | 30 (17%) → 28 | 2 (1%) | 25 (14%) | 3 (2%) | 13 (7%) |
| follow_up | 6 | 6 | 59 | 54 | 54 | 0 | 25 (46%) → 21 | 19 (35%) → 23 | 1 (2%) | 9 (17%) | 0 (0%) | 5 (9%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 11 | 0 | 5 | 1 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 28 Off-key round(s), 8 Search Loop round(s) by the reviewer (8 by the streak rule, heads included: 4 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 10, replay 1, none 1; navigate searches by Search URL form q 25, param 2, path 3; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 6 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 1 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 1, 0 declined no_progress against the replay), 0 inherited, 5 rejected Evidence Checkpoint(s), 1 walled round(s), 8 navigate(s) landed on a Not-found Page (8 judged Off-key), 7 Composed Address(es) rewritten into a site search (4 judged Off-key, 0 to an address the Run was shown), 4 search(es) ran with an Unseen Phrase unquoted (4 judged Off-key), 2 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 13 Result Pick(s) against 21 listing(s) returned to the model, a search’s result opened in 1.9 round(s) on average (29 of 34 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 45 record_evidence call(s) by the model and 25 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 35 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 7 Held Page round(s) without Progress, 10 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 11 while running, 0 while finished and uncollected, 0 after collection, 1 read(s) refused as past the end, 0 landing(s) that carried no page, 12 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 8 offered in 11 Answer(s), 8 accepted, 0 dropped, 1 Malformed Answer(s) (1 retried), 0 Off-language Answer(s), 11 sentence(s) spoken early (0 second utterance(s), 0 stood for an Answer not its own), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4159 ms, p90 6093 ms over 193 round(s), 12 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 8 overrule(s), 54 flag(s); Finalization Causes: budget_exhausted 1, objective_met 11
- follow_up: 21 Off-key round(s), 7 Search Loop round(s) by the reviewer (7 by the streak rule, heads included: 4 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 3, replay 0, none 3; navigate searches by Search URL form q 8, param 1, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 0 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 9 inherited, 1 rejected Evidence Checkpoint(s), 4 walled round(s), 3 navigate(s) landed on a Not-found Page (3 judged Off-key), 1 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 1 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 0 Result Pick(s) against 6 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (4 of 6 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 13 record_evidence call(s) by the model and 9 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 11 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 1 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 3 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 0 landing(s) that carried no page, 6 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 6 offered in 5 Answer(s), 4 accepted, 2 dropped (malformed 1, unknown_source 1), 0 Malformed Answer(s) (0 retried), 0 Off-language Answer(s), 5 sentence(s) spoken early (0 second utterance(s), 0 stood for an Answer not its own), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4817 ms, p90 6418 ms over 59 round(s), 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 4 overrule(s), 24 flag(s); Finalization Causes: none 1, objective_met 5

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 12 | 11 | 0 | 11 of 12 | 0 |
| initial: fix-311-312-1 | 4 | 4 | 0 | 4 of 4 | 0 |
| initial: fix-311-312-2 | 4 | 4 | 0 | 4 of 4 | 0 |
| initial: fix-311-312-3 | 4 | 3 | 0 | 3 of 4 | 0 |
| follow_up | 6 | 5 | 0 | 5 of 6 | 0 |
| follow_up: fix-311-312-1 | 2 | 1 | 0 | 1 of 2 | 0 |
| follow_up: fix-311-312-2 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: fix-311-312-3 | 2 | 2 | 0 | 2 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 79 (44%) | 25 (46%) |
| read_page | 46 (26%) | 11 (20%) |
| record_evidence | 34 (19%) | 9 (17%) |
| scroll | 17 (9%) | 6 (11%) |
| report_run_plan | 13 (7%) | 6 (11%) |
| record_candidate | 3 (2%) | 4 (7%) |
| click | 3 (2%) | 1 (2%) |
| look | 4 (2%) | 0 |
| type | 4 (2%) | 0 |
| agent_results | 2 (1%) | 1 (2%) |
| spawn_agent | 2 (1%) | 1 (2%) |
| new_session | 0 | 1 (2%) |

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
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 4 | 0 | 1 |
| historical-longitude-watch | 0 | 0 | 0 |
| rule-eurostar-luggage | 1 | 0 | 1 |
| superseded-voyager-interstellar | 3 | 4 | 1 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 3 (100%) | 2 | 2 (100%) |
| historical-longitude-watch (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| rule-eurostar-luggage (initial) | 3 | 0 | 3 | 2 (67%) | 1 | 1 (100%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 3 | 0 (0%) |
| compatibility-pi-camera (follow-up) | none | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 2 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 3 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 3 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | budget_exhausted | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | objective_met | 2 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-311-312-1 | 4 | 4 | 58 | 53 | 53 | 1 | 40 (76%) | 6 (11%) | 1 (2%) | 5 (9%) | 1 (2%) | 5 (9%) |
| fix-311-312-2 | 4 | 4 | 66 | 62 | 61 | 0 | 40 (65%) → 38 | 11 (18%) → 13 | 0 (0%) | 9 (14%) | 2 (3%) | 4 (6%) |
| fix-311-312-3 | 4 | 4 | 69 | 65 | 65 | 0 | 40 (62%) → 44 | 13 (20%) → 9 | 1 (2%) | 11 (17%) | 0 (0%) | 4 (6%) |

| verdict | fix-311-312-1 primary | fix-311-312-1 secondary | fix-311-312-2 primary | fix-311-312-2 secondary | fix-311-312-3 primary | fix-311-312-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 4 | 0 | 3 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 1 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-311-312-1 | 2 | 2 | 21 | 20 | 20 | 0 | 13 (65%) → 10 | 5 (25%) → 8 | 0 (0%) | 2 (10%) | 0 (0%) | 1 (5%) |
| fix-311-312-2 | 2 | 2 | 23 | 21 | 21 | 0 | 6 (29%) | 7 (33%) | 1 (5%) | 7 (33%) | 0 (0%) | 2 (9%) |
| fix-311-312-3 | 2 | 2 | 15 | 13 | 13 | 0 | 6 (46%) → 5 | 7 (54%) → 8 | 0 (0%) | 0 (0%) | 0 (0%) | 2 (13%) |

| verdict | fix-311-312-1 primary | fix-311-312-1 secondary | fix-311-312-2 primary | fix-311-312-2 secondary | fix-311-312-3 primary | fix-311-312-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 1 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-311-312-3: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

