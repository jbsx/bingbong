# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-28T18:33:35.664Z over fix-291-1, fix-291-2, fix-291-4, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 12 | 8 | 4 |
| 2 | answer omitted | 5 | 3 | 2 |
| 3 | failed rounds | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
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
| fix-291-1 | 2026-09-28T14:40:25.963Z | complete | 50db134e | no | 1 | 50db134e (dirty) |
| fix-291-2 | 2026-09-28T15:03:26.445Z | complete | 50db134e | no | 1 | 50db134e (dirty) |
| fix-291-4 | 2026-09-28T17:46:34.098Z | complete | 50db134e | no | 1 | 50db134e (dirty) |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 202 | 187 | 183 | 3 | 128 (68%) | 36 (19%) | 0 (0%) | 13 (7%) | 10 (5%) | 15 (7%) |
| follow_up | 6 | 6 | 50 | 44 | 41 | 0 | 23 (52%) → 20 | 15 (34%) → 18 | 0 (0%) | 2 (5%) | 4 (9%) | 6 (12%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 8 | 1 | 4 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 3 | 3 | 2 | 0 |
| failed rounds | 1 | 0 | 0 | 0 |

- initial: 47 Off-key round(s), 22 Search Loop round(s) by the reviewer (21 by the streak rule, heads included: 14 at streak 2 or beyond, 7 at 3 or beyond; attempts by search source rail 12, replay 0, none 0; navigate searches by Search URL form q 38, param 0, path 12; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 3 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 3, none before 1), declined no_tier_above 4, 0 declined no_progress against the replay), 0 inherited, 6 rejected Evidence Checkpoint(s), 0 walled round(s), 10 navigate(s) landed on a Not-found Page (10 judged Off-key), 12 Composed Address(es) rewritten into a site search (7 judged Off-key, 0 to an address the Run was shown), 8 search(es) ran with an Unseen Phrase unquoted (6 judged Off-key), 1 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 11 Result Pick(s) against 41 listing(s) returned to the model, a search’s result opened in 2.1 round(s) on average (39 of 52 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 30 record_evidence call(s) by the model and 13 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 9 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 1 read(s) refused as past the end, 8 bookkeeping round(s) right before the Answer, Answer Checkpoints: 20 offered in 11 Answer(s), 9 accepted, 11 dropped (malformed 6, over_cap 1, unknown_source 4), 2 Malformed Answer(s) (3 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4952 ms, p90 6950 ms over 202 round(s), 12 declared Asked Items (5 with an unverified standing, 3 shape failure(s), 1 retried), 0 stopped early, 6 answer omitted, 16 overrule(s), 69 flag(s); Finalization Causes: budget_exhausted 2, deadline_reached 2, objective_met 8
- follow_up: 7 Off-key round(s), 6 Search Loop round(s) by the reviewer (6 by the streak rule, heads included: 3 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 2, replay 0, none 4; navigate searches by Search URL form q 4, param 2, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 1), declined none, 0 declined no_progress against the replay), 7 inherited, 0 rejected Evidence Checkpoint(s), 2 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 1 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 1 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 4 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (3 of 4 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 7 record_evidence call(s) by the model and 2 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 1 read(s) refused as past the end, 1 bookkeeping round(s) right before the Answer, Answer Checkpoints: 12 offered in 6 Answer(s), 10 accepted, 2 dropped (malformed 1, unknown_source 1), 2 Malformed Answer(s) (3 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5380 ms, p90 8297 ms over 50 round(s), 6 declared Asked Items (1 with an unverified standing, 2 shape failure(s), 1 retried), 0 stopped early, 2 answer omitted, 5 overrule(s), 22 flag(s); Finalization Causes: objective_met 6

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 93 (51%) | 20 (49%) |
| read_page | 41 (22%) | 15 (37%) |
| record_evidence | 20 (11%) | 5 (12%) |
| report_run_plan | 13 (7%) | 6 (15%) |
| scroll | 14 (8%) | 2 (5%) |
| click | 11 (6%) | 2 (5%) |
| look | 5 (3%) | 0 |
| type | 5 (3%) | 0 |
| record_candidate | 3 (2%) | 0 |
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
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Tier Escalations by hunt

Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.

| hunt | budget arm | deadline arm | Progress before | no Progress before | declined no_rail | declined no_tier_above | declined once_spent | declined hard_ceiling | declined no_progress | against the replay | not recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 1 | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 2 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 4 | 2 | 1 |
| historical-longitude-watch | 1 | 0 | 0 |
| rule-eurostar-luggage | 2 | 0 | 0 |
| superseded-voyager-interstellar | 6 | 6 | 1 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 0 | 3 | 0 (0%) | 3 | 0 (0%) |
| compatibility-pi-camera (follow-up) | 3 | 2 | 1 | 1 (100%) | 0 | 0 (n/a) |
| historical-longitude-watch (initial) | 3 | 2 | 1 | 0 (0%) | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | 3 | 0 | 3 | 2 (67%) | 3 | 2 (67%) |
| rule-eurostar-luggage (follow-up) | 3 | 1 | 2 | 2 (100%) | 2 | 2 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 3 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 1 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 3 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 2 | 0 (0%) |
| superseded-voyager-interstellar (initial) | deadline_reached | 2 | 0 (0%) |
| superseded-voyager-interstellar (initial) | budget_exhausted | 1 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-291-1 | 4 | 4 | 58 | 53 | 52 | 0 | 33 (62%) | 11 (21%) | 0 (0%) | 8 (15%) | 1 (2%) | 5 (9%) |
| fix-291-2 | 4 | 4 | 71 | 66 | 64 | 1 | 46 (70%) | 10 (15%) | 0 (0%) | 3 (5%) | 7 (11%) | 5 (7%) |
| fix-291-4 | 4 | 4 | 73 | 68 | 67 | 2 | 49 (72%) | 15 (22%) | 0 (0%) | 2 (3%) | 2 (3%) | 5 (7%) |

| verdict | fix-291-1 primary | fix-291-1 secondary | fix-291-2 primary | fix-291-2 secondary | fix-291-4 primary | fix-291-4 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 1 | 2 | 0 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 1 | 1 | 1 | 0 | 1 |
| failed rounds | 0 | 0 | 1 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-291-1 | 2 | 2 | 18 | 16 | 15 | 0 | 9 (56%) → 7 | 6 (38%) → 8 | 0 (0%) | 0 (0%) | 1 (6%) | 2 (11%) |
| fix-291-2 | 2 | 2 | 22 | 20 | 19 | 0 | 12 (60%) → 10 | 6 (30%) → 8 | 0 (0%) | 0 (0%) | 2 (10%) | 2 (9%) |
| fix-291-4 | 2 | 2 | 10 | 8 | 7 | 0 | 2 (25%) → 3 | 3 (38%) → 2 | 0 (0%) | 2 (25%) | 1 (13%) | 2 (20%) |

| verdict | fix-291-1 primary | fix-291-1 secondary | fix-291-2 primary | fix-291-2 secondary | fix-291-4 primary | fix-291-4 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 0 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

