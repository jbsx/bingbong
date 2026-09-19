# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-19T16:51:38.491Z over fix-257-1, fix-257-2, fix-257-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 11 | 8 | 3 |
| 2 | answer omitted | 7 | 4 | 3 |
| 3 | budget too small for the Hunt | 0 | 0 | 0 |
| 4 | failed rounds | 0 | 0 | 0 |
| 5 | stopped early | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p2

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-257-1 | 2026-09-19T15:24:52.270Z | complete | 5015f601 | no | 1 | 4d808f72 |
| fix-257-2 | 2026-09-19T15:47:28.877Z | complete | 5015f601 | no | 1 | 4d808f72 |
| fix-257-3 | 2026-09-19T16:11:27.549Z | complete | 5015f601 | no | 1 | 4d808f72 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 273 | 255 | 253 | 8 | 152 (60%) → 145 | 56 (22%) → 63 | 3 (1%) | 30 (12%) | 14 (6%) | 18 (7%) |
| follow_up | 6 | 6 | 64 | 57 | 54 | 0 | 28 (49%) → 30 | 10 (18%) → 8 | 1 (2%) | 14 (25%) | 4 (7%) | 7 (11%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 8 | 4 | 3 | 1 |
| tier too small or never escalated | 0 | 2 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 4 | 0 | 3 | 0 |
| failed rounds | 0 | 2 | 0 | 1 |

- initial: 79 Off-key round(s), 47 Search Loop round(s) by the reviewer (22 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 8 rejected Evidence Checkpoint(s), 5 walled round(s), 11 navigate(s) landed on a Not-found Page (11 judged Off-key), 18 Composed Address(es) rewritten into a site search (15 judged Off-key), 65 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 9 Held Page round(s) without Progress, 8 bundled checkpoint round(s), 2 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 3 skipped bookkeeping round(s), 3 Finalization round(s) cut by the Allowance (1 after a first token, 2 silent); first-token latency p50 4494 ms, p90 6847 ms over 270 round(s), 12 declared Asked Items (7 with an unverified standing, 3 shape failure(s), 1 retried), 0 stopped early, 4 answer omitted, 41 overrule(s), 75 flag(s); Finalization Causes: budget_exhausted 8, deadline_reached 1, objective_met 3
- follow_up: 6 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 2, replay 0, none 4), 7 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), 1 Answer(s) with an Identity Slip, 1 id(s) slipped, 0 Malformed Answer(s) (1 retried), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5165 ms, p90 9428 ms over 64 round(s), 6 declared Asked Items (2 with an unverified standing, 2 shape failure(s), 1 retried), 0 stopped early, 3 answer omitted, 4 overrule(s), 26 flag(s); Finalization Causes: deadline_reached 2, objective_met 4

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 112 (44%) | 15 (28%) |
| read_page | 57 (23%) | 10 (19%) |
| record_evidence | 30 (12%) | 13 (24%) |
| click | 26 (10%) | 0 |
| scroll | 8 (3%) | 12 (22%) |
| report_run_plan | 12 (5%) | 6 (11%) |
| record_candidate | 9 (4%) | 6 (11%) |
| look | 10 (4%) | 2 (4%) |
| type | 6 (2%) | 0 |
| agent_results | 3 (1%) | 1 (2%) |
| spawn_agent | 3 (1%) | 1 (2%) |
| ask_user | 1 (0%) | 0 |
| back | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-257-1 | 4 | 4 | 75 | 69 | 69 | 3 | 44 (64%) → 41 | 13 (19%) → 16 | 1 (1%) | 5 (7%) | 6 (9%) | 6 (8%) |
| fix-257-2 | 4 | 4 | 97 | 91 | 90 | 2 | 52 (57%) → 50 | 22 (24%) → 24 | 1 (1%) | 12 (13%) | 4 (4%) | 6 (6%) |
| fix-257-3 | 4 | 4 | 101 | 95 | 94 | 3 | 56 (59%) → 54 | 21 (22%) → 23 | 1 (1%) | 13 (14%) | 4 (4%) | 6 (6%) |

| verdict | fix-257-1 primary | fix-257-1 secondary | fix-257-2 primary | fix-257-2 secondary | fix-257-3 primary | fix-257-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 3 | 1 | 2 | 2 |
| tier too small or never escalated | 0 | 1 | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 2 | 0 |
| failed rounds | 0 | 1 | 0 | 0 | 0 | 1 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-257-1 | 2 | 2 | 25 | 23 | 23 | 0 | 16 (70%) | 3 (13%) | 0 (0%) | 3 (13%) | 1 (4%) | 2 (8%) |
| fix-257-2 | 2 | 2 | 21 | 18 | 17 | 0 | 8 (44%) | 4 (22%) | 0 (0%) | 5 (28%) | 1 (6%) | 3 (14%) |
| fix-257-3 | 2 | 2 | 18 | 16 | 14 | 0 | 4 (25%) → 6 | 3 (19%) → 1 | 1 (6%) | 6 (38%) | 2 (13%) | 2 (11%) |

| verdict | fix-257-1 primary | fix-257-1 secondary | fix-257-2 primary | fix-257-2 secondary | fix-257-3 primary | fix-257-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 0 | 1 | 1 | 1 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 1 |

## Caveats

- fix-257-3: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

