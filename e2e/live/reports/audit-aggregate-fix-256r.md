# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-16T15:00:46.199Z over fix-256r-1, fix-256r-2, fix-256r-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 10 | 5 | 5 |
| 2 | answer omitted | 7 | 7 | 0 |
| 3 | stopped early | 1 | 0 | 1 |
| 4 | budget too small for the Hunt | 0 | 0 | 0 |
| 5 | failed rounds | 0 | 0 | 0 |
| 6 | tier too small or never escalated | 0 | 0 | 0 |

## Provenance

Shared by every set, and checked before anything was counted:

- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | mode measured | protocol 1 | prompt version(s) 1
- reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- reviewer: claude-opus-5 at high, prompt audit-p2

| set | created | state | commit(s) | dirty tree | grades revision | audited at |
| --- | --- | --- | --- | --- | --- | --- |
| fix-256r-1 | 2026-09-16T14:00:29.144Z | complete | cd7b0c5c | no | 1 | bc7f6f50 |
| fix-256r-2 | 2026-09-16T14:23:48.347Z | complete | cd7b0c5c | no | 1 | bc7f6f50 |
| fix-256r-3 | 2026-09-16T14:47:03.141Z | complete | cd7b0c5c | no | 1 | bc7f6f50 |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 293 | 275 | 273 | 7 | 193 (70%) → 173 | 56 (20%) → 76 | 1 (0%) | 16 (6%) | 9 (3%) | 18 (6%) |
| follow_up | 6 | 6 | 59 | 53 | 51 | 0 | 18 (34%) | 14 (26%) | 0 (0%) | 19 (36%) | 2 (4%) | 6 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 5 | 6 | 5 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| answer omitted | 7 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 1 |

- initial: 110 Off-key round(s), 30 Search Loop round(s) by the reviewer (16 by the streak rule; attempts by search source rail 11, replay 0, none 1), 0 inherited, 4 rejected Evidence Checkpoint(s), 1 walled round(s), 8 navigate(s) landed on a Not-found Page (7 judged Off-key), 18 Composed Address(es) rewritten into a site search (16 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 9 Held Page round(s) without Progress, 9 bundled checkpoint round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 3 skipped bookkeeping round(s), 2 Finalization round(s) cut by the Allowance (1 after a first token, 1 silent); first-token latency p50 4952 ms, p90 7313 ms over 290 round(s), 12 declared Asked Items (4 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 7 answer omitted, 28 overrule(s), 52 flag(s); Finalization Causes: budget_exhausted 7, deadline_reached 2, objective_met 3
- follow_up: 8 Off-key round(s), 5 Search Loop round(s) by the reviewer (4 by the streak rule; attempts by search source rail 2, replay 0, none 4), 7 inherited, 8 rejected Evidence Checkpoint(s), 2 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5692 ms, p90 8218 ms over 59 round(s), 6 declared Asked Items (0 with an unverified standing, 1 shape failure(s), 1 retried), 1 stopped early, 0 answer omitted, 4 overrule(s), 17 flag(s); Finalization Causes: deadline_reached 1, objective_met 5

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 88 (32%) | 17 (33%) |
| read_page | 57 (21%) | 14 (27%) |
| scroll | 45 (16%) | 0 |
| record_evidence | 21 (8%) | 14 (27%) |
| look | 29 (11%) | 0 |
| click | 21 (8%) | 1 (2%) |
| report_run_plan | 12 (4%) | 6 (12%) |
| record_candidate | 4 (1%) | 12 (24%) |
| type | 14 (5%) | 0 |
| agent_results | 1 (0%) | 0 |
| back | 1 (0%) | 0 |
| ground_visual | 1 (0%) | 0 |
| spawn_agent | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-256r-1 | 4 | 4 | 94 | 88 | 86 | 1 | 57 (65%) → 52 | 18 (21%) → 23 | 1 (1%) | 5 (6%) | 7 (8%) | 6 (6%) |
| fix-256r-2 | 4 | 4 | 102 | 95 | 95 | 3 | 71 (75%) → 64 | 18 (19%) → 25 | 0 (0%) | 5 (5%) | 1 (1%) | 7 (7%) |
| fix-256r-3 | 4 | 4 | 97 | 92 | 92 | 3 | 65 (71%) → 57 | 20 (22%) → 28 | 0 (0%) | 6 (7%) | 1 (1%) | 5 (5%) |

| verdict | fix-256r-1 primary | fix-256r-1 secondary | fix-256r-2 primary | fix-256r-2 secondary | fix-256r-3 primary | fix-256r-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 1 | 2 | 2 | 1 | 3 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 2 | 0 | 3 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-256r-1 | 2 | 2 | 16 | 14 | 13 | 0 | 4 (29%) | 2 (14%) | 0 (0%) | 7 (50%) | 1 (7%) | 2 (13%) |
| fix-256r-2 | 2 | 2 | 22 | 20 | 20 | 0 | 8 (40%) → 6 | 5 (25%) → 7 | 0 (0%) | 7 (35%) | 0 (0%) | 2 (9%) |
| fix-256r-3 | 2 | 2 | 21 | 19 | 18 | 0 | 6 (32%) → 8 | 7 (37%) → 5 | 0 (0%) | 5 (26%) | 1 (5%) | 2 (10%) |

| verdict | fix-256r-1 primary | fix-256r-1 secondary | fix-256r-2 primary | fix-256r-2 secondary | fix-256r-3 primary | fix-256r-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 1 | 0 | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 1 |

## Caveats

- fix-256r-2: 2 call argument(s), result head(s) or search quer(ies) withheld from this output: each restated Grading Key text

