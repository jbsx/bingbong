# Round Audit — aggregate over 3 sets (bingbong.live-web.information-hunts)

Generated 2026-09-19T13:05:22.719Z over fix-256r2-1, fix-256r2-2, fix-256r2-3, ordered by capture-set creation. This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Ranked causes

Primary verdicts counted over every judged attempt; arithmetic over the reviewer’s per-attempt verdicts, never a judgement across attempts.

| rank | cause | attempts | initial | follow-up |
| --- | --- | --- | --- | --- |
| 1 | rounds wasted | 13 | 8 | 5 |
| 2 | answer omitted | 5 | 4 | 1 |
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
| fix-256r2-1 | 2026-09-19T11:41:42.169Z | complete | ddf728b4 | no | 1 | fa923c9f |
| fix-256r2-2 | 2026-09-19T12:04:03.658Z | complete | ddf728b4 | no | 1 | fa923c9f |
| fix-256r2-3 | 2026-09-19T12:24:09.306Z | complete | ddf728b4 | no | 1 | fa923c9f |

## Populations

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 12 | 12 | 274 | 258 | 256 | 8 | 158 (61%) → 143 | 63 (24%) → 77 | 0 (0%) | 31 (12%) → 32 | 6 (2%) | 16 (6%) |
| follow_up | 6 | 6 | 70 | 64 | 64 | 0 | 27 (42%) → 24 | 13 (20%) → 16 | 0 (0%) | 23 (36%) | 1 (2%) | 6 (9%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 8 | 4 | 5 | 1 |
| tier too small or never escalated | 0 | 2 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 1 |
| answer omitted | 4 | 1 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 |

- initial: 78 Off-key round(s), 45 Search Loop round(s) by the reviewer (22 by the streak rule; attempts by search source rail 12, replay 0, none 0), 0 inherited, 6 rejected Evidence Checkpoint(s), 3 walled round(s), 13 navigate(s) landed on a Not-found Page (13 judged Off-key), 23 Composed Address(es) rewritten into a site search (16 judged Off-key), 13 Subagent round(s), 1 merged Evidence Checkpoint(s) (a floor), 11 Held Page round(s) without Progress, 14 bundled checkpoint round(s), 0 same-source unsupported round(s), 1 Answer(s) with an Identity Slip, 1 id(s) slipped, 0 Malformed Answer(s) (2 retried), 4 skipped bookkeeping round(s), 1 Finalization round(s) cut by the Allowance (0 after a first token, 1 silent); first-token latency p50 2947 ms, p90 4852 ms over 273 round(s), 12 declared Asked Items (6 with an unverified standing, 3 shape failure(s), 2 retried), 0 stopped early, 5 answer omitted, 35 overrule(s), 75 flag(s); Finalization Causes: budget_exhausted 8, objective_met 4
- follow_up: 9 Off-key round(s), 3 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 3, replay 0, none 3), 10 inherited, 3 rejected Evidence Checkpoint(s), 1 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 5 bundled checkpoint round(s), 0 same-source unsupported round(s), 1 Answer(s) with an Identity Slip, 1 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 3789 ms, p90 6169 ms over 70 round(s), 6 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 1 stopped early, 1 answer omitted, 3 overrule(s), 27 flag(s); Finalization Causes: objective_met 6

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 112 (44%) | 25 (39%) |
| read_page | 50 (20%) | 13 (20%) |
| record_evidence | 38 (15%) | 15 (23%) |
| click | 24 (9%) | 0 |
| record_candidate | 7 (3%) | 16 (25%) |
| report_run_plan | 12 (5%) | 6 (9%) |
| scroll | 18 (7%) | 0 |
| look | 12 (5%) | 3 (5%) |
| type | 7 (3%) | 0 |
| back | 2 (1%) | 0 |
| agent_results | 1 (0%) | 0 |
| spawn_agent | 1 (0%) | 0 |

## Per set

### initial

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-256r2-1 | 4 | 4 | 86 | 82 | 81 | 3 | 48 (59%) → 45 | 19 (23%) → 22 | 0 (0%) | 12 (15%) | 3 (4%) | 4 (5%) |
| fix-256r2-2 | 4 | 4 | 96 | 90 | 89 | 2 | 52 (58%) → 45 | 23 (26%) → 30 | 0 (0%) | 12 (13%) | 3 (3%) | 6 (6%) |
| fix-256r2-3 | 4 | 4 | 92 | 86 | 86 | 3 | 58 (67%) → 53 | 21 (24%) → 25 | 0 (0%) | 7 (8%) → 8 | 0 (0%) | 6 (7%) |

| verdict | fix-256r2-1 primary | fix-256r2-1 secondary | fix-256r2-2 primary | fix-256r2-2 secondary | fix-256r2-3 primary | fix-256r2-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 3 | 1 | 2 | 2 |
| tier too small or never escalated | 0 | 2 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 1 | 1 | 2 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

### follow_up

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fix-256r2-1 | 2 | 2 | 22 | 20 | 20 | 0 | 7 (35%) | 7 (35%) | 0 (0%) | 5 (25%) | 1 (5%) | 2 (9%) |
| fix-256r2-2 | 2 | 2 | 29 | 27 | 27 | 0 | 15 (56%) → 12 | 3 (11%) → 6 | 0 (0%) | 9 (33%) | 0 (0%) | 2 (7%) |
| fix-256r2-3 | 2 | 2 | 19 | 17 | 17 | 0 | 5 (29%) | 3 (18%) | 0 (0%) | 9 (53%) | 0 (0%) | 2 (11%) |

| verdict | fix-256r2-1 primary | fix-256r2-1 secondary | fix-256r2-2 primary | fix-256r2-2 secondary | fix-256r2-3 primary | fix-256r2-3 secondary |
| --- | --- | --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 1 | 0 | 0 |
| answer omitted | 0 | 0 | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 | 0 | 0 |

