# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-27T20:55:20.113Z over fix-284-1, fix-284-2, fix-284-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 15 | 9 | 6 |
| 2 | answer omitted | 3 | 3 | 0 |
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
| fix-284-1 | 2026-09-27T18:30:10.281Z | complete | db7c00ac | no | 1 | 14f9f9c1 |
| fix-284-2 | 2026-09-27T18:51:26.865Z | complete | db7c00ac | no | 1 | 14f9f9c1 |
| fix-284-3 | 2026-09-27T19:09:59.900Z | complete | db7c00ac | no | 1 | 14f9f9c1 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 213 | 199 | 195 | 0 | 119 (60%) | 31 (16%) → 32 | 2 (1%) → 1 | 36 (18%) | 11 (6%) | 14 (7%) |
| follow_up | 6 | 6 | 69 | 62 | 62 | 1 | 30 (48%) → 29 | 14 (23%) → 15 | 0 (0%) | 17 (27%) | 1 (2%) | 7 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 1 | 6 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 3 | 0 | 0 | 1 |
| failed rounds | 0 | 2 | 0 | 0 |

- initial: 46 Off-key round(s), 18 Search Loop round(s) by the reviewer (24 by the streak rule, heads included: 15 at streak 2 or beyond, 5 at 3 or beyond; attempts by search source rail 12, replay 0, none 0; navigate searches by Search URL form q 49, param 1, path 1; 3 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 1 post-block vision round(s), 10 recovery round(s) over 3 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 1, 0 declined no_progress against the replay), 0 inherited, 8 rejected Evidence Checkpoint(s), 0 walled round(s), 9 navigate(s) landed on a Not-found Page (9 judged Off-key), 14 Composed Address(es) rewritten into a site search (11 judged Off-key, 0 to an address the Run was shown), 6 search(es) ran with an Unseen Phrase unquoted (3 judged Off-key), 3 search(es) ran on the Run Engine in place of another Web Engine (2 judged Off-key), 8 Result Pick(s) against 40 listing(s) returned to the model, a search’s result opened in 1.8 round(s) on average (36 of 48 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 46 record_evidence call(s) by the model and 36 bookkeeping-only round(s), 0 accepted record(s) answered with the contradiction Note, 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 13 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 1 after collection, 0 Malformed Answer(s) (2 retried), 2 Transport Failure attempt(s) (2 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (1 after a first token, 1 silent); first-token latency p50 5023 ms, p90 9344 ms over 211 round(s), 12 declared Asked Items (0 with an unverified standing, 2 shape failure(s), 2 retried), 0 stopped early, 3 answer omitted, 11 overrule(s), 69 flag(s); Finalization Causes: deadline_reached 2, no_progress 1, objective_met 9
- follow_up: 18 Off-key round(s), 4 Search Loop round(s) by the reviewer (4 by the streak rule, heads included: 2 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 2, replay 0, none 4; navigate searches by Search URL form q 4, param 1, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 1, 0 declined no_progress against the replay), 6 inherited, 3 rejected Evidence Checkpoint(s), 1 walled round(s), 3 navigate(s) landed on a Not-found Page (3 judged Off-key), 2 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 4 listing(s) returned to the model, a search’s result opened in 2.3 round(s) on average (3 of 4 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 15 record_evidence call(s) by the model and 17 bookkeeping-only round(s), 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 6068 ms, p90 9001 ms over 69 round(s), 6 declared Asked Items (1 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 3 overrule(s), 23 flag(s); Finalization Causes: budget_exhausted 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 104 (53%) | 18 (29%) |
| read_page | 36 (18%) | 14 (23%) |
| record_evidence | 39 (20%) | 10 (16%) |
| record_candidate | 13 (7%) | 12 (19%) |
| report_run_plan | 12 (6%) | 6 (10%) |
| scroll | 4 (2%) | 8 (13%) |
| click | 4 (2%) | 4 (6%) |
| look | 6 (3%) | 0 |
| type | 3 (2%) | 0 |
| agent_results | 2 (1%) | 0 |
| back | 0 | 1 (2%) |
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
| rule-eurostar-luggage | 3 | 0 | 0 | 1 | 10 | 3 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Tier Escalations by hunt

Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.

| hunt | budget arm | deadline arm | Progress before | no Progress before | declined no_rail | declined no_tier_above | declined once_spent | declined hard_ceiling | declined no_progress | against the replay | not recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 8 | 0 | 0 |
| historical-longitude-watch | 0 | 1 | 1 |
| rule-eurostar-luggage | 6 | 0 | 0 |
| superseded-voyager-interstellar | 2 | 5 | 2 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 2 | 1 | 1 (100%) | 1 | 1 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 2 (67%) | 1 | 1 (100%) |
| historical-longitude-watch (initial) | 3 | 2 | 1 | 1 (100%) | 1 | 1 (100%) |
| rule-eurostar-luggage (initial) | 3 | 2 | 1 | 1 (100%) | 0 | 0 (n/a) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 3 | 0 | 0 (n/a) | 0 | 0 (n/a) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 2 | 0 (0%) |
| compatibility-pi-camera (follow-up) | budget_exhausted | 1 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | no_progress | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-284-1 | 4 | 4 | 63 | 58 | 57 | 0 | 39 (67%) → 37 | 5 (9%) → 8 | 1 (2%) → 0 | 9 (16%) | 4 (7%) | 5 (8%) |
| fix-284-2 | 4 | 4 | 77 | 73 | 70 | 0 | 42 (57%) → 43 | 10 (14%) → 9 | 1 (1%) | 17 (23%) | 3 (4%) | 4 (5%) |
| fix-284-3 | 4 | 4 | 73 | 68 | 68 | 0 | 38 (56%) → 39 | 16 (24%) → 15 | 0 (0%) | 10 (15%) | 4 (6%) | 5 (7%) |

| verdict | fix-284-1 primary | fix-284-1 secondary | fix-284-2 primary | fix-284-2 secondary | fix-284-3 primary | fix-284-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 3 | 0 | 3 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 2 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-284-1 | 2 | 2 | 24 | 22 | 22 | 0 | 9 (41%) → 10 | 6 (27%) → 5 | 0 (0%) | 7 (32%) | 0 (0%) | 2 (8%) |
| fix-284-2 | 2 | 2 | 15 | 13 | 13 | 0 | 2 (15%) | 2 (15%) | 0 (0%) | 9 (69%) | 0 (0%) | 2 (13%) |
| fix-284-3 | 2 | 2 | 30 | 27 | 27 | 1 | 19 (70%) → 17 | 6 (22%) → 8 | 0 (0%) | 1 (4%) | 1 (4%) | 3 (10%) |

| verdict | fix-284-1 primary | fix-284-1 secondary | fix-284-2 primary | fix-284-2 secondary | fix-284-3 primary | fix-284-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 1 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-284-1: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

