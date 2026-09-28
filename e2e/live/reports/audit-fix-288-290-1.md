# Round Audit — bingbong.live-web.information-hunts (fix-288-290-1)

Generated 2026-09-28T12:02:33.774Z from a capture set created 2026-09-28T10:36:36.160Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) c157d3b1; mode measured; protocol 1; prompt version(s) 1
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p3; audit run at commit c157d3b1 (dirty tree)

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 71 | 66 | 65 | 0 | 47 (71%) → 49 | 12 (18%) → 10 | 0 (0%) | 6 (9%) | 1 (2%) | 5 (7%) |
| follow_up | 2 | 2 | 12 | 10 | 9 | 0 | 6 (60%) | 2 (20%) | 0 (0%) | 1 (10%) | 1 (10%) | 2 (17%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| answer omitted | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 1 |

- initial: 20 Off-key round(s), 11 Search Loop round(s) by the reviewer (8 by the streak rule, heads included: 4 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 3, replay 0, none 1; navigate searches by Search URL form q 11, param 1, path 4; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 2 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 1, 0 declined no_progress against the replay), 0 inherited, 2 rejected Evidence Checkpoint(s), 1 walled round(s), 2 navigate(s) landed on a Not-found Page (2 judged Off-key), 4 Composed Address(es) rewritten into a site search (3 judged Off-key, 0 to an address the Run was shown), 1 search(es) ran with an Unseen Phrase unquoted (1 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 2 Result Pick(s) against 15 listing(s) returned to the model, a search’s result opened in 1.8 round(s) on average (13 of 17 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 7 record_evidence call(s) by the model and 6 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 6 bookkeeping round(s) right before the Answer, Answer Checkpoints: 2 offered in 3 Answer(s), 2 accepted, 0 dropped, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 1 Finalization round(s) cut by the Allowance (0 after a first token, 1 silent); first-token latency p50 5923 ms, p90 8872 ms over 70 round(s), 4 declared Asked Items (1 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 10 overrule(s), 20 flag(s); Finalization Causes: deadline_reached 1, objective_met 3
- follow_up: 2 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 1; navigate searches by Search URL form q 2, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 1 inherited, 0 rejected Evidence Checkpoint(s), 0 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 1 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 1 Result Pick(s) against 1 listing(s) returned to the model, a search’s result opened in 1.5 round(s) on average (2 of 2 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 3 record_evidence call(s) by the model and 1 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 1 bookkeeping round(s) right before the Answer, Answer Checkpoints: 2 offered in 2 Answer(s), 2 accepted, 0 dropped, 1 Malformed Answer(s) (1 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5480 ms, p90 7671 ms over 12 round(s), 2 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 1 stopped early, 0 answer omitted, 0 overrule(s), 9 flag(s); Finalization Causes: objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 36 (55%) | 6 (67%) |
| read_page | 16 (25%) | 2 (22%) |
| record_evidence | 6 (9%) | 3 (33%) |
| report_run_plan | 4 (6%) | 2 (22%) |
| scroll | 3 (5%) | 0 |
| click | 2 (3%) | 0 |
| look | 2 (3%) | 0 |
| record_candidate | 2 (3%) | 0 |
| type | 1 (2%) | 0 |

## Consent walls by hunt

Tier-1 dismissals the app reported, clicks on a consent-style control by hand, and Blocked Actions such a click followed within two rounds (ADR 0061).

| hunt | dismissals | hand consent clicks | blocked then hand consent |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 1 | 0 | 0 |
| rule-eurostar-luggage | 1 | 0 | 0 |
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
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 1 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 |
| rule-eurostar-luggage | 3 | 0 | 0 |
| superseded-voyager-interstellar | 1 | 1 | 0 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| compatibility-pi-camera (follow-up) | 1 | 0 | 1 | 0 (0%) | 1 | 0 (0%) |
| historical-longitude-watch (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| rule-eurostar-luggage (initial) | 1 | 0 | 1 | 1 (100%) | 0 | 0 (n/a) |
| rule-eurostar-luggage (follow-up) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| superseded-voyager-interstellar (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | deadline_reached | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 1 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | objective_met | 1 | 0 (0%) |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended failed (deadline_reached); tier investigation; 13 of 24 Tool Rounds used; 16 orchestrator rounds, 2 in Finalization; Run duration 375353 ms; LLM stage 371349 ms over 16 joined round(s)
- grade unsuccessful; checks unsatisfied: fact-01, fact-02, fact-03, fact-04, fact-05, fact-06 (6 of 10)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 1 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.86 against the declared investigation (agrees); garbled 0.03
- Malformed Answers: 0 (0 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 1 round(s) cut by the Finalization Allowance (0 after a first token, 1 silent)
- Asked Items: 4 declared; Answer standings 0 stated, 4 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 0
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 0; bookkeeping-only rounds: 0
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: no search
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 7 (50%) · Acquisition without Progress 6 (43%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 1 (7%) · Finalization 2 (13%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; declined at the deadline: no_tier_above (after round 14, replay: no judged call)
- reads refused as past the end: 0
- bookkeeping rounds right before the Answer: 0
- Answer Checkpoints: 0 offered in 0 Answer(s), 0 accepted, 0 dropped
- **verdict: answer omitted** — After the overrules on rounds 3, 4, 7, 8, 9 and 10, 12 of the 13 Tool Rounds were on-key acquisition with progress on exactly the three pages this key verifies (rounds 1-4, 5-10, 11-12), with only round 13's Cloudflare wall off-key, no searches and therefore no loops, and no genuine repeats. The material behind all six unsatisfied checks (fact-01 through fact-06) had been put in front of the assistant, and the Answer in round 16 stated none of it.
- secondary: failed rounds — Round 14 spent 112404 ms and 31458 chars of reasoning only to be cut by the active-work deadline, and round 15 was then cut by the Finalization Allowance, leaving the reserved Answer in round 16 to be composed at low effort - 1 failed round out of 14 budgeted plus one truncated finalization is the mechanism by which the read material never reached the Answer.
- stopped early: no — The attempt ended with stop reason deadline_reached after 375353 ms - round 14 was cut by the active-work deadline and round 15 by the Finalization Allowance - so time, not judgement, ended the Run; unused Tool Rounds do not make this an early stop when no time remained. Separately, each unsatisfied check is carried by a page the Run had already read, so none of them needed a page it had not reached.
- answer omitted: yes (fact-01, fact-02, fact-03, fact-04, fact-05, fact-06) — All three pages this key verifies were read before the Answer: https://www.raspberrypi.com/documentation/accessories/camera.html in rounds 1-4 (parts 1-3), https://www.raspberrypi.com/documentation/computers/camera_software.html in rounds 5-10 (parts 1-4 and 7), and https://www.raspberrypi.com/products/camera-module-3/ in rounds 11-12 (full read). fact-01 and fact-03 sit on the accessories page, fact-02 and one half of fact-04 on the product page, and fact-05, fact-06 and the remaining half of fact-04 on the camera_software page. The round 16 Answer, written at low effort after round 14 was cut, left all six unstated.
- Off-key round 13 (https://forums.raspberrypi.com/viewtopic.php?t=351095): The navigate settled on a Cloudflare interstitial (title "Just a moment...", wall: challenge forums.raspberrypi.com) instead of the forum thread, so the page in front of the assistant was a challenge screen and could carry no required fact of this task.
- overrule round 3 → Acquisition with Progress: read_page {"part":3} on https://www.raspberrypi.com/documentation/accessories/camera.html is a different slice of a 27163-px document, not a repeat observation: the page signature is unchanged but the text returned is material the Run had not seen, since round 2 read part 2.
- overrule round 4 → Acquisition with Progress: read_page {"part":1} of https://www.raspberrypi.com/documentation/accessories/camera.html brought in a part not yet read (parts 2 and 3 came in rounds 2 and 3); the mechanical label keyed on the unchanged page signature rather than the part argument.
- overrule round 7 → Acquisition with Progress: read_page {"part":3} of https://www.raspberrypi.com/documentation/computers/camera_software.html (an 83957-px document) delivered a section not previously read; round 6 had read part 1 only.
- overrule round 8 → Acquisition with Progress: read_page {"part":2} of https://www.raspberrypi.com/documentation/computers/camera_software.html is a distinct, not-yet-fetched slice of the same long page.
- overrule round 9 → Acquisition with Progress: read_page {"part":4} of https://www.raspberrypi.com/documentation/computers/camera_software.html brought new document text in; only parts 1-3 had been read.
- overrule round 10 → Acquisition with Progress: read_page {"part":7} of https://www.raspberrypi.com/documentation/computers/camera_software.html is a further unread slice; the repeat-read label rests on the identical signature eca9dcfb, not on the content actually returned.
- flag (round 13): Round 13 reached a URL the Run had not visited but landed on a Cloudflare challenge: should it remain acquisition_with_progress as the mechanical rule has it, or be overruled to acquisition_without_progress because the wall put nothing before the assistant?
- flag (round 3): Rounds 3, 4, 7, 8, 9 and 10 reuse the same page signature with different part arguments; a reviewer reading "page state already read" strictly by signature would leave all six as acquisition_without_progress and could then reach rounds_wasted - is part-wise reading of a long document Progress?
- flag (round 14): Is the decisive failure the omission in the round 16 Answer or the deadline cut of round 14 together with round 15's allowance cut? A careful reviewer could swap primary and secondary.
- flag (round 16): With 11 of the 24 Tool Rounds unused when the deadline hit, could an assessor argue stoppedEarly for any of fact-01..fact-06 on the ground that budget remained, despite the deadline_reached stop reason?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:6157174d…, $0.35

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 25635 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 5870 | read_page: the first read of this page state |
| 3 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 5664 | read_page: a repeat read of a page state already read |
| 4 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 9213 | read_page: a repeat read of a page state already read |
| 5 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 30674 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 12553 | read_page: the first read of this page state |
| 7 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 12284 | read_page: a repeat read of a page state already read |
| 8 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5153 | read_page: a repeat read of a page state already read |
| 9 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6971 | read_page: a repeat read of a page state already read |
| 10 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 15077 | read_page: a repeat read of a page state already read |
| 11 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/camera-module-3/ | 36014 | navigate: the settled page state moved to a page this Run had not acquired |
| 12 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 24081 | read_page: the first read of this page state |
| 13 | Acquisition with Progress | navigate | https://forums.raspberrypi.com/viewtopic.php?t=351095 | 20055 | navigate: the settled page state moved to a page this Run had not acquired [walled, off-key] |
| 14 | Failed round | — | — | 112404 | cut by the active-work deadline |
| 15 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 16 | Finalization | — | — | 39700 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 7 of 12 Tool Rounds used; 8 orchestrator rounds, 1 in Finalization; Run duration 147015 ms; LLM stage 141626 ms over 8 joined round(s)
- grade useful_partial; checks unsatisfied: fact-02 (1 of 6)
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.73 against the declared lookup (disagrees); garbled 0.05
- Malformed Answers: 0 (0 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 4 declared; Answer standings 4 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 4)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 1 (round 5)
- of the rewrites, judged Off-key by the reviewer: 1
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 1 (round 1); listings returned to the model: 1 (round 5)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 3; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 1, 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 5 (71%) · Acquisition without Progress 1 (14%) · Collection 0 (0%) · Bookkeeping 1 (14%) · Failed round 0 (0%) · Finalization 1 (13%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 2, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- bookkeeping rounds right before the Answer: 1 (round 7)
- Answer Checkpoints: 1 offered in 1 Answer(s), 1 accepted, 0 dropped
- **verdict: stopped early** — The Run declared objective_met after 7 of 12 budgeted Tool Rounds (5 unused) and at about 60% of the time deadline, with 3 accepted Evidence Checkpoints and no failed rounds. The single unsatisfied check, fact-02, needed the mechanical documentation page at https://www.raspberrypi.com/documentation/accessories/camera.html, which was never acquired in any of rounds 1-7; the Run had budget and time to reach it and instead terminated.
- secondary: rounds wasted — 2 of the 7 budgeted rounds went to material that could carry no required fact: round 4's navigate settled on the 404 at https://www.raspberrypi.com/products/camera-module-2/, and round 5's navigate was rewritten into the SERP https://duckduckgo.com/?q=products+camera+module+site%3Araspberrypi.com&ia=web — both spent chasing the Module 2 product page rather than the documentation source fact-02 rests on.
- stopped early: yes (fact-02) — The Run stopped at 7 of 12 Tool Rounds with the app's own notice putting it at 60% of the active-work deadline, and ended done/objective_met. The one unsatisfied check, fact-02, rests on the official mechanical documentation page listed among the key's verified sources (https://www.raspberrypi.com/documentation/accessories/camera.html), which this Run never navigated to or read. The pages it did read — https://www.raspberrypi.com/products/raspberry-pi-zero-case/, https://www.raspberrypi.com/products/camera-module-3/ and https://www.raspberrypi.com/products/camera-module-v2/ — are product pages whose recorded excerpts give compatibility conclusions and per-module specifications, not the mechanical account fact-02 requires. With five Tool Rounds and roughly 40% of the deadline unspent, not reaching that page is the stop.
- answer omitted: no — The only unsatisfied check, fact-02, is assigned to stoppedEarly: it required the documentation page the Run never read, and no page put in front of the assistant across rounds 1-7 carried that material. No remaining unsatisfied check follows from a page the Run had read.
- Off-key round 4 (https://www.raspberrypi.com/products/camera-module-2/): The settled page is a Not-found Page on raspberrypi.com (title "Page not found"); a 404 shell can carry no required fact of this task. The useful record_evidence in the same round was grounded in the earlier camera-module-3 observation, not in this page.
- Off-key round 5 (https://duckduckgo.com/?q=products+camera+module+site%3Araspberrypi.com&ia=web): The navigate was rewritten into a DuckDuckGo site-restricted search, so the round landed on a search results page, which carries none of the task's required facts itself; the mechanical-fit documentation page among the key's verified sources was not what this query aimed at.
- flag (round 4): Round 4 is called Off-key on the strength of the settled 404 at https://www.raspberrypi.com/products/camera-module-2/, yet the round also produced an accepted Evidence Checkpoint (memory-2) grounded in the earlier camera-module-3 observation — should a round whose bookkeeping was productive still be marked Off-key on its landing page?
- flag (round 5): Round 5's navigate was rewritten by the app into a site search, so the assistant did not choose a search surface; is the resulting DuckDuckGo SERP fairly judged Off-key, or should the rewrite be held against the app rather than the round?
- flag (round 5): Rounds 1 and 5 both settled on DuckDuckGo results with real pages opened in rounds 2-3 between them, so no Search Loop is recorded; a reviewer treating round 4's 404 as putting nothing before the assistant might instead read rounds 4-5 as blind groping for the same Module 2 page.
- flag (round 6): Round 6 (https://www.raspberrypi.com/products/camera-module-v2/) is left on-key as the module the case lid was designed for, but a reviewer could call a Module 2 product page unable to carry any required fact of this follow-up and mark it Off-key.
- flag (round 7): The verdict ranks stopped_early above rounds_wasted; with 2 of 7 rounds Off-key and the time_milestone notice fired at round 7 without a Tier Escalation, a reviewer could make rounds_wasted primary.
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:c3c4410c…, $0.26

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 27262 | navigate: the settled page state moved to a page this Run had not acquired [result pick] |
| 2 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 25432 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 5189 | read_page: the first read of this page state |
| 4 | Acquisition without Progress | navigate, record_evidence | https://www.raspberrypi.com/products/camera-module-2/ | 16325 | navigate: landed on a Not-found Page [not found, off-key] |
| 5 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=products+camera+module+site%3Araspberrypi.com&ia=web | 11955 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 6 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/camera-module-v2/ | 4837 | navigate: the settled page state moved to a page this Run had not acquired |
| 7 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/camera-module-v2 | 7672 | record_evidence |
| 8 | Finalization | — | — | 42954 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 23 of 24 Tool Rounds used; 24 orchestrator rounds, 1 in Finalization; Run duration 270242 ms; LLM stage 240404 ms over 24 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.06
- Malformed Answers: 0 (0 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 9 declared; Answer standings 9 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 1 (round 16); listings returned to the model: 8 (round 2, 4, 6, 9, 12, 14, 17, 22)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 0; bookkeeping-only rounds: 0
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: none, 2, 2, 2, 2, 2, 1, none, 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 21 (91%) · Acquisition without Progress 2 (9%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 0 (0%) · Finalization 1 (4%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 3, param 1, path 4
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- bookkeeping rounds right before the Answer: 0
- Answer Checkpoints: 2 offered in 1 Answer(s), 2 accepted, 0 dropped
- **verdict: rounds wasted** — The hunt succeeded, but on a thin margin bought with a large share of unproductive rounds: 10 of 23 budgeted rounds (1, 2, 3, 4, 5, 6, 7, 13, 15, 22) sat on Off-key surfaces — two empty in-site search shells, three external SERPs, two not-found object landings and two guessed numeric URLs that resolved to an unrelated crew list and an unrelated photograph — and three Search Loops (2/4, 12/14, 16/17/22) account for five rounds, with Rounds 14 and 17 overruled to acquisition_without_progress. Only Rounds 11 and 23 reached the two records that carry this task's fields, and Round 23 arrived after the 3/24 budget warning with a single round to spare.
- stopped early: no — The attempt ran to effectively its whole allowance — 23 of 24 Tool Rounds, with budget warnings at 6/24 and 3/24 — and the Grade lists no unsatisfied checks, so there is no check that needed a page the Run had not read.
- answer omitted: no — No check is listed as unsatisfied; the Grade is a pass, so there is nothing the Answer left unstated for this judgement to name.
- Search Loop over rounds 2, 4: Round 2's in-site keyword search and Round 4's DuckDuckGo site: query run back to back; the only thing between them was Round 3's read_page of the very results page from Round 2, and a page read does not break a loop. The app already counted this (streak 2, rewording).
- Search Loop over rounds 12, 14: Round 12 searched the case title and Round 14 reworded it to 'K1 carrying case'. The rule took Round 13's navigate to https://www.rmg.co.uk/collections/objects/rmgc-object-264178 as an opening, but that landing produced an empty title and a 0/962 page — nothing was put before the assistant — so the loop extends across it and Round 14 is a second consecutive blind search.
- Search Loop over rounds 16, 17, 22: Round 16 (search ZAA0037.1), Round 17 (search ZAA0037) and Round 22 (DuckDuckGo "Carrying case for H4 and K1") are consecutive searches with no result opened between them: Rounds 18-21 are a read_page and three scrolls on https://www.rmg.co.uk/collections/objects/search/ZAA0037, and reads and scrolls do not break a loop. The app marked Round 17 as streak 1, which understates it; it marked Round 22 streak 2 against Round 17, consistent with this loop.
- Off-key round 1 (https://www.rmg.co.uk/collections/objects-and-stories/search?t=Harrison%20longitude%20watch): A collection search endpoint that returned an empty shell (no page title, 0/962 scroll height): a results surface, and here one with nothing listed on it, so it can carry none of the record fields this task needs.
- Off-key round 2 (https://www.rmg.co.uk/collections/objects-and-stories/search?keywords=Harrison+watch+longitude): The same empty search endpoint with a different query string; a results page on the right site but with no object record on it.
- Off-key round 3 (https://www.rmg.co.uk/collections/objects-and-stories/search?keywords=Harrison+watch+longitude): read_page of that same empty results shell — reading a results page that lists nothing cannot yield any required catalogue field.
- Off-key round 4 (https://duckduckgo.com/?q=site%3Acollections.rmg.co.uk+Harrison+watch+1759&ia=web): An external search engine results page; no catalogue record field lives here, and it is also the second member of the Round 2/4 loop.
- Off-key round 5 (https://www.rmg.co.uk/collections/objects/rmgc-object-650718): A guessed numeric object URL that resolved to a crew-list/official-logs record for a ship — right site, wrong subject entirely, so it can carry no fact of this task.
- Off-key round 6 (https://duckduckgo.com/?q=site%3Armgc-object+Harrison+watch+longitude+1759+rmg.co.uk&ia=web): An external search engine results page, and with a malformed site: operator at that; a SERP carries none of the catalogue fields required.
- Off-key round 7 (https://www.rmg.co.uk/collections/objects/rmgc-object-272614): Object URL that came back with no title and a 0/962 page — a not-found/empty record landing, carrying no field of any kind.
- Off-key round 13 (https://www.rmg.co.uk/collections/objects/rmgc-object-264178): Another empty-titled 0/962 object landing; nothing was rendered, so no required fact could be on it.
- Off-key round 15 (https://www.rmg.co.uk/collections/objects/rmgc-object-262032): A guessed numeric object URL that resolved to a photographic record titled 'Slave-girls. Suakim' — right site, wrong subject, carries nothing this task needs.
- Off-key round 22 (https://duckduckgo.com/?q=%22Carrying+case+for+H4+and+K1%22+rmg.co.uk&ia=web): External SERP and third member of the 16/17/22 loop; it carries no record field itself, though it did surface the link opened in Round 23.
- overrule round 14 → Acquisition without Progress: Labelled acquisition_with_progress on the strength of a new URL, but it is the second consecutive blind search of the 12/14 loop: the intervening Round 13 landing at rmgc-object-264178 rendered nothing (empty title, 0/962), so it was not an opening.
- overrule round 17 → Acquisition without Progress: A search ('ZAA0037') immediately after the search of Round 16 ('ZAA0037.1') with no result opened between them; the app recorded streak 1, but by the loop rule this is a loop member and brings no progress of its own.
- flag (round 3): Rounds 1-3 are marked Off-key as empty results shells inferred from the blank titles and 0/962 page height; a reviewer who read them as ordinary (if unhelpful) search-results navigation could leave them on-key.
- flag (round 13): Is the empty-titled landing at rmgc-object-264178 a real opening that breaks the loop, or a nothing-page across which the 12/14 loop extends? The overrule of Round 14 rests on the latter reading.
- flag (round 17): The app counted Round 17 as streak 1; overruling it to a loop member (16/17/22) departs from the mechanical label and could be argued the other way if Round 16's navigate to a results URL is treated as an opening.
- flag (round 10): Round 10's click opened a result but landed on another Collection Results page; treating that as an opening rather than a search is what keeps Rounds 9 and 12 out of a single loop.
- flag (round 21): Rounds 18-21 (a read plus three scrolls of the ZAA0037 grouping) are left on-key because that listing enumerates the parts that led to the case record; a stricter reading of 'a search results page' would call them Off-key and push the wasted share higher.
- flag (round 23): Verdict on the line: the attempt passed every check inside its budget, so rounds_wasted is a cost judgement rather than a failure — a reviewer weighting outcome over cost might record no adverse verdict.
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:44775e0b…, $0.45

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects-and-stories/search?t=Harrison%20longit… | 12960 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects-and-stories/search?keywords=Harrison+w… | 4073 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 3 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects-and-stories/search?keywords=Harrison+w… | 7543 | read_page: the first read of this page state [off-key] |
| 4 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=site%3Acollections.rmg.co.uk+Harrison+watch+1759&ia=we… | 13482 | navigate: a search after a search with nothing opened between them (streak 2, rewording the one before it) [off-key, search loop] |
| 5 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-650718 | 5581 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 6 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=site%3Armgc-object+Harrison+watch+longitude+1759+rmg.c… | 6211 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-272614 | 6773 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 8 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections | 5530 | navigate: the settled page state moved to a page this Run had not acquired |
| 9 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/search/Harrison%20longitude%20watch | 8637 | type: the settled page state moved |
| 10 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects/search/Harrison%20longitude%20watch?_g… | 33958 | click: the settled page state moved |
| 11 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 8335 | navigate: the settled page state moved to a page this Run had not acquired |
| 12 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20an… | 8457 | navigate: the settled page state moved to a page this Run had not acquired [search loop] |
| 13 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-264178 | 4934 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 14 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/search/K1%20carrying%20case | 8033 | navigate: the settled page state moved to a page this Run had not acquired [search loop] |
| 15 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-262032 | 4623 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 16 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 4649 | navigate: the settled page state moved to a page this Run had not acquired [result pick, search loop] |
| 17 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 5189 | navigate: the settled page state moved to a page this Run had not acquired [search loop, loop head by the streak rule] |
| 18 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 6350 | read_page: the first read of this page state |
| 19 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 7626 | scroll: the scroll brought new material into view |
| 20 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 5509 | scroll: the scroll brought new material into view |
| 21 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 2155 | scroll: the scroll brought new material into view |
| 22 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=%22Carrying+case+for+H4+and+K1%22+rmg.co.uk&ia=web | 9136 | navigate: a search after a search with nothing opened between them (streak 2) [off-key, search loop] |
| 23 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 6078 | navigate: the settled page state moved to a page this Run had not acquired |
| 24 | Finalization | — | — | 54582 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 14 of 24 Tool Rounds used; 15 orchestrator rounds, 1 in Finalization; Run duration 275025 ms; LLM stage 257952 ms over 15 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.65 against the declared investigation (agrees); garbled 0.04
- Malformed Answers: 0 (0 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 5 declared; Answer standings 5 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 3 (round 2, 4, 7)
- of the rewrites, judged Off-key by the reviewer: 2
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 1 (round 2); listings returned to the model: 4 (round 4, 7, 8, 12)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 3; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 1, 2, none, 2, 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 11 (79%) · Acquisition without Progress 2 (14%) · Collection 0 (0%) · Bookkeeping 1 (7%) · Failed round 0 (0%) · Finalization 1 (7%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 5, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- bookkeeping rounds right before the Answer: 1 (round 14)
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: rounds wasted** — The attempt succeeded well inside its tier (14 of 24 Tool Rounds used, ended objective_met), so no budget or stop verdict applies; what remains chargeable is the share of rounds spent on pages that could carry nothing: round 1 on Eurostar's Not-found Page and rounds 4, 7, 8 and 12 on DuckDuckGo results pages — 5 of 14 budgeted rounds Off-key, including the two-search loop at rounds 7-8 that drew the app's own search_loop_nudge. Three of those SERP landings came from navigates to guessed addresses being rewritten into site searches after the round-1 404, rather than following links from the luggage page already read at round 3. The productive spine was short: rounds 2-3, 5-6, 9-11 and 13.
- stopped early: no — The Grade records a pass with no unsatisfied checks, so there is no check to attribute to a page the Run had not read; the Run also ended by declaring the objective met rather than by exhausting its budget.
- answer omitted: no — No unsatisfied checks are listed, so there is nothing on a page the Run had read that the Answer is charged with leaving unstated.
- Search Loop over rounds 7, 8: Round 7's navigate to help.eurostar.com was rewritten into a site search that settled on a DuckDuckGo results page, and round 8 issued a second DuckDuckGo search with nothing opened in between; the app's own streak reached 2 and raised search_loop_nudge. The record_evidence call in round 7 preceded its search and put no new page before the assistant, so it does not break the loop. The loop closes at round 9, where a real page (https://help.eurostar.com/faq/uk-en/category/luggage) was opened.
- Off-key round 1 (https://www.eurostar.com/us-en/travel-info/service/luggage-allowance): The composed address resolved to Eurostar's Not-found Page ('Sorry, we can't find the page you're looking for'). A 404 shell carries no policy text, so it can carry none of this task's required facts.
- Off-key round 4 (https://duckduckgo.com/?q=uk+en+travel+info+planning+musical+instruments+site%3Aeurostar.com&ia=web): The navigate was rewritten into a site search and settled on a DuckDuckGo results page rather than any Eurostar page. A search results page is an index of links, not a source of the allowance or instrument rules, so it can carry none of the required facts.
- Off-key round 7 (https://duckduckgo.com/?q=site%3Aeurostar.com&ia=web): The navigate to help.eurostar.com was rewritten into a bare site: search and settled on a DuckDuckGo results page. A whole-site results listing carries no rule text of any kind for this task.
- Off-key round 8 (https://duckduckgo.com/?q=guitar+luggage+allowance+site%3Ahelp.eurostar.com&ia=web): A second DuckDuckGo results page; a results listing carries none of the task's required facts, and nothing from it was opened in this round.
- Off-key round 12 (https://duckduckgo.com/?q=%22musical+instrument%22+site%3Ahelp.eurostar.com%2Ffaq%2Fuk-en&ia=web): The settled page is a DuckDuckGo results listing, not an official page; it cannot itself carry the allowance count, the length threshold or the guitar condition. Borderline in usefulness — it produced the link opened in round 13 — but the page landed on carries no required fact.
- overrule round 7 → Acquisition without Progress: Mechanically credited with Progress for reaching an unvisited URL, but that URL was a DuckDuckGo results page produced by a rewritten navigate, and it is the first of the two consecutive searches with nothing opened between them (rounds 7-8). A member of a Search Loop is Acquisition without Progress; the app's streak counter flagged only the second member.
- flag (round 1): Round 1 landed on a Not-found Page while also filing the Run Plan — is calling it Off-key too strict, given the 404 told the Run its guessed URL shape was wrong?
- flag (round 2): Round 2's navigate was rewritten into a site search yet settled on the official luggage page — should it count as a search at all for loop purposes, and could it pair with round 4 as a loop?
- flag (round 7): Round 7 is overruled to Acquisition without Progress as the first member of the rounds 7-8 loop; a reviewer could keep the mechanical label and treat only round 8 as the loop member.
- flag (round 12): Round 12's results page led directly to the instrument FAQ opened in round 13 — is an Off-key call defensible for a SERP immediately converted into an on-key opening?
- flag (round 14): The verdict is on the line: the attempt passed with 10 Tool Rounds and time to spare, so a reviewer might record no adverse verdict rather than rounds_wasted on a 5-of-14 Off-key share.
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:c4bec10a…, $0.35

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/us-en/travel-info/service/luggage-allowance | 10457 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4832 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, result pick] |
| 3 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7733 | read_page: the first read of this page state |
| 4 | Acquisition with Progress | navigate, record_evidence | https://duckduckgo.com/?q=uk+en+travel+info+planning+musical+instruments+site%3A… | 12783 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 5 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5065 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4063 | read_page: the first read of this page state |
| 7 | Acquisition with Progress → Acquisition without Progress | record_evidence, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 18776 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key, search loop, loop head by the streak rule] |
| 8 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=guitar+luggage+allowance+site%3Ahelp.eurostar.com&ia=w… | 25732 | navigate: a search after a search with nothing opened between them (streak 2) [off-key, search loop] |
| 9 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/category/luggage | 8218 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Acquisition with Progress | click | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 6896 | click: the settled page state moved |
| 11 | Acquisition with Progress | read_page | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 7734 | read_page: the first read of this page state |
| 12 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=%22musical+instrument%22+site%3Ahelp.eurostar.com%2Ffa… | 9924 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 13 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on… | 2463 | navigate: the settled page state moved to a page this Run had not acquired |
| 14 | Bookkeeping | record_evidence | https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on… | 67672 | record_evidence |
| 15 | Finalization | — | — | 65604 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 2 of 12 Tool Rounds used; 4 orchestrator rounds, 1 in Finalization; Run duration 79949 ms; LLM stage 78598 ms over 4 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: lookup at 0.71 against the declared lookup (agrees); garbled 0.09
- Malformed Answers: 1 (1 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; Answer standings 3 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 0
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 0; bookkeeping-only rounds: 0
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: no search
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (33%) · Acquisition without Progress 1 (33%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 1 (33%) · Finalization 1 (25%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- bookkeeping rounds right before the Answer: 0
- Answer Checkpoints: 1 offered in 1 Answer(s), 1 accepted, 0 dropped
- **verdict: rounds wasted** — Only 1 of the 3 budgeted rounds carried Progress (round 2, the read of https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage). Round 1's navigate to that same URL scored as a re-acquisition of an inherited checkpointed page, and round 3 spent 42316 ms and 6563 chars of reasoning producing neither a tool call nor an Answer. Two of three budgeted rounds therefore returned nothing new, with 10 of 12 Tool Rounds left unused.
- secondary: failed rounds — Round 3 is a failed round — completed with no tool call and no Answer — and is the single longest stretch of the 79949 ms run; it did not cost the result (Grade: pass, no unsatisfied checks), so it ranks second.
- stopped early: no — The Grade records no unsatisfied checks, so there is no check to attribute to a page the Run had not read; the Run also ended objective_met after reaching the verified source page.
- answer omitted: no — No unsatisfied checks exist for this attempt, so nothing followed from a page the Run had read and was left unstated.
- flag (round 1): Round 1 navigated to https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, a URL this follow-up Run had not itself loaded — should it be overruled to Acquisition with Progress rather than counted a re-acquisition, given the inheritance came from the initial attempt and not from this Run's own rounds?
- flag (round 1): Round 1 bundled report_run_plan with the navigate — could a careful human label it Bookkeeping instead of Acquisition without Progress, since its only acquisition scored no progress?
- flag (round 3): Round 3 completed normally with heavy reasoning but emitted no call and no Answer — is that a Failed round, or a deliberation round that should not be charged as a failure?
- flag (round 4): Given the attempt passed every check with 10 Tool Rounds unused, is rounds_wasted the right primary over failed_rounds, when the only non-productive rounds are one inherited repeat and one empty round?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:cb8675e5…, $0.13

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7543 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5539 | read_page: the first read of this page state |
| 3 | Failed round | — | — | 42316 | the round completed with no tool call and no Answer |
| 4 | Finalization | — | — | 23200 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 15 of 24 Tool Rounds used; 16 orchestrator rounds, 1 in Finalization; Run duration 255107 ms; LLM stage 237121 ms over 16 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 2 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.05
- Malformed Answers: 0 (0 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 7 declared; Answer standings 7 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 1 (round 5)
- of the rewrites, judged Off-key by the reviewer: 1
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 1 (round 2)
- of those, judged Off-key by the reviewer: 1
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 3 (round 2, 5, 6)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 4; bookkeeping-only rounds: 5
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 2, none, 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 8 (53%) · Acquisition without Progress 2 (13%) · Collection 0 (0%) · Bookkeeping 5 (33%) · Failed round 0 (0%) · Finalization 1 (6%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 3, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- bookkeeping rounds right before the Answer: 5 (round 11, 12, 13, 14, 15)
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: rounds wasted** — The objective was met, so the cost shows only in the share of the budget that bought nothing: 4 of the 15 budgeted rounds landed where no required fact could be found — round 1's 404 on a guessed JPL slug, and the DuckDuckGo results pages at rounds 2, 5 and 6, of which 5-6 form a search loop (round 5 overruled to Acquisition without Progress). Round 10 also re-navigated to the already-acquired https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/ before its Look, and round 11 spent an entire round on two Evidence Checkpoints rejected as excerpt_unsupported that had to be re-filed at rounds 12-13. Against only 4 rounds that actually put the two verified sources in front of the assistant (rounds 3-4 and 7-9), that overhead is the defining feature of the attempt.
- stopped early: no — The Grade records a pass with no unsatisfied checks, so there is no check to attribute to a page the Run had not read; the question does not arise even though 9 of the 24 Tool Rounds were unused.
- answer omitted: no — No check is listed as unsatisfied, so nothing that follows from a page the Run had read was left unstated by the Answer.
- Search Loop over rounds 5, 6: Round 5's navigate to https://www.jpl.nasa.gov/news/nasas-voyager-1-craft-enters-interstellar-space/ was rewritten into a DuckDuckGo site search, and round 6 issued a second DuckDuckGo query with nothing opened between them; the app counted streak 2 at round 6, so the loop is the pair 5-6. Round 4's read_page of the JPL release is the opening that keeps round 2's earlier search out of this loop.
- Off-key round 1 (https://www.jpl.nasa.gov/news/voyager-1-has-not-yet-left-the-solar-system-says-nasa-team/): A guessed JPL slug that resolved to a 404 Not-found Page; a 404 body carries none of this task's required facts and is neither of the key's verified sources.
- Off-key round 2 (https://duckduckgo.com/?q=NASA+June+2013+Voyager+1+has+not+yet+left+the+solar+system+Science+paper+site%3Anasa.gov&ia=web): A DuckDuckGo results page. Result listings carry no release date, no mechanism and no measurement text; those live only on the two official release pages. Useful as navigation, but the landing page itself is off-key.
- Off-key round 5 (https://duckduckgo.com/?q=news+nasas+voyager+craft+enters+interstellar+space+site%3Anasa.gov&ia=web): Another DuckDuckGo results page, produced when the composed nasa.gov URL was rewritten rather than opened; a SERP cannot carry the dated release text or the measurement detail this task requires.
- Off-key round 6 (https://duckduckgo.com/?q=NASA+Voyager+1+September+2013+enters+interstellar+space+plasma+wave+April+2013+Gurnett+site%3Anasa.gov&ia=web): A third DuckDuckGo results page and the second member of the 5-6 loop; no required fact of this task can be carried by a result listing.
- overrule round 5 → Acquisition without Progress: The mechanical label credited Progress because a previously unseen SERP state settled, but the round is the first member of the search loop 5-6: its navigate was rewritten into a search and round 6 searched again with nothing opened between. By the taxonomy a Search Loop member is Acquisition without Progress.
- flag (round 2): Round 2's DuckDuckGo results page is called off-key as a SERP, yet it is the step that led to the JPL release opened at round 3 — should a navigational SERP that immediately yields an on-key source be exempt from the off-key call?
- flag (round 5): Round 5 is overruled from Acquisition with Progress to without Progress as the first member of the 5-6 loop; a reviewer who counts only the second and later searches of a streak would leave the mechanical label standing and shrink the wasted share to 3 rounds.
- flag (round 6): Is the loop boundary right? Round 5's navigate was rewritten into a search by the app rather than chosen as one, so a reviewer could treat it as an attempted opening and decline to call 5-6 a loop.
- flag (round 11): Round 11 produced two rejected Evidence Checkpoints and nothing accepted — should it count as a failed round rather than bookkeeping, since every call in it was refused?
- flag (round 16): The verdict sits on the line: the attempt passed every check within 15 of 24 rounds, so a reviewer might read the off-key and loop rounds as tolerable overhead rather than decisive waste — though no other closed-set verdict fits a passing run with no failed rounds and no unsatisfied checks.
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:d3b4c5da…, $0.31

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/voyager-1-has-not-yet-left-the-solar-system-says-n… | 35680 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=NASA+June+2013+Voyager+1+has+not+yet+left+the+solar+sy… | 7798 | navigate: the settled page state moved to a page this Run had not acquired [unquoted, off-key] |
| 3 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 8409 | navigate: the settled page state moved to a page this Run had not acquired |
| 4 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 5851 | read_page: the first read of this page state |
| 5 | Acquisition with Progress → Acquisition without Progress | navigate | https://duckduckgo.com/?q=news+nasas+voyager+craft+enters+interstellar+space+sit… | 20968 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key, search loop, loop head by the streak rule] |
| 6 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=NASA+Voyager+1+September+2013+enters+interstellar+spac… | 8111 | navigate: a search after a search with nothing opened between them (streak 2) [off-key, search loop] |
| 7 | Acquisition with Progress | navigate | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 2532 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | read_page | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 5667 | read_page: the first read of this page state |
| 9 | Acquisition with Progress | look | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 7319 | look: the first Look at this page state with this question |
| 10 | Acquisition with Progress | navigate, look | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 7641 | look: the first Look at this page state with this question |
| 11 | Bookkeeping | record_evidence, record_evidence | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 51108 | record_evidence, record_evidence — 2 rejected Evidence Checkpoint(s) [2 rejected checkpoint] |
| 12 | Bookkeeping | record_evidence | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 13130 | record_evidence |
| 13 | Bookkeeping | record_evidence | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 8188 | record_evidence |
| 14 | Bookkeeping | record_candidate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 3622 | record_candidate |
| 15 | Bookkeeping | record_candidate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 6852 | record_candidate |
| 16 | Finalization | — | — | 44245 | the reserved Answer |

