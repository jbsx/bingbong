# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-30T21:24:36.488Z over flash-orch-1, flash-orch-2, flash-orch-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 12 | 7 | 5 |
| 2 | answer omitted | 5 | 4 | 1 |
| 3 | tier too small or never escalated | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | stopped early | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3-flash; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p4

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | 2026-09-30T19:32:39.437Z | complete | f16dbd23 | no | 1 | f16dbd23 (dirty) |
| flash-orch-2 | 2026-09-30T20:09:51.125Z | complete | f16dbd23 | no | 1 | f16dbd23 (dirty) |
| flash-orch-3 | 2026-09-30T20:43:40.455Z | complete | f16dbd23 | no | 1 | f16dbd23 (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 232 | 213 | 203 | 1 | 129 (61%) → 141 | 46 (22%) → 34 | 0 (0%) | 22 (10%) | 16 (8%) | 19 (8%) |
| follow_up | 6 | 6 | 80 | 71 | 65 | 0 | 34 (48%) → 31 | 21 (30%) → 24 | 0 (0%) | 7 (10%) | 9 (13%) | 9 (11%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 7 | 4 | 5 | 1 |
| tier too small or never escalated | 1 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 4 | 1 | 1 | 0 |
| failed rounds | 0 | 3 | 0 | 2 |

- initial: 44 Off-key round(s), 16 Search Loop round(s) by the reviewer (17 by the streak rule, heads included: 12 at streak 2 or beyond, 7 at 3 or beyond; attempts by search source rail 10, replay 1, none 1; navigate searches by Search URL form q 29, param 1, path 5; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 4 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 2, none before 0), declined no_tier_above 11, 0 declined no_progress against the replay), 0 inherited, 9 rejected Evidence Checkpoint(s), 0 walled round(s), 10 navigate(s) landed on a Not-found Page (10 judged Off-key), 9 Composed Address(es) rewritten into a site search (7 judged Off-key, 0 to an address the Run was shown), 8 search(es) ran with an Unseen Phrase unquoted (6 judged Off-key), 1 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 13 Result Pick(s) against 27 listing(s) returned to the model, a search’s result opened in 1.7 round(s) on average (26 of 40 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 36 record_evidence call(s) by the model and 22 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 5 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 6 Held Page round(s) without Progress, 11 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 1 read(s) refused as past the end, 0 landing(s) that carried no page, 6 bookkeeping round(s) right before the Answer, 4 bookkeeping round(s) right before the cut, Answer Checkpoints: 11 offered in 10 Answer(s), 9 accepted, 2 dropped (invalid_transition 2), 0 Malformed Answer(s) (1 retried), 0 Off-language Answer(s), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 5 skipped bookkeeping round(s), 6 Finalization round(s) cut by the Allowance (2 after a first token, 4 silent); first-token latency p50 5630 ms, p90 8572 ms over 224 round(s), 12 declared Asked Items (11 with an unverified standing, 10 shape failure(s), 1 retried), 0 stopped early, 5 answer omitted, 22 overrule(s), 64 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 10, objective_met 1
- follow_up: 16 Off-key round(s), 5 Search Loop round(s) by the reviewer (5 by the streak rule, heads included: 3 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 3, replay 0, none 3; navigate searches by Search URL form q 11, param 1, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 1 inert click(s), 1 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 1 Empty Landing(s), 1 followed by a search, 0 read with text; 1 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 3 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 3, 0 declined no_progress against the replay), 9 inherited, 3 rejected Evidence Checkpoint(s), 3 walled round(s), 4 navigate(s) landed on a Not-found Page (4 judged Off-key), 2 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 1 search(es) ran with an Unseen Phrase unquoted (1 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 2 Result Pick(s) against 6 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (5 of 8 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 12 record_evidence call(s) by the model and 7 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 1 Answer(s) with an Identity Slip, 1 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 1 read(s) refused as past the end, 0 landing(s) that carried no page, 0 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 4 offered in 6 Answer(s), 4 accepted, 0 dropped, 0 Malformed Answer(s) (3 retried), 0 Off-language Answer(s), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 1 Finalization round(s) cut by the Allowance (1 after a first token, 0 silent); first-token latency p50 6132 ms, p90 7960 ms over 79 round(s), 6 declared Asked Items (3 with an unverified standing, 6 shape failure(s), 3 retried), 0 stopped early, 1 answer omitted, 5 overrule(s), 31 flag(s); Finalization Causes: deadline_reached 3, objective_met 3

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 12 | 6 | 1 | 7 of 12 | 0 |
| initial: flash-orch-1 | 4 | 1 | 1 | 2 of 4 | 0 |
| initial: flash-orch-2 | 4 | 2 | 0 | 2 of 4 | 0 |
| initial: flash-orch-3 | 4 | 3 | 0 | 3 of 4 | 0 |
| follow_up | 6 | 3 | 0 | 3 of 6 | 0 |
| follow_up: flash-orch-1 | 2 | 1 | 0 | 1 of 2 | 0 |
| follow_up: flash-orch-2 | 2 | 1 | 0 | 1 of 2 | 0 |
| follow_up: flash-orch-3 | 2 | 1 | 0 | 1 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 83 (41%) | 32 (49%) |
| read_page | 55 (27%) | 13 (20%) |
| record_evidence | 27 (13%) | 6 (9%) |
| scroll | 26 (13%) | 5 (8%) |
| report_run_plan | 14 (7%) | 6 (9%) |
| record_candidate | 7 (3%) | 3 (5%) |
| type | 9 (4%) | 0 |
| click | 5 (2%) | 3 (5%) |
| look | 2 (1%) | 3 (5%) |
| ground_visual | 0 | 2 (3%) |
| ask_user | 1 (0%) | 0 |
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
| compatibility-pi-camera | 0 | 2 | 1 | 0 | 0 | 6 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 3 | 1 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 5 | 1 | 0 |
| historical-longitude-watch | 0 | 1 | 1 |
| rule-eurostar-luggage | 3 | 0 | 0 |
| superseded-voyager-interstellar | 3 | 7 | 0 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 0 | 3 | 1 (33%) | 3 | 1 (33%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 2 (67%) | 2 | 1 (50%) |
| historical-longitude-watch (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| rule-eurostar-luggage (initial) | 3 | 1 | 2 | 1 (50%) | 2 | 1 (50%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | deadline_reached | 3 | 0 (0%) |
| compatibility-pi-camera (follow-up) | deadline_reached | 3 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 1 | 0 (0%) |
| historical-longitude-watch (initial) | deadline_reached | 2 | 0 (0%) |
| rule-eurostar-luggage (initial) | deadline_reached | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | budget_exhausted | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | deadline_reached | 3 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | 4 | 4 | 63 | 57 | 53 | 0 | 32 (56%) → 36 | 13 (23%) → 9 | 0 (0%) | 8 (14%) | 4 (7%) | 6 (10%) |
| flash-orch-2 | 4 | 4 | 81 | 74 | 70 | 0 | 45 (61%) → 48 | 15 (20%) → 12 | 0 (0%) | 6 (8%) | 8 (11%) | 7 (9%) |
| flash-orch-3 | 4 | 4 | 88 | 82 | 80 | 1 | 52 (63%) → 57 | 18 (22%) → 13 | 0 (0%) | 8 (10%) | 4 (5%) | 6 (7%) |

| verdict | flash-orch-1 primary | flash-orch-1 secondary | flash-orch-2 primary | flash-orch-2 secondary | flash-orch-3 primary | flash-orch-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 2 | 3 | 0 | 2 | 2 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 1 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 1 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 3 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| flash-orch-1 | 2 | 2 | 27 | 24 | 22 | 0 | 14 (58%) → 13 | 5 (21%) → 6 | 0 (0%) | 2 (8%) | 3 (13%) | 3 (11%) |
| flash-orch-2 | 2 | 2 | 31 | 28 | 26 | 0 | 12 (43%) → 11 | 11 (39%) → 12 | 0 (0%) | 2 (7%) | 3 (11%) | 3 (10%) |
| flash-orch-3 | 2 | 2 | 22 | 19 | 17 | 0 | 8 (42%) → 7 | 5 (26%) → 6 | 0 (0%) | 3 (16%) | 3 (16%) | 3 (14%) |

| verdict | flash-orch-1 primary | flash-orch-1 secondary | flash-orch-2 primary | flash-orch-2 secondary | flash-orch-3 primary | flash-orch-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 1 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 1 |

## Caveats

- flash-orch-1: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text
- flash-orch-2: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text
- flash-orch-3: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

