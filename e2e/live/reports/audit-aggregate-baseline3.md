# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-21T23:29:39.564Z over baseline3-1, baseline3-2, baseline3-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 12 | 7 | 5 |
| 2 | answer omitted | 5 | 4 | 1 |
| 3 | failed rounds | 1 | 1 | 0 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
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
| baseline3-1 | 2026-09-21T22:43:12.488Z | complete | 4096bddb | no | 1 | 61a553d8 |
| baseline3-2 | 2026-09-21T22:58:11.646Z | complete | 4096bddb | no | 1 | 61a553d8 |
| baseline3-3 | 2026-09-21T23:15:05.370Z | complete | 4096bddb | no | 1 | 61a553d8 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 239 | 223 | 220 | 7 | 129 (58%) → 130 | 54 (24%) → 53 | 1 (0%) | 24 (11%) | 15 (7%) | 16 (7%) |
| follow_up | 6 | 6 | 49 | 43 | 42 | 1 | 8 (19%) → 11 | 15 (35%) → 12 | 0 (0%) | 17 (40%) | 3 (7%) | 6 (12%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 7 | 1 | 5 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 4 | 0 | 1 | 0 |
| failed rounds | 1 | 1 | 0 | 0 |

- initial: 72 Off-key round(s), 38 Search Loop round(s) by the reviewer (31 by the streak rule, heads included: 21 at streak 2 or beyond, 10 at 3 or beyond; attempts by search source rail 11, replay 0, none 1; navigate searches by Search URL form q 45, param 1, path 5; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 6 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 0 inherited, 6 rejected Evidence Checkpoint(s), 1 walled round(s), 10 navigate(s) landed on a Not-found Page (5 judged Off-key), 14 Composed Address(es) rewritten into a site search (11 judged Off-key, 0 to an address the Run was shown), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 11 Held Page round(s) without Progress, 11 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 3 skipped bookkeeping round(s), 1 Finalization round(s) cut by the Allowance (1 after a first token, 0 silent); first-token latency p50 3890 ms, p90 5449 ms over 238 round(s), 11 declared Asked Items (5 with an unverified standing, 4 shape failure(s), 1 retried), 0 stopped early, 5 answer omitted, 21 overrule(s), 46 flag(s); Finalization Causes: budget_exhausted 7, deadline_reached 1, none 1, objective_met 3
- follow_up: 2 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 5; navigate searches by Search URL form q 1, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 9 inherited, 1 rejected Evidence Checkpoint(s), 0 walled round(s), 2 navigate(s) landed on a Not-found Page (2 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 4 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4817 ms, p90 5553 ms over 49 round(s), 6 declared Asked Items (0 with an unverified standing, 1 shape failure(s), 1 retried), 0 stopped early, 1 answer omitted, 3 overrule(s), 17 flag(s); Finalization Causes: budget_exhausted 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 102 (46%) | 12 (29%) |
| read_page | 52 (24%) | 13 (31%) |
| record_evidence | 29 (13%) | 14 (33%) |
| scroll | 22 (10%) | 0 |
| record_candidate | 8 (4%) | 11 (26%) |
| report_run_plan | 11 (5%) | 6 (14%) |
| look | 13 (6%) | 0 |
| click | 4 (2%) | 0 |
| agent_results | 1 (0%) | 0 |
| spawn_agent | 1 (0%) | 0 |
| type | 1 (0%) | 0 |

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

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline3-1 | 4 | 4 | 93 | 87 | 87 | 3 | 53 (61%) → 52 | 21 (24%) → 22 | 0 (0%) | 10 (12%) | 3 (3%) | 6 (7%) |
| baseline3-2 | 4 | 4 | 60 | 56 | 54 | 1 | 26 (46%) → 30 | 21 (38%) → 17 | 0 (0%) | 4 (7%) | 5 (9%) | 4 (7%) |
| baseline3-3 | 4 | 4 | 86 | 80 | 79 | 3 | 50 (63%) → 48 | 12 (15%) → 14 | 1 (1%) | 10 (13%) | 7 (9%) | 6 (7%) |

| verdict | baseline3-1 primary | baseline3-1 secondary | baseline3-2 primary | baseline3-2 secondary | baseline3-3 primary | baseline3-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 2 | 0 | 2 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 2 | 0 |
| failed rounds | 0 | 0 | 1 | 0 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline3-1 | 2 | 2 | 14 | 12 | 12 | 0 | 3 (25%) → 4 | 3 (25%) → 2 | 0 (0%) | 6 (50%) | 0 (0%) | 2 (14%) |
| baseline3-2 | 2 | 2 | 20 | 18 | 18 | 1 | 3 (17%) → 4 | 8 (44%) → 7 | 0 (0%) | 6 (33%) | 1 (6%) | 2 (10%) |
| baseline3-3 | 2 | 2 | 15 | 13 | 12 | 0 | 2 (15%) → 3 | 4 (31%) → 3 | 0 (0%) | 5 (39%) | 2 (15%) | 2 (13%) |

| verdict | baseline3-1 primary | baseline3-1 secondary | baseline3-2 primary | baseline3-2 secondary | baseline3-3 primary | baseline3-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

## Caveats

- baseline3-1: 1 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

