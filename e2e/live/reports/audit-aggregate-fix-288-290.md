# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-28T12:02:33.774Z over fix-288-290-1, fix-288-290-2, fix-288-290-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 15 | 10 | 5 |
| 2 | answer omitted | 2 | 2 | 0 |
| 3 | stopped early | 1 | 0 | 1 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-288-290-1 | 2026-09-28T10:36:36.160Z | complete | c157d3b1 | no | 1 | c157d3b1 (dirty) |
| fix-288-290-2 | 2026-09-28T10:59:21.157Z | complete | c157d3b1 | no | 1 | c157d3b1 (dirty) |
| fix-288-290-3 | 2026-09-28T11:17:10.348Z | complete | c157d3b1 | no | 1 | c157d3b1 (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 211 | 197 | 194 | 0 | 120 (61%) → 129 | 52 (26%) → 43 | 1 (1%) | 20 (10%) | 4 (2%) | 14 (7%) |
| follow_up | 6 | 6 | 48 | 42 | 40 | 0 | 23 (55%) → 20 | 8 (19%) → 11 | 0 (0%) | 8 (19%) | 3 (7%) | 6 (13%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 10 | 1 | 5 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| answer omitted | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 2 | 0 | 1 |

- initial: 71 Off-key round(s), 38 Search Loop round(s) by the reviewer (35 by the streak rule, heads included: 22 at streak 2 or beyond, 8 at 3 or beyond; attempts by search source rail 11, replay 0, none 1; navigate searches by Search URL form q 53, param 1, path 6; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 1 Unavailable Landing(s) (1 by status, 0 by title), 1 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 3, 0 declined no_progress against the replay), 0 inherited, 4 rejected Evidence Checkpoint(s), 2 walled round(s), 9 navigate(s) landed on a Not-found Page (9 judged Off-key), 14 Composed Address(es) rewritten into a site search (11 judged Off-key, 0 to an address the Run was shown), 9 search(es) ran with an Unseen Phrase unquoted (8 judged Off-key), 3 search(es) ran on the Run Engine in place of another Web Engine (3 judged Off-key), 5 Result Pick(s) against 55 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (38 of 60 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 30 record_evidence call(s) by the model and 20 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 7 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 5 while running, 0 while finished and uncollected, 1 after collection, 0 read(s) refused as past the end, 16 bookkeeping round(s) right before the Answer, Answer Checkpoints: 7 offered in 10 Answer(s), 7 accepted, 0 dropped, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (0 after a first token, 2 silent); first-token latency p50 5025 ms, p90 7791 ms over 208 round(s), 12 declared Asked Items (3 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 2 answer omitted, 29 overrule(s), 67 flag(s); Finalization Causes: deadline_reached 3, model_answered 1, objective_met 8
- follow_up: 10 Off-key round(s), 2 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 3, replay 0, none 3; navigate searches by Search URL form q 6, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 5 inherited, 0 rejected Evidence Checkpoint(s), 2 walled round(s), 2 navigate(s) landed on a Not-found Page (2 judged Off-key), 3 Composed Address(es) rewritten into a site search (2 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 2 Result Pick(s) against 4 listing(s) returned to the model, a search’s result opened in 1.8 round(s) on average (6 of 6 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 13 record_evidence call(s) by the model and 8 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 4 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 1 read(s) refused as past the end, 4 bookkeeping round(s) right before the Answer, Answer Checkpoints: 3 offered in 6 Answer(s), 3 accepted, 0 dropped, 1 Malformed Answer(s) (2 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5410 ms, p90 7671 ms over 48 round(s), 6 declared Asked Items (0 with an unverified standing, 1 shape failure(s), 1 retried), 1 stopped early, 0 answer omitted, 3 overrule(s), 26 flag(s); Finalization Causes: objective_met 6

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 12 | 8 | 0 | 8 of 12 | 0 |
| initial: fix-288-290-1 | 4 | 3 | 0 | 3 of 4 | 0 |
| initial: fix-288-290-2 | 4 | 2 | 0 | 2 of 4 | 0 |
| initial: fix-288-290-3 | 4 | 3 | 0 | 3 of 4 | 0 |
| follow_up | 6 | 5 | 0 | 5 of 6 | 0 |
| follow_up: fix-288-290-1 | 2 | 1 | 0 | 1 of 2 | 0 |
| follow_up: fix-288-290-2 | 2 | 2 | 0 | 2 of 2 | 0 |
| follow_up: fix-288-290-3 | 2 | 2 | 0 | 2 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 112 (58%) | 20 (50%) |
| read_page | 45 (23%) | 9 (23%) |
| record_evidence | 23 (12%) | 10 (25%) |
| report_run_plan | 12 (6%) | 6 (15%) |
| scroll | 7 (4%) | 1 (3%) |
| record_candidate | 4 (2%) | 3 (8%) |
| click | 5 (3%) | 1 (3%) |
| look | 3 (2%) | 0 |
| type | 2 (1%) | 0 |
| agent_results | 1 (1%) | 0 |
| back | 0 | 1 (3%) |
| spawn_agent | 1 (1%) | 0 |

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
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 7 | 0 | 0 |
| historical-longitude-watch | 1 | 0 | 1 |
| rule-eurostar-luggage | 5 | 0 | 0 |
| superseded-voyager-interstellar | 4 | 9 | 2 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 2 (67%) | 1 | 0 (0%) |
| historical-longitude-watch (initial) | 3 | 0 | 3 | 2 (67%) | 3 | 2 (67%) |
| rule-eurostar-luggage (initial) | 3 | 0 | 3 | 1 (33%) | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | deadline_reached | 2 | 0 (0%) |
| compatibility-pi-camera (initial) | objective_met | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 3 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 2 | 0 (0%) |
| historical-longitude-watch (initial) | model_answered | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 3 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | objective_met | 2 | 0 (0%) |
| superseded-voyager-interstellar (initial) | deadline_reached | 1 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-288-290-1 | 4 | 4 | 71 | 66 | 65 | 0 | 47 (71%) → 49 | 12 (18%) → 10 | 0 (0%) | 6 (9%) | 1 (2%) | 5 (7%) |
| fix-288-290-2 | 4 | 4 | 72 | 67 | 65 | 0 | 37 (55%) → 43 | 20 (30%) → 14 | 0 (0%) | 7 (10%) | 3 (5%) | 5 (7%) |
| fix-288-290-3 | 4 | 4 | 68 | 64 | 64 | 0 | 36 (56%) → 37 | 20 (31%) → 19 | 1 (2%) | 7 (11%) | 0 (0%) | 4 (6%) |

| verdict | fix-288-290-1 primary | fix-288-290-1 secondary | fix-288-290-2 primary | fix-288-290-2 secondary | fix-288-290-3 primary | fix-288-290-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 3 | 1 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 1 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-288-290-1 | 2 | 2 | 12 | 10 | 9 | 0 | 6 (60%) | 2 (20%) | 0 (0%) | 1 (10%) | 1 (10%) | 2 (17%) |
| fix-288-290-2 | 2 | 2 | 21 | 19 | 19 | 0 | 10 (53%) → 8 | 4 (21%) → 6 | 0 (0%) | 4 (21%) | 1 (5%) | 2 (10%) |
| fix-288-290-3 | 2 | 2 | 15 | 13 | 12 | 0 | 7 (54%) → 6 | 2 (15%) → 3 | 0 (0%) | 3 (23%) | 1 (8%) | 2 (13%) |

| verdict | fix-288-290-1 primary | fix-288-290-1 secondary | fix-288-290-2 primary | fix-288-290-2 secondary | fix-288-290-3 primary | fix-288-290-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 1 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 0 |

