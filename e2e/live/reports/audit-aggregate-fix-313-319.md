# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-10-05T21:20:33.961Z over fix-313-319-1, fix-313-319-2, fix-313-319-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 13 | 8 | 5 |
| 2 | answer omitted | 4 | 4 | 0 |
| 3 | stopped early | 1 | 0 | 1 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p4

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-313-319-1 | 2026-10-05T20:00:47.169Z | complete | 5e68eb03 | no | 1 | 5e68eb03 (dirty) |
| fix-313-319-2 | 2026-10-05T20:19:34.136Z | complete | 5e68eb03 | no | 1 | 5e68eb03 (dirty) |
| fix-313-319-3 | 2026-10-05T20:34:32.593Z | complete | 5e68eb03 | no | 1 | 5e68eb03 (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 217 | 201 | 200 | 4 | 140 (70%) → 157 | 45 (22%) → 28 | 0 (0%) | 14 (7%) | 2 (1%) | 16 (7%) |
| follow_up | 6 | 6 | 48 | 42 | 41 | 0 | 22 (52%) → 20 | 10 (24%) → 11 | 0 (0%) | 8 (19%) → 9 | 2 (5%) | 6 (13%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 8 | 4 | 5 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| answer omitted | 4 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 |

- initial: 50 Off-key round(s), 10 Search Loop round(s) by the reviewer (12 by the streak rule, heads included: 7 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 11, replay 1, none 0; navigate searches by Search URL form q 39, param 1, path 4; 2 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 4 recovery round(s) over 2 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 4 Empty Landing(s), 2 followed by a search, 0 read with text; 12 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 5, 0 declined no_progress against the replay), 0 inherited, 3 rejected Evidence Checkpoint(s), 1 walled round(s), 8 navigate(s) landed on a Not-found Page (8 judged Off-key), 13 Composed Address(es) rewritten into a site search (7 judged Off-key, 0 to an address the Run was shown), 5 search(es) ran with an Unseen Phrase unquoted (4 judged Off-key), 1 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 16 Result Pick(s) against 32 listing(s) returned to the model, a search’s result opened in 1.8 round(s) on average (39 of 48 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 36 record_evidence call(s) by the model and 14 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 9 Held Page round(s) without Progress, 11 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 0 landing(s) that carried no page, 4 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 19 offered in 12 Answer(s), 17 accepted, 2 dropped (excerpt_unsupported 1, malformed 1), 0 Malformed Answer(s) (0 retried), 0 Off-language Answer(s), 8 sentence(s) spoken early (0 second utterance(s), 1 stood for an Answer not its own), 7 Card(s) published early (0 Answer(s) out of field order, 0 Answer Tail(s) fell back), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 1 Finalization round(s) cut by the Allowance (1 after a first token, 0 silent); first-token latency p50 3234 ms, p90 5513 ms over 217 round(s), 12 declared Asked Items (1 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 4 answer omitted, 23 overrule(s), 61 flag(s); Finalization Causes: budget_exhausted 4, deadline_reached 1, objective_met 7
- follow_up: 6 Off-key round(s), 4 Search Loop round(s) by the reviewer (4 by the streak rule, heads included: 2 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 3, replay 0, none 3; navigate searches by Search URL form q 6, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 0 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 6 inherited, 0 rejected Evidence Checkpoint(s), 4 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 4 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (3 of 4 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 10 record_evidence call(s) by the model and 8 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 1 read(s) refused as past the end, 0 landing(s) that carried no page, 7 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 10 offered in 6 Answer(s), 10 accepted, 0 dropped, 1 Malformed Answer(s) (1 retried), 0 Off-language Answer(s), 6 sentence(s) spoken early (0 second utterance(s), 0 stood for an Answer not its own), 5 Card(s) published early (0 Answer(s) out of field order, 0 Answer Tail(s) fell back), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4849 ms, p90 6039 ms over 48 round(s), 5 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 1 stopped early, 0 answer omitted, 4 overrule(s), 19 flag(s); Finalization Causes: objective_met 6

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 12 | 7 | 1 | 8 of 12 | 0 |
| initial: fix-313-319-1 | 4 | 2 | 0 | 2 of 4 | 0 |
| initial: fix-313-319-2 | 4 | 3 | 0 | 3 of 4 | 0 |
| initial: fix-313-319-3 | 4 | 2 | 1 | 3 of 4 | 0 |
| follow_up | 6 | 5 | 0 | 5 of 6 | 0 |
| follow_up: fix-313-319-1 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: fix-313-319-2 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: fix-313-319-3 | 2 | 1 | 0 | 1 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 95 (48%) | 21 (51%) |
| read_page | 53 (27%) | 11 (27%) |
| record_evidence | 27 (14%) | 7 (17%) |
| report_run_plan | 12 (6%) | 6 (15%) |
| scroll | 17 (9%) | 0 |
| click | 10 (5%) | 0 |
| type | 7 (4%) | 1 (2%) |
| record_candidate | 0 | 6 (15%) |
| look | 4 (2%) | 0 |
| ask_user | 1 (1%) | 0 |

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
| rule-eurostar-luggage | 2 | 0 | 0 | 0 | 4 | 2 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Tier Escalations by hunt

Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.

| hunt | budget arm | deadline arm | Progress before | no Progress before | declined no_rail | declined no_tier_above | declined once_spent | declined hard_ceiling | declined no_progress | against the replay | not recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 5 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 1 |
| rule-eurostar-luggage | 5 | 0 | 0 |
| superseded-voyager-interstellar | 3 | 5 | 0 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| historical-longitude-watch (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| rule-eurostar-luggage (initial) | 3 | 0 | 3 | 2 (67%) | 2 | 2 (100%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 2 | 2 (100%) | 2 | 2 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | budget_exhausted | 2 | 0 (0%) |
| compatibility-pi-camera (initial) | objective_met | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 3 | 0 (0%) |
| historical-longitude-watch (initial) | budget_exhausted | 1 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 2 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 3 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | deadline_reached | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | objective_met | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | budget_exhausted | 1 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-313-319-1 | 4 | 4 | 82 | 75 | 74 | 2 | 56 (75%) → 62 | 16 (21%) → 10 | 0 (0%) | 2 (3%) | 1 (1%) | 7 (9%) |
| fix-313-319-2 | 4 | 4 | 57 | 53 | 53 | 0 | 33 (62%) → 38 | 12 (23%) → 7 | 0 (0%) | 7 (13%) | 1 (2%) | 4 (7%) |
| fix-313-319-3 | 4 | 4 | 78 | 73 | 73 | 2 | 51 (70%) → 57 | 17 (23%) → 11 | 0 (0%) | 5 (7%) | 0 (0%) | 5 (6%) |

| verdict | fix-313-319-1 primary | fix-313-319-1 secondary | fix-313-319-2 primary | fix-313-319-2 secondary | fix-313-319-3 primary | fix-313-319-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 3 | 1 | 2 | 2 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 2 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-313-319-1 | 2 | 2 | 14 | 12 | 11 | 0 | 5 (42%) → 4 | 3 (25%) | 0 (0%) | 3 (25%) → 4 | 1 (8%) | 2 (14%) |
| fix-313-319-2 | 2 | 2 | 19 | 17 | 17 | 0 | 10 (59%) | 5 (29%) | 0 (0%) | 1 (6%) | 1 (6%) | 2 (11%) |
| fix-313-319-3 | 2 | 2 | 15 | 13 | 13 | 0 | 7 (54%) → 6 | 2 (15%) → 3 | 0 (0%) | 4 (31%) | 0 (0%) | 2 (13%) |

| verdict | fix-313-319-1 primary | fix-313-319-1 secondary | fix-313-319-2 primary | fix-313-319-2 secondary | fix-313-319-3 primary | fix-313-319-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 1 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

