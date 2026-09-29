# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-29T12:15:03.624Z over main-4dc72e9-1, main-4dc72e9-2, main-4dc72e9-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 14 | 9 | 5 |
| 2 | answer omitted | 2 | 1 | 1 |
| 3 | tier too small or never escalated | 2 | 2 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | stopped early | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p4

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| main-4dc72e9-1 | 2026-09-29T10:55:29.409Z | complete | 4dc72e9d | no | 1 | 4dc72e9d (dirty) |
| main-4dc72e9-2 | 2026-09-29T11:17:58.098Z | complete | 4dc72e9d | no | 1 | 4dc72e9d (dirty) |
| main-4dc72e9-3 | 2026-09-29T11:39:57.863Z | complete | 4dc72e9d | no | 1 | 4dc72e9d (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 205 | 190 | 184 | 1 | 121 (64%) → 130 | 39 (21%) → 30 | 2 (1%) | 15 (8%) | 13 (7%) | 15 (7%) |
| follow_up | 6 | 6 | 38 | 32 | 31 | 0 | 15 (47%) → 16 | 10 (31%) → 9 | 0 (0%) | 6 (19%) | 1 (3%) | 6 (16%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 2 | 5 | 1 |
| tier too small or never escalated | 2 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 40 Off-key round(s), 18 Search Loop round(s) by the reviewer (20 by the streak rule, heads included: 11 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 10, replay 2, none 0; navigate searches by Search URL form q 42, param 1, path 6; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 5 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 1 Unfinished Load(s); 7 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 4, 0 declined no_progress against the replay), 0 inherited, 5 rejected Evidence Checkpoint(s), 2 walled round(s), 10 navigate(s) landed on a Not-found Page (10 judged Off-key), 10 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 5 search(es) ran with an Unseen Phrase unquoted (2 judged Off-key), 3 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 18 Result Pick(s) against 31 listing(s) returned to the model, a search’s result opened in 1.7 round(s) on average (36 of 49 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 30 record_evidence call(s) by the model and 15 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 9 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 2 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 7 while running, 0 while finished and uncollected, 0 after collection, 5 read(s) refused as past the end, 0 landing(s) that carried no page, 6 bookkeeping round(s) right before the Answer, 2 bookkeeping round(s) right before the cut, Answer Checkpoints: 21 offered in 12 Answer(s), 19 accepted, 2 dropped (malformed 2), 0 Malformed Answer(s) (3 retried), 0 Off-language Answer(s), 1 Transport Failure attempt(s) (1 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (1 after a first token, 1 silent); first-token latency p50 4611 ms, p90 7511 ms over 203 round(s), 12 declared Asked Items (1 with an unverified standing, 4 shape failure(s), 3 retried), 0 stopped early, 1 answer omitted, 17 overrule(s), 64 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 3, objective_met 8
- follow_up: 2 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 5; navigate searches by Search URL form q 1, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 0 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 1 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 8 inherited, 1 rejected Evidence Checkpoint(s), 1 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 1 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (1 of 1 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 10 record_evidence call(s) by the model and 6 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 0 landing(s) that carried no page, 5 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 10 offered in 6 Answer(s), 9 accepted, 1 dropped (user_text_unverified 1), 1 Malformed Answer(s) (1 retried), 0 Off-language Answer(s), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5605 ms, p90 7898 ms over 38 round(s), 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 3 overrule(s), 20 flag(s); Finalization Causes: objective_met 6

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 12 | 11 | 1 | 12 of 12 | 0 |
| initial: main-4dc72e9-1 | 4 | 3 | 1 | 4 of 4 | 0 |
| initial: main-4dc72e9-2 | 4 | 4 | 0 | 4 of 4 | 0 |
| initial: main-4dc72e9-3 | 4 | 4 | 0 | 4 of 4 | 0 |
| follow_up | 6 | 5 | 0 | 5 of 6 | 0 |
| follow_up: main-4dc72e9-1 | 2 | 1 | 0 | 1 of 2 | 0 |
| follow_up: main-4dc72e9-2 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: main-4dc72e9-3 | 2 | 2 | 0 | 2 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 90 (49%) | 14 (45%) |
| read_page | 50 (27%) | 11 (35%) |
| record_evidence | 22 (12%) | 7 (23%) |
| report_run_plan | 12 (7%) | 6 (19%) |
| scroll | 18 (10%) | 0 |
| record_candidate | 4 (2%) | 2 (6%) |
| look | 3 (2%) | 0 |
| type | 3 (2%) | 0 |
| agent_results | 2 (1%) | 0 |
| click | 2 (1%) | 0 |
| spawn_agent | 2 (1%) | 0 |
| back | 1 (1%) | 0 |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
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
| compatibility-pi-camera | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 4 | 1 | 0 |
| historical-longitude-watch | 1 | 0 | 1 |
| rule-eurostar-luggage | 3 | 0 | 1 |
| superseded-voyager-interstellar | 2 | 4 | 1 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 1 | 2 | 2 (100%) | 2 | 2 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 2 (67%) | 2 | 2 (100%) |
| historical-longitude-watch (initial) | 3 | 1 | 2 | 2 (100%) | 2 | 2 (100%) |
| rule-eurostar-luggage (initial) | 3 | 2 | 1 | 0 (0%) | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 2 | 1 | 1 (100%) | 1 | 1 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 2 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 3 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 2 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | deadline_reached | 1 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main-4dc72e9-1 | 4 | 4 | 72 | 67 | 65 | 1 | 43 (64%) → 49 | 14 (21%) → 8 | 0 (0%) | 6 (9%) | 4 (6%) | 5 (7%) |
| main-4dc72e9-2 | 4 | 4 | 76 | 71 | 69 | 0 | 46 (65%) → 49 | 15 (21%) → 12 | 1 (1%) | 3 (4%) | 6 (9%) | 5 (7%) |
| main-4dc72e9-3 | 4 | 4 | 57 | 52 | 50 | 0 | 32 (62%) | 10 (19%) | 1 (2%) | 6 (12%) | 3 (6%) | 5 (9%) |

| verdict | main-4dc72e9-1 primary | main-4dc72e9-1 secondary | main-4dc72e9-2 primary | main-4dc72e9-2 secondary | main-4dc72e9-3 primary | main-4dc72e9-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 1 | 4 | 0 | 3 | 1 |
| tier too small or never escalated | 1 | 0 | 0 | 0 | 1 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 1 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main-4dc72e9-1 | 2 | 2 | 14 | 12 | 12 | 0 | 7 (58%) → 6 | 2 (17%) → 3 | 0 (0%) | 3 (25%) | 0 (0%) | 2 (14%) |
| main-4dc72e9-2 | 2 | 2 | 11 | 9 | 8 | 0 | 3 (33%) → 4 | 4 (44%) → 3 | 0 (0%) | 1 (11%) | 1 (11%) | 2 (18%) |
| main-4dc72e9-3 | 2 | 2 | 13 | 11 | 11 | 0 | 5 (46%) → 6 | 4 (36%) → 3 | 0 (0%) | 2 (18%) | 0 (0%) | 2 (15%) |

| verdict | main-4dc72e9-1 primary | main-4dc72e9-1 secondary | main-4dc72e9-2 primary | main-4dc72e9-2 secondary | main-4dc72e9-3 primary | main-4dc72e9-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 1 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- main-4dc72e9-3: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

