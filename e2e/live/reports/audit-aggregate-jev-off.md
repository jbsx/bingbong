# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-28T03:10:00.000Z over jev-off-1, jev-off-2, jev-off-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 15 | 9 | 6 |
| 2 | answer omitted | 2 | 2 | 0 |
| 3 | stopped early | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: decision=unconfigured (not configured in the production env); orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| jev-off-1 | 2026-09-27T03:50:35.741Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-off-2 | 2026-09-27T04:30:12.583Z | complete | fda11fe4 | no | 1 | 03c966ef |
| jev-off-3 | 2026-09-27T05:05:35.175Z | complete | fda11fe4 | no | 1 | 03c966ef |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 246 | 231 | 226 | 2 | 142 (62%) → 146 | 46 (20%) → 42 | 1 (0%) | 32 (14%) | 10 (4%) | 15 (6%) |
| follow_up | 6 | 6 | 51 | 45 | 45 | 0 | 14 (31%) → 16 | 11 (24%) → 8 | 1 (2%) | 19 (42%) → 20 | 0 (0%) | 6 (12%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 9 | 3 | 6 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 |

- initial: 49 Off-key round(s), 30 Search Loop round(s) by the reviewer (30 by the streak rule, heads included: 19 at streak 2 or beyond, 7 at 3 or beyond; attempts by search source rail 12, replay 0, none 0; navigate searches by Search URL form q 45, param 0, path 7; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 8 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 5, 0 declined no_progress against the replay), 0 inherited, 8 rejected Evidence Checkpoint(s), 1 walled round(s), 10 navigate(s) landed on a Not-found Page (10 judged Off-key), 13 Composed Address(es) rewritten into a site search (10 judged Off-key, 0 to an address the Run was shown), 7 search(es) ran with an Unseen Phrase unquoted (6 judged Off-key), 2 search(es) ran on the Run Engine in place of another Web Engine (2 judged Off-key), 0 Result Pick(s) against 56 listing(s) returned to the model, a search’s result opened in 2.5 round(s) on average (36 of 56 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 46 record_evidence call(s) by the model and 32 bookkeeping-only round(s), Run-made checkpoints contained or cited not counted, 7 accepted record(s) answered with the contradiction Note, 24 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 12 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 1 while running, 0 while finished and uncollected, 0 after collection, 1 Malformed Answer(s) (2 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 2 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (0 after a first token, 2 silent); first-token latency p50 2800 ms, p90 5516 ms over 243 round(s), 12 declared Asked Items (1 with an unverified standing, 1 shape failure(s), 1 retried), 1 stopped early, 2 answer omitted, 20 overrule(s), 69 flag(s); Finalization Causes: budget_exhausted 2, deadline_reached 3, model_answered 1, objective_met 6
- follow_up: 3 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 5; navigate searches by Search URL form q 2, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 1 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 8 inherited, 4 rejected Evidence Checkpoint(s), 1 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 1 search(es) ran with an Unseen Phrase unquoted (1 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 2 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (2 of 2 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 17 record_evidence call(s) by the model and 19 bookkeeping-only round(s), Run-made checkpoints contained or cited not counted, 8 accepted record(s) answered with the contradiction Note, 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 5 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 1 while running, 0 while finished and uncollected, 0 after collection, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4491 ms, p90 8213 ms over 51 round(s), 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 0 answer omitted, 5 overrule(s), 22 flag(s); Finalization Causes: objective_met 6

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 118 (52%) | 14 (31%) |
| read_page | 53 (23%) | 11 (24%) |
| record_evidence | 31 (14%) | 15 (33%) |
| record_candidate | 15 (7%) | 12 (27%) |
| report_run_plan | 12 (5%) | 6 (13%) |
| scroll | 16 (7%) | 0 |
| type | 4 (2%) | 0 |
| agent_results | 1 (0%) | 1 (2%) |
| look | 2 (1%) | 0 |
| spawn_agent | 1 (0%) | 1 (2%) |
| back | 1 (0%) | 0 |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 3 | 0 | 0 |
| rule-eurostar-luggage | 3 | 0 | 0 |
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
| compatibility-pi-camera | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 5 | 1 | 0 |
| historical-longitude-watch | 0 | 0 | 0 |
| rule-eurostar-luggage | 1 | 1 | 1 |
| superseded-voyager-interstellar | 7 | 6 | 1 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-off-1 | 4 | 4 | 89 | 84 | 82 | 0 | 49 (58%) → 53 | 18 (21%) → 14 | 0 (0%) | 13 (16%) | 4 (5%) | 5 (6%) |
| jev-off-2 | 4 | 4 | 71 | 66 | 64 | 0 | 42 (64%) → 41 | 13 (20%) → 14 | 1 (2%) | 7 (11%) | 3 (5%) | 5 (7%) |
| jev-off-3 | 4 | 4 | 86 | 81 | 80 | 2 | 51 (63%) → 52 | 15 (19%) → 14 | 0 (0%) | 12 (15%) | 3 (4%) | 5 (6%) |

| verdict | jev-off-1 primary | jev-off-1 secondary | jev-off-2 primary | jev-off-2 secondary | jev-off-3 primary | jev-off-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 2 | 3 | 1 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| jev-off-1 | 2 | 2 | 19 | 17 | 17 | 0 | 2 (12%) → 4 | 6 (35%) → 3 | 0 (0%) | 9 (53%) → 10 | 0 (0%) | 2 (11%) |
| jev-off-2 | 2 | 2 | 19 | 17 | 17 | 0 | 10 (59%) → 9 | 1 (6%) → 2 | 1 (6%) | 5 (29%) | 0 (0%) | 2 (11%) |
| jev-off-3 | 2 | 2 | 13 | 11 | 11 | 0 | 2 (18%) → 3 | 4 (36%) → 3 | 0 (0%) | 5 (46%) | 0 (0%) | 2 (15%) |

| verdict | jev-off-1 primary | jev-off-1 secondary | jev-off-2 primary | jev-off-2 secondary | jev-off-3 primary | jev-off-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

