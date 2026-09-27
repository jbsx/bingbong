# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-27T16:33:27.701Z over fix-281-1, fix-281-2, fix-281-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 12 | 8 | 4 |
| 2 | answer omitted | 5 | 3 | 2 |
| 3 | tier too small or never escalated | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | stopped early | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (every seam) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-281-1 | 2026-09-27T14:51:12.727Z | complete | 77a74319 | no | 1 | 976059cf |
| fix-281-2 | 2026-09-27T15:13:06.863Z | complete | 77a74319 | no | 1 | 976059cf |
| fix-281-3 | 2026-09-27T15:34:16.067Z | complete | 77a74319 | no | 1 | 976059cf |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 236 | 223 | 220 | 2 | 126 (56%) → 134 | 49 (22%) → 41 | 1 (0%) | 39 (18%) | 8 (4%) | 13 (6%) |
| follow_up | 6 | 6 | 63 | 58 | 58 | 0 | 26 (45%) → 24 | 13 (22%) → 15 | 0 (0%) | 19 (33%) | 0 (0%) | 5 (8%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 8 | 4 | 4 | 2 |
| tier too small or never escalated | 1 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 3 | 0 | 2 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 42 Off-key round(s), 23 Search Loop round(s) by the reviewer (22 by the streak rule, heads included: 14 at streak 2 or beyond, 6 at 3 or beyond; attempts by search source rail 10, replay 0, none 2; navigate searches by Search URL form q 29, param 0, path 10; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 4, 0 declined no_progress against the replay), 0 inherited, 9 rejected Evidence Checkpoint(s), 0 walled round(s), 8 navigate(s) landed on a Not-found Page (8 judged Off-key), 7 Composed Address(es) rewritten into a site search (5 judged Off-key, 0 to an address the Run was shown), 4 search(es) ran with an Unseen Phrase unquoted (3 judged Off-key), 4 search(es) ran on the Run Engine in place of another Web Engine (3 judged Off-key), 7 Result Pick(s) against 39 listing(s) returned to the model, a search’s result opened in 2.3 round(s) on average (31 of 46 searches), 21 Run-made Evidence Checkpoint(s) from a Selected Passage (21 recorded again by the model from the same page, 14 with the same passage) against 53 record_evidence call(s) by the model and 39 bookkeeping-only round(s), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 11 Held Page round(s) without Progress, 14 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 1 Answer(s) with an Identity Slip, 4 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 2 Malformed Answer(s) (1 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 3 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4360 ms, p90 7161 ms over 236 round(s), 12 declared Asked Items (4 with an unverified standing, 1 shape failure(s), 0 retried), 0 stopped early, 3 answer omitted, 22 overrule(s), 64 flag(s); Finalization Causes: budget_exhausted 2, deadline_reached 2, model_answered 1, objective_met 7
- follow_up: 10 Off-key round(s), 2 Search Loop round(s) by the reviewer (2 by the streak rule, heads included: 1 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 3, replay 0, none 3; navigate searches by Search URL form q 5, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 9 inherited, 3 rejected Evidence Checkpoint(s), 3 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 4 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (3 of 4 searches), 1 Run-made Evidence Checkpoint(s) from a Selected Passage (1 recorded again by the model from the same page, 1 with the same passage) against 20 record_evidence call(s) by the model and 19 bookkeeping-only round(s), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 6 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 1 Answer(s) with an Identity Slip, 1 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5093 ms, p90 8443 ms over 63 round(s), 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 2 answer omitted, 4 overrule(s), 23 flag(s); Finalization Causes: none 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 92 (42%) | 23 (40%) |
| read_page | 58 (26%) | 12 (21%) |
| record_evidence | 45 (20%) | 14 (24%) |
| record_candidate | 11 (5%) | 15 (26%) |
| scroll | 19 (9%) | 0 |
| report_run_plan | 12 (5%) | 6 (10%) |
| type | 9 (4%) | 1 (2%) |
| click | 1 (0%) | 2 (3%) |
| look | 2 (1%) | 0 |
| agent_results | 1 (0%) | 0 |
| new_session | 0 | 1 (2%) |
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
| compatibility-pi-camera | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 1 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 |
| rule-eurostar-luggage | 4 | 0 | 2 |
| superseded-voyager-interstellar | 2 | 4 | 2 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 3 | 2 | 1 | 1 (100%) | 1 | 1 (100%) |
| compatibility-pi-camera (follow-up) | 3 | 0 | 3 | 3 (100%) | 1 | 1 (100%) |
| historical-longitude-watch (initial) | 3 | 1 | 2 | 2 (100%) | 2 | 2 (100%) |
| rule-eurostar-luggage (initial) | 3 | 0 | 3 | 2 (67%) | 1 | 1 (100%) |
| rule-eurostar-luggage (follow-up) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |
| superseded-voyager-interstellar (initial) | 3 | 0 | 3 | 3 (100%) | 3 | 3 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 2 | 0 (0%) |
| compatibility-pi-camera (follow-up) | none | 1 | 0 (0%) |
| historical-longitude-watch (initial) | budget_exhausted | 1 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | model_answered | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 2 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 3 | 0 (0%) |
| superseded-voyager-interstellar (initial) | deadline_reached | 2 | 0 (0%) |
| superseded-voyager-interstellar (initial) | objective_met | 1 | 0 (0%) |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-281-1 | 4 | 4 | 74 | 69 | 67 | 1 | 45 (65%) → 46 | 11 (16%) → 10 | 0 (0%) | 10 (14%) | 3 (4%) | 5 (7%) |
| fix-281-2 | 4 | 4 | 84 | 80 | 79 | 1 | 43 (54%) → 44 | 16 (20%) → 15 | 0 (0%) | 17 (21%) | 4 (5%) | 4 (5%) |
| fix-281-3 | 4 | 4 | 78 | 74 | 74 | 0 | 38 (51%) → 44 | 22 (30%) → 16 | 1 (1%) | 12 (16%) | 1 (1%) | 4 (5%) |

| verdict | fix-281-1 primary | fix-281-1 secondary | fix-281-2 primary | fix-281-2 secondary | fix-281-3 primary | fix-281-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 1 | 3 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 1 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-281-1 | 2 | 2 | 15 | 13 | 13 | 0 | 6 (46%) | 4 (31%) | 0 (0%) | 3 (23%) | 0 (0%) | 2 (13%) |
| fix-281-2 | 2 | 2 | 26 | 25 | 25 | 0 | 11 (44%) → 10 | 6 (24%) → 7 | 0 (0%) | 8 (32%) | 0 (0%) | 1 (4%) |
| fix-281-3 | 2 | 2 | 22 | 20 | 20 | 0 | 9 (45%) → 8 | 3 (15%) → 4 | 0 (0%) | 8 (40%) | 0 (0%) | 2 (9%) |

| verdict | fix-281-1 primary | fix-281-1 secondary | fix-281-2 primary | fix-281-2 secondary | fix-281-3 primary | fix-281-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 1 | 1 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- fix-281-3: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

