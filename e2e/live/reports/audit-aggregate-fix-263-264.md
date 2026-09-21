# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-21T17:47:44.777Z over fix-263-264-1, fix-263-264-2, fix-263-264-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 15 | 11 | 4 |
| 2 | answer omitted | 3 | 1 | 2 |
| 3 | budget too small for the Hunt | 0 | 0 | 0 |
| 4 | failed rounds | 0 | 0 | 0 |
| 5 | stopped early | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p3

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-263-264-1 | 2026-09-21T17:04:16.709Z | complete | e26f7f0d | no | 1 | 30968502 |
| fix-263-264-2 | 2026-09-21T17:17:47.254Z | complete | e26f7f0d | no | 1 | 30968502 |
| fix-263-264-3 | 2026-09-21T17:33:59.206Z | complete | e26f7f0d | no | 1 | 30968502 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 252 | 236 | 234 | 8 | 128 (54%) → 119 | 61 (26%) → 70 | 2 (1%) | 36 (15%) | 9 (4%) | 16 (6%) |
| follow_up | 6 | 6 | 77 | 70 | 70 | 1 | 32 (46%) → 29 | 18 (26%) → 21 | 1 (1%) | 17 (24%) | 2 (3%) | 7 (9%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 11 | 0 | 4 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 3 | 2 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 58 Off-key round(s), 43 Search Loop round(s) by the reviewer (43 by the streak rule, heads included: 30 at streak 2 or beyond, 16 at 3 or beyond; attempts by search source rail 12, replay 0, none 0; navigate searches by Search URL form q 53, param 1, path 2; 0 covered, 1 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 1 recovery round(s) over 1 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 0 inherited, 9 rejected Evidence Checkpoint(s), 2 walled round(s), 12 navigate(s) landed on a Not-found Page (5 judged Off-key), 12 Composed Address(es) rewritten into a site search (8 judged Off-key, 0 to an address the Run was shown), 39 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 9 bundled checkpoint round(s), 3 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 5 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (2 after a first token, 0 silent); first-token latency p50 2373 ms, p90 3644 ms over 252 round(s), 12 declared Asked Items (5 with an unverified standing, 2 shape failure(s), 1 retried), 0 stopped early, 4 answer omitted, 17 overrule(s), 47 flag(s); Finalization Causes: budget_exhausted 8, deadline_reached 1, objective_met 3
- follow_up: 30 Off-key round(s), 10 Search Loop round(s) by the reviewer (8 by the streak rule, heads included: 4 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 3, replay 0, none 3; navigate searches by Search URL form q 13, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 7 inherited, 6 rejected Evidence Checkpoint(s), 2 walled round(s), 3 navigate(s) landed on a Not-found Page (3 judged Off-key), 1 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2705 ms, p90 5190 ms over 77 round(s), 6 declared Asked Items (1 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 2 answer omitted, 5 overrule(s), 19 flag(s); Finalization Causes: budget_exhausted 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 105 (45%) | 26 (37%) |
| read_page | 42 (18%) | 14 (20%) |
| record_evidence | 43 (18%) | 12 (17%) |
| scroll | 22 (9%) | 4 (6%) |
| look | 16 (7%) | 3 (4%) |
| report_run_plan | 12 (5%) | 6 (9%) |
| record_candidate | 3 (1%) | 10 (14%) |
| click | 7 (3%) | 3 (4%) |
| spawn_agent | 3 (1%) | 1 (1%) |
| agent_results | 2 (1%) | 1 (1%) |
| type | 3 (1%) | 0 |
| back | 0 | 1 (1%) |
| ground_visual | 0 | 1 (1%) |

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
| superseded-voyager-interstellar | 0 | 1 | 0 | 0 | 1 | 1 | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-263-264-1 | 4 | 4 | 94 | 89 | 89 | 3 | 52 (58%) → 49 | 22 (25%) → 25 | 1 (1%) | 12 (14%) | 2 (2%) | 5 (5%) |
| fix-263-264-2 | 4 | 4 | 78 | 72 | 72 | 4 | 38 (53%) → 34 | 16 (22%) → 20 | 1 (1%) | 15 (21%) | 2 (3%) | 6 (8%) |
| fix-263-264-3 | 4 | 4 | 80 | 75 | 73 | 1 | 38 (51%) → 36 | 23 (31%) → 25 | 0 (0%) | 9 (12%) | 5 (7%) | 5 (6%) |

| verdict | fix-263-264-1 primary | fix-263-264-1 secondary | fix-263-264-2 primary | fix-263-264-2 secondary | fix-263-264-3 primary | fix-263-264-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 3 | 0 | 4 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 1 | 1 | 1 | 0 | 1 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-263-264-1 | 2 | 2 | 28 | 26 | 26 | 0 | 10 (39%) → 9 | 10 (39%) → 11 | 0 (0%) | 5 (19%) | 1 (4%) | 2 (7%) |
| fix-263-264-2 | 2 | 2 | 34 | 31 | 31 | 1 | 17 (55%) → 15 | 5 (16%) → 7 | 1 (3%) | 7 (23%) | 1 (3%) | 3 (9%) |
| fix-263-264-3 | 2 | 2 | 15 | 13 | 13 | 0 | 5 (39%) | 3 (23%) | 0 (0%) | 5 (39%) | 0 (0%) | 2 (13%) |

| verdict | fix-263-264-1 primary | fix-263-264-1 secondary | fix-263-264-2 primary | fix-263-264-2 secondary | fix-263-264-3 primary | fix-263-264-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 1 | 1 | 1 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

