# Round Audit — bingbong.live-web.information-hunts (fix-311-312-1)

Generated 2026-10-05T18:53:41.644Z from a capture set created 2026-10-05T17:42:09.400Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 2d2900e6; mode measured; protocol 1; prompt version(s) 1
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p4; audit run at commit 2d2900e6 (dirty tree)

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 58 | 53 | 53 | 1 | 40 (76%) | 6 (11%) | 1 (2%) | 5 (9%) | 1 (2%) | 5 (9%) |
| follow_up | 2 | 2 | 21 | 20 | 20 | 0 | 13 (65%) → 10 | 5 (25%) → 8 | 0 (0%) | 2 (10%) | 0 (0%) | 1 (5%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 1 | 1 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 0 | 1 | 0 |
| failed rounds | 0 | 0 | 0 | 0 |

- initial: 7 Off-key round(s), 2 Search Loop round(s) by the reviewer (2 by the streak rule, heads included: 1 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 3, replay 0, none 1; navigate searches by Search URL form q 8, param 0, path 1; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 2 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 2 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 1, 0 declined no_progress against the replay), 0 inherited, 1 rejected Evidence Checkpoint(s), 0 walled round(s), 3 navigate(s) landed on a Not-found Page (3 judged Off-key), 1 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 1 search(es) ran with an Unseen Phrase unquoted (1 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 6 Result Pick(s) against 4 listing(s) returned to the model, a search’s result opened in 1.6 round(s) on average (9 of 10 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 12 record_evidence call(s) by the model and 5 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 26 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 5 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 0 landing(s) that carried no page, 3 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 2 offered in 4 Answer(s), 2 accepted, 0 dropped, 0 Malformed Answer(s) (0 retried), 0 Off-language Answer(s), 3 sentence(s) spoken early (0 second utterance(s), 0 stood for an Answer not its own), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4860 ms, p90 7052 ms over 58 round(s), 4 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 0 answer omitted, 2 overrule(s), 18 flag(s); Finalization Causes: budget_exhausted 1, objective_met 3
- follow_up: 12 Off-key round(s), 2 Search Loop round(s) by the reviewer (2 by the streak rule, heads included: 1 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 1; navigate searches by Search URL form q 2, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 0 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 2 inherited, 1 rejected Evidence Checkpoint(s), 2 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 1 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (1 of 1 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 4 record_evidence call(s) by the model and 2 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 1 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 0 landing(s) that carried no page, 1 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped, 0 Malformed Answer(s) (0 retried), 0 Off-language Answer(s), 1 sentence(s) spoken early (0 second utterance(s), 0 stood for an Answer not its own), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4868 ms, p90 5502 ms over 21 round(s), 2 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 3 overrule(s), 7 flag(s); Finalization Causes: none 1, objective_met 1

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 0 | 4 of 4 | 0 |
| follow_up | 2 | 1 | 0 | 1 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 21 (40%) | 6 (30%) |
| scroll | 10 (19%) | 6 (30%) |
| read_page | 10 (19%) | 4 (20%) |
| record_evidence | 8 (15%) | 3 (15%) |
| report_run_plan | 4 (8%) | 2 (10%) |
| click | 2 (4%) | 1 (5%) |
| look | 2 (4%) | 0 |
| agent_results | 1 (2%) | 0 |
| new_session | 0 | 1 (5%) |
| spawn_agent | 1 (2%) | 0 |
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
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 |
| rule-eurostar-luggage | 1 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 1 | 0 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| compatibility-pi-camera (follow-up) | 1 | 0 | 1 | 1 (100%) | 0 | 0 (n/a) |
| historical-longitude-watch (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| rule-eurostar-luggage (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| rule-eurostar-luggage (follow-up) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| superseded-voyager-interstellar (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | objective_met | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | none | 1 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | budget_exhausted | 1 | 0 (0%) |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 11 of 24 Tool Rounds used; 12 orchestrator rounds, 1 in Finalization; Run duration 318721 ms; LLM stage 222416 ms over 12 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 26 Subagent round(s) over 2 Subagent(s), stopped by budget_exhausted 2; 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 5 while running (round 3, 4, 5, 6, 7), 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.85 against the declared investigation (agrees); garbled 0.03
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 12: 15.5 s after its start, 20.9 s before its end, ended answer
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 4 declared; Answer standings 4 stated, 0 unverified; 0 shape failure(s) (0 retried)
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
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 4; bookkeeping-only rounds: 3
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: no search
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 5 (46%) · Acquisition without Progress 2 (18%) · Collection 1 (9%) · Bookkeeping 3 (27%) · Failed round 0 (0%) · Finalization 1 (8%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 3 (round 9, 10, 11)
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: rounds wasted** — No search was issued, so there was no loop, and every Acquisition landed on https://www.raspberrypi.com/documentation/computers/camera_software.html or https://www.raspberrypi.com/documentation/accessories/camera.html — both verified sources for this key, so nothing was Off-key. What the budget did lose is small: round 7 re-issued the identical part 1 read of the accessories/camera.html state already read in round 6 and drew the no_progress_notice, and three of 11 budgeted rounds (9, 10, 11) went to bookkeeping alone, with the app itself noting at rounds 10 and 11 that the preceding round had recorded only checkpoints. That is the only admissible characterisation here: the Run was not ended by the tier (11 of 24 Tool Rounds used, stop reason terminal on objective_met), there were no failed rounds, and the Grade is a pass with no unsatisfied checks, so neither stopped_early nor answer_omitted is available. The waste is roughly 1 of 11 rounds plus the bookkeeping clustering, not a pattern that cost the attempt its result.
- stopped early: no — The Grade records no unsatisfied checks, so there is no check to attribute to a page the Run had not read.
- answer omitted: no — The Grade records no unsatisfied checks, so nothing was left unstated for this judgement to rest on.
- overrule round 6 → Acquisition with Progress: The app marked this a repeat because the page signature b92dddfb at https://www.raspberrypi.com/documentation/accessories/camera.html was unchanged, but round 5 read part 2 of that page and round 6 read part 1 — a segment of the document not previously put in front of the assistant. New material arrived, so this is Acquisition with Progress. Round 7, which repeats the identical part 1 call on the same signature, remains without Progress.
- flag (round 6): Round 6 read part 1 of a page state whose part 2 was read in round 5 under an unchanged signature — I counted the new part as Progress and overruled the mechanical repeat label; a reviewer treating the page state, not the part, as the unit of observation would leave it as Acquisition without Progress and read rounds 6 and 7 as two wasted rounds.
- flag (round 7): The verdict is on the line: with a pass, no Off-key page, no search loop and no failed round, rounds_wasted rests on a single repeat read at round 7 and on three bookkeeping-only rounds (9, 10, 11); a reviewer might judge that too thin to name any fault from the closed set.
- flag (round 11): Rounds 9, 10 and 11 each spent a full round on record_evidence with no acquisition alongside, and the app flagged this twice — is that bookkeeping clustering waste of the budget, or warranted grounding of the four accepted checkpoints?
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:81255941…, $0.23

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 23082 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition with Progress | spawn_agent, spawn_agent | https://www.raspberrypi.com/documentation/computers/camera_software.html | 16552 | spawn_agent: delegated a Subagent |
| 3 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3812 | read_page: the first read of this page state |
| 4 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 5605 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 3453 | read_page: the first read of this page state |
| 6 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 8552 | read_page: a repeat read of a page state already read |
| 7 | Acquisition without Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 18434 | read_page: a repeat read of a page state already read |
| 8 | Collection | agent_results | https://www.raspberrypi.com/documentation/accessories/camera.html | 19618 | read a finished Subagent Report |
| 9 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 69482 | record_evidence |
| 10 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 8311 | record_evidence, record_evidence |
| 11 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 9129 | record_evidence |
| 12 | Finalization | — | — | 36386 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- no_answer; ended reset; tier investigation; 17 of 24 Tool Rounds used; 17 orchestrator rounds, 0 in Finalization; Run duration 220022 ms; LLM stage 211737 ms over 17 joined round(s)
- grade unsuccessful; checks unsatisfied: fact-01, fact-02, fact-03 (3 of 6)
- verified, or failing only on unasked facts: neither
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 1 inherited round(s); 1 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 2 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.67 against the declared investigation (agrees); garbled 0.05
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 0 (0 second utterance(s), 0 stood for an Answer not its own)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; no standings on the Answer; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 1 (round 5)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 3; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 12 (71%) · Acquisition without Progress 4 (24%) · Collection 0 (0%) · Bookkeeping 1 (6%) · Failed round 0 (0%) · Finalization 0 (0%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 2, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 0
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 0 offered in 0 Answer(s), 0 accepted, 0 dropped
- **verdict: answer omitted** — All three unsatisfied checks (fact-01, fact-02, fact-03) were answerable from the single page read at rounds 1-3, whose material was accepted as Evidence at round 4 alongside the user's constraint at round 5; nothing after round 4 was needed and none of the three reached the Answer. With 17 of 24 Tool Rounds used and no Finalization round, the material in hand at round 4 went unstated.
- secondary: rounds wasted — After round 4 the budget produced nothing on-key: rounds 5 and 7 form a Search Loop, round 6 and round 7's Result Pick both landed on walls, and rounds 8-16 (9 rounds) sat on the Pimoroni retail listing, 6 of them scrolls through product photographs ending in End of Page at round 16. Counting the overrules, 12 of the 17 budgeted rounds were Off-key and 7 made no Progress, and round 17 spent the run's end on a session reset rather than an Answer.
- stopped early: no — Each unsatisfied check (fact-01, fact-02, fact-03) follows from material on a page the Run had already read — https://www.raspberrypi.com/documentation/accessories/camera.html, navigated at round 1 and read at rounds 2-3, with the relevant mechanical excerpt accepted as Evidence at round 4. No unsatisfied check required a page the Run had not read, so the end state (reset at round 17 with budget and time left) is not an early stop under the definition.
- answer omitted: yes (fact-01, fact-02, fact-03) — The Run read https://www.raspberrypi.com/documentation/accessories/camera.html at rounds 1-3 and checkpointed its mechanical material at round 4 (accepted), and at round 5 it also recorded the user's added constraint verbatim. fact-02 sits directly on that page; fact-01 is the verdict that page's material settles against the recorded constraint; fact-03 rests on the initial run's electrical and software conclusions, which this Run carried in and re-acquired on the same documentation page at round 1. None of the three was stated, so all three are omissions rather than missing pages.
- Search Loop over rounds 5, 7: Round 5 issued a DuckDuckGo url-search and round 7 issued another, reworded DuckDuckGo search. The only call between them, round 6's navigate to https://forums.raspberrypi.com/viewtopic.php?t=395459, landed on a wall marked on the call ('Just a moment...' challenge for forums.raspberrypi.com), which puts nothing new in front of the assistant and therefore does not end a loop; the app's own counter agreed (streak 2 and search_loop_nudge at round 7). Round 7's Result Pick also opened a walled thread (viewtopic.php?t=351302), so nothing was acquired inside the loop either.
- Off-key round 5 (https://duckduckgo.com/?q=camera+module+3+raspberry+pi+zero+case+lid+does+not+fit&ia=web): A search engine results page; it carries no required fact of this task, only links.
- Off-key round 6 (https://forums.raspberrypi.com/viewtopic.php?t=395459): The landing was an anti-bot challenge page titled 'Just a moment...' (wall marked on the call); no thread content was rendered, so the round could carry nothing.
- Off-key round 7 (https://forums.raspberrypi.com/viewtopic.php?t=351302): A search results page whose Result Pick again resolved to a walled 'Just a moment...' challenge on forums.raspberrypi.com; neither surface can carry a required fact.
- Off-key round 8 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): A retailer product listing for the case. The task's required facts are the compatibility verdict, the official mechanical reason from the documentation, and the unchanged electrical/software conclusions; a shop listing for the enclosure carries none of them.
- Off-key round 9 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Same retailer listing; the click only changed the page signature within the shop page, which can carry no required fact.
- Off-key round 10 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Read of the same retailer listing; the page's subject is the enclosure for sale, not the mechanical or software compatibility facts this task requires.
- Off-key round 11 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Scroll of the retailer listing surfacing shop navigation and review links; no required fact available here.
- Off-key round 12 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Scroll surfacing product photograph CDN links on the retailer listing; no required fact available here.
- Off-key round 13 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Scroll surfacing a further product photograph link only.
- Off-key round 14 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Scroll surfacing further product photograph links only.
- Off-key round 15 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Scroll surfacing the quantity input and the 'Add to cart' button — commerce furniture, carrying no required fact.
- Off-key round 16 (https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412700874): Scroll that answered End of Page on the same retailer listing; nothing on this page can carry a required fact.
- overrule round 5 → Acquisition without Progress: The round's navigate was the first member of the Search Loop found at rounds 5 and 7; a loop member is acquisition without progress, and the page acquired was only a results list.
- overrule round 6 → Acquisition without Progress: Labelled as moving to a page the Run had not acquired, but the digest marks the landing as walled ('challenge forums.raspberrypi.com', title 'Just a moment...'); the call put no new material in front of the assistant, and the app itself did not let it break the search streak.
- overrule round 17 → Acquisition without Progress: new_session is labelled a requested state change with progress, but it opened no page and brought in no material — end_reason=reset discarded the session state while 7 Tool Rounds of the 24 budget remained, so no new material reached the assistant.
- flag (round 6): Round 6 navigated to a forum thread the Run had not visited; a reviewer who treats that landing as an opening rather than a wall would break the streak and find no loop at rounds 5 and 7 — is the walled 'Just a moment...' landing rightly read as putting nothing in front of the assistant?
- flag (round 8): Is the Pimoroni listing for the official Pi Zero Case rightly Off-key? Its description concerns the very enclosure and camera lid the new constraint names, so a reviewer could call rounds 8-10 on-key context even though the required facts come from the official documentation.
- flag (round 17): Is the overrule of round 17 correct — new_session is a requested state change the app reports as progress, but it acquired no page and reset the session; a reviewer might leave the mechanical label or treat the terminal reset as a failed round instead.
- flag (round 5): Round 5 is overruled to acquisition_without_progress as the first member of the loop; a reviewer who counts only the second and later searches of a streak as loop members would leave its mechanical label as progress.
- flag (round 4): Is answer_omitted the decisive primary rather than rounds_wasted? The facts were in hand by round 4, but 12 of 17 rounds were Off-key and the run ended in a reset with 7 rounds unspent, which a reviewer could find the more decisive failure.
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:60ed0382…, $0.40

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 14355 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 7297 | read_page: the first read of this page state |
| 3 | Acquisition without Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 5028 | read_page: a repeat read of a page state already read |
| 4 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 11027 | record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 5 | Acquisition with Progress → Acquisition without Progress | record_evidence, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 22508 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 6 | Acquisition with Progress → Acquisition without Progress | navigate | https://forums.raspberrypi.com/viewtopic.php?t=395459 | 3568 | navigate: the settled page state moved to a page this Run had not acquired [walled, off-key] |
| 7 | Acquisition without Progress | navigate | https://forums.raspberrypi.com/viewtopic.php?t=351302 | 10513 | navigate: a search after a search with nothing opened between them (streak 2) [walled, result pick, off-key, search loop] |
| 8 | Acquisition with Progress | navigate | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 29805 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 9 | Acquisition with Progress | click | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 7198 | click: the settled page state moved [off-key] |
| 10 | Acquisition with Progress | read_page | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 3403 | read_page: the first read of this page state [off-key] |
| 11 | Acquisition with Progress | scroll | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 4660 | scroll: the scroll brought new material into view [off-key] |
| 12 | Acquisition with Progress | scroll | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 10333 | scroll: the scroll brought new material into view [off-key] |
| 13 | Acquisition with Progress | scroll | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 6279 | scroll: the scroll brought new material into view [off-key] |
| 14 | Acquisition with Progress | scroll | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 3367 | scroll: the scroll brought new material into view [off-key] |
| 15 | Acquisition with Progress | scroll | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 1755 | scroll: the scroll brought new material into view [off-key] |
| 16 | Acquisition without Progress | scroll | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 3482 | scroll: a scroll that answered End of Page [off-key] |
| 17 | Acquisition with Progress → Acquisition without Progress | new_session | https://shop.pimoroni.com/products/official-raspberry-pi-zero-case?variant=39412… | 67159 | new_session: a requested state change |

### historical-longitude-watch--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 6 of 24 Tool Rounds used; 7 orchestrator rounds, 1 in Finalization; Run duration 101682 ms; LLM stage 81824 ms over 7 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.06
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 7: 22.5 s after its start, 15.9 s before its end, ended answer
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
- Result Picks: 1 (round 6); listings returned to the model: 1 (round 2)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 0; bookkeeping-only rounds: 0
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 4, 1
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 6 (100%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 0 (0%) · Finalization 1 (14%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 0, param 0, path 1
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 1 (round 2); showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 0
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 2 offered in 1 Answer(s), 2 accepted, 0 dropped
- **verdict: rounds wasted** — Nothing in the closed set fits an attempt that passed every check, so the verdict falls on the only inefficiency present, and it is small: 1 of 6 budgeted rounds (round 1, about 17%) went to a malformed navigate that settled on a generic collection results listing carrying none of the key's required facts. The other 5 rounds all made Progress - rounds 2 to 4 surfaced the H4 result link, round 5 opened https://www.rmg.co.uk/collections/objects/rmgc-object-79142 and round 6 opened https://www.rmg.co.uk/collections/objects/rmgc-object-256323, the two records the key verifies - with no Search Loops, no repeats and no failed rounds, and the Run closed in 6 of 24 Tool Rounds.
- stopped early: no — The Grade is a pass with no unsatisfied checks, so there is no check to attribute to a page the Run had not read; Early Stop cannot arise.
- answer omitted: no — No checks are listed as unsatisfied, so nothing readable on a page the Run had read was left unstated by the Answer.
- Off-key round 1 (https://www.rmg.co.uk/collections/objects-research%20search%20Harrison%20timekeeper%20H4): The navigate concatenated free text onto the path, so the address settled on a generic "Collection Results | Royal Museums Greenwich" listing rather than on any object record. A bare collection results page holds no record fields and so can carry none of this task's required facts, which live on the two object records reached later (rmgc-object-79142 and rmgc-object-256323). Borderline, since the landing did supply the search field typed into in round 2.
- flag (round 1): Round 1's malformed navigate is called Off-key because it settled on a generic Collection Results page; should it instead count as an on-key entry step, given the page it reached supplied the search field used in round 2?
- flag (round 2): Rounds 2 to 4 all sit on the same search results listing rather than on a record; should they be called Off-key by the same reading applied to round 1, or does surfacing the H4 record link keep them on-key?
- flag (round 6): Round 6 is a URL the app treated as a search whose Result Pick opened the case record; is it rightly one Acquisition with Progress rather than a search counted apart from the opening?
- flag: The verdict sits on the line: with a pass, no unsatisfied checks, no loops and 6 of 24 rounds used, naming rounds_wasted on the strength of a single round may overstate the fault, and another reviewer might pick a different member of the closed set.
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:1c9a7cd8…, $0.22

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects-research%20search%20Harrison%20timekee… | 12883 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/objects-research%20search%20Harrison%20timekee… | 10256 | type: the settled page state moved |
| 3 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects-research%20search%20Harrison%20timekee… | 4609 | scroll: the scroll brought new material into view |
| 4 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects-research%20search%20Harrison%20timekee… | 3822 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 6101 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 5823 | navigate: the settled page state moved to a page this Run had not acquired [result pick] |
| 7 | Finalization | — | — | 38330 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 12 of 24 Tool Rounds used; 13 orchestrator rounds, 1 in Finalization; Run duration 216097 ms; LLM stage 200466 ms over 13 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.73 against the declared investigation (agrees); garbled 0.04
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 13: 29.9 s after its start, 15.6 s before its end, ended answer
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 5 declared; Answer standings 5 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 1 (round 2)
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 3 (round 2, 5, 7); listings returned to the model: 0
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 4; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 1, 1, 1
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 9 (75%) · Acquisition without Progress 1 (8%) · Collection 0 (0%) · Bookkeeping 1 (8%) · Failed round 1 (8%) · Finalization 1 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 3, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 1 (round 10); showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 0
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: rounds wasted** — Nothing in the closed set describes a cheap pass well, so the only applicable finding is the small slice of rounds that returned nothing: of 12 budgeted rounds, round 1's navigate landed on a Not-found page (https://www.eurostar.com/rail-help/luggage, off-key) and round 8 was a failed round whose only call, a click on a stale ref, was refused on https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on-Eurostar — 2 of 12 rounds (~17%), plus one rejected Evidence Checkpoint beside round 7. The remaining 9 acquisition rounds were on-key and productive (rounds 2–6 on the two verified Eurostar pages, rounds 9–12 on the Help Centre luggage FAQ), there were no Search Loops, and the Run finished at 12 of 24 Tool Rounds with budget and time to spare, so no tier, budget, stop-early or omission finding applies.
- stopped early: no — The Grade records no unsatisfied checks, so there is no check to attribute to an unread page.
- answer omitted: no — The Grade records no unsatisfied checks, so nothing was left unstated for this judgement to name.
- Off-key round 1 (https://www.eurostar.com/rail-help/luggage): The composed address resolved to a Not-found page ("Sorry, we can’t find the page you’re looking for. | Eurostar"); a 404 shell carries no allowance, length or instrument policy text, so this landing could carry none of the task's required facts.
- flag (round 1): Round 1 pairs report_run_plan with a guessed address that 404'd — should that round read as bookkeeping with an incidental failed navigate rather than an off-key acquisition?
- flag (round 9): Round 9 opened https://help.eurostar.com/faq/uk-en/category/luggage, a Help Centre category index of FAQ links rather than a policy page — a reviewer could call that landing off-key even though it was the step that reached the FAQ read in rounds 10 and 12.
- flag (round 2): Round 2's address was rewritten into a site search whose Result Pick opened the main luggage page; with rounds 5 and 7 also running as address-shaped searches, is the rewritten call correctly excluded from Search Loop counting?
- flag (round 7): Rounds 5 and 7 are consecutive searches of one intent (instrument rules) with only a page read between the search calls — each search's own Result Pick opened a page not previously acquired, which is why no loop is recorded; a reviewer weighing the reads instead could see a loop boundary here.
- flag (round 8): Round 8 was the attempt's only failed round and it cost a round without costing the result — is rounds_wasted the right primary over failed_rounds for a passing attempt?
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:d46f9da9…, $0.17

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/rail-help/luggage | 12151 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2927 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, result pick] |
| 3 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 3427 | read_page: the first read of this page state |
| 4 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 14394 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5066 | navigate: the settled page state moved to a page this Run had not acquired [result pick] |
| 6 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 9983 | read_page: the first read of this page state |
| 7 | Acquisition with Progress | record_evidence, record_evidence, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 26022 | navigate: the settled page state moved to a page this Run had not acquired [result pick, 1 rejected checkpoint] |
| 8 | Failed round | click ✗ | https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on… | 7466 | every call was refused (click) |
| 9 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/category/luggage | 7558 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Acquisition with Progress | click | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 1586 | click: the settled page state moved |
| 11 | Bookkeeping | record_evidence, record_evidence | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 50751 | record_evidence, record_evidence |
| 12 | Acquisition with Progress | read_page | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 13604 | read_page: the first read of this page state |
| 13 | Finalization | — | — | 45531 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 3 of 12 Tool Rounds used; 4 orchestrator rounds, 1 in Finalization; Run duration 84508 ms; LLM stage 83056 ms over 4 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: lookup at 0.76 against the declared lookup (agrees); garbled 0.10
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 4: 35.6 s after its start, 6.5 s before its end, ended answer
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 1 declared; Answer standings 1 stated, 0 unverified; 0 shape failure(s) (0 retried)
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
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 1; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: no search
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (33%) · Acquisition without Progress 1 (33%) · Collection 0 (0%) · Bookkeeping 1 (33%) · Failed round 0 (0%) · Finalization 1 (25%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 1 (round 3)
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: rounds wasted** — Nothing in the closed set fits an efficient pass, so the only chargeable share is the one budgeted round without Progress: round 1's navigate to https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, marked a re-acquisition of a page already checkpointed by the inherited initial attempt — 1 of 3 budgeted rounds (33%), against 1 Acquisition with Progress (round 2) and 1 bookkeeping round (round 3). There were no searches, hence no loops, no Off-key pages (rounds 1 and 2 both sat on the verified source for this task), and no failed rounds. The waste is nominal: 3 of a 12-round budget were used, the run closed in 84.5 s, and the Grade is a pass, so this verdict names a technicality rather than a defect.
- stopped early: no — The Grade records a pass with no unsatisfied checks, so there is no check to attribute to a page the Run had not read; the question of ending with budget left does not arise.
- answer omitted: no — No check is listed as unsatisfied, so nothing supported by a page the Run read was left unstated in the Answer.
- flag (round 1): Round 1: should the navigate be read as Acquisition with Progress rather than a re-acquisition? The page had only been acquired by the inherited initial attempt, not by this Run, and the navigate was the step that put the page in front of the assistant for round 2's first read of that state.
- flag (round 1): Is rounds_wasted the right primary at all for a 3-round pass with 9 rounds of budget unused? A careful reviewer might hold that no verdict in the closed set describes this attempt and choose differently, since the single non-productive round was a prerequisite for the productive read.
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:b0144d65…, $0.14

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 11783 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5513 | read_page: the first read of this page state |
| 3 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 23681 | record_evidence |
| 4 | Finalization | — | — | 42079 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / completed (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 225400 ms; LLM stage 192784 ms over 26 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.05
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 0 (0 second utterance(s), 0 stood for an Answer not its own)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 7 declared; Answer standings 7 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 2 (round 1, 22)
- of those, judged Off-key by the reviewer: 2
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 1 (round 2)
- of those, judged Off-key by the reviewer: 1
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 2 (round 3, 7); listings returned to the model: 3 (round 2, 12, 23)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 4; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: none, 1, 1, 2, 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 20 (83%) · Acquisition without Progress 3 (13%) · Collection 0 (0%) · Bookkeeping 1 (4%) · Failed round 0 (0%) · Finalization 2 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 5, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; declined at the budget: no_tier_above (after round 24, replay: Progress)
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 0
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: rounds wasted** — Roughly a third of the 24 budgeted rounds returned nothing usable: two guessed-slug Not-found landings (rounds 1 and 22), the two-search loop at rounds 2-3, three Off-key search-results pages (rounds 2, 12, 23), and a seven-round scroll walk down one page (rounds 15-21) whose rounds 19-21 surfaced only closing quotes and mission boilerplate after the substantive passages had appeared by round 18. The mechanical tally shows only 3 rounds without Progress, but the Off-key and loop judgements place 6 rounds plus 3 low-yield scrolls in the waste column, which is why the Run hit the budget wall at round 24 while still chasing a publication-date confirmation (rounds 22-24).
- secondary: tier too small or never escalated — The rest of the budget was on-key and productive - the two official accounts at https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/ (rounds 3-5) and https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-into-interstellar-space/ (rounds 13-21), the JPL explainer at https://www.jpl.nasa.gov/news/how-do-we-know-when-voyager-reaches-interstellar-space/ (rounds 7-9), and the dated republications at https://www.sciencedaily.com/releases/2013/06/130627140803.htm (round 6) and https://www.sciencedaily.com/releases/2013/09/130912135507.htm (round 24) - and the Run was still acquiring when the investigation tier's 24 rounds ran out with no Tier Escalation, pushing the last record_evidence and the Answer into Finalization at rounds 25-26.
- stopped early: no — The attempt ran to its budget (24 of 24 Tool Rounds, ended budget_exhausted), so it did not stop early; and the Grade lists no unsatisfied check.
- answer omitted: no — Grade is pass with no unsatisfied checks, so there is no check to attribute to material on a page the Run had read but left unstated.
- Search Loop over rounds 2, 3: Round 2's navigate argument was a bare query the app ran as a search (marked search, streak 1), and its own DuckDuckGo results page was the only thing put in front of the assistant; round 3 then issued a second search URL with nothing opened between them - no page, no user answer, no Subagent Report. Two searches in a row with nothing new in front of the assistant is a loop; it ends after round 3, whose Result Pick opened https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/.
- Off-key round 1 (https://www.jpl.nasa.gov/news/nasas-voyager-1-has-not-yet-left-the-solar-system-says-new-paper/): Guessed JPL slug that resolved to a Not-found page (title '404 - Page not found'); a 404 shell carries no required fact of this task, right site or not.
- Off-key round 2 (https://duckduckgo.com/?q=NASA+JPL+Voyager+1+has+not+yet+left+the+solar+system+June+2013+new+paper+Science&ia=web): A DuckDuckGo results listing was the only thing put in front of the assistant, and the app reported the quoted phrase stripped so the listing was generic; a search results page can carry none of this task's required facts.
- Off-key round 12 (https://duckduckgo.com/?q=%22NASA+Spacecraft+Embarks+on+Historic+Journey+Into+Interstellar+Space%22+sciencedaily&ia=web): Search results page with no Result Pick; the settled state was the listing itself, which carries no required fact. Borderline in that it was a cheap hop toward the release opened at round 13.
- Off-key round 22 (https://www.sciencedaily.com/releases/2013/09/130912151915.htm): Guessed ScienceDaily release id that returned '404 Not Found'; an error page carries nothing.
- Off-key round 23 (https://duckduckgo.com/?q=sciencedaily.com+releases+2013+09+Voyager+1+embarks+historic+journey+interstellar&ia=web): Search results page only; no required fact sits on a results listing, though it did supply the correct address opened at round 24.
- overrule round 2 → Acquisition without Progress: Labelled with Progress for moving the settled state to a page the Run had not acquired, but that page was the search's own results listing, and round 2 is the first of the two-search loop at rounds 2-3; a loop member is Acquisition without Progress. The app's streak counter only flagged the second search.
- flag (round 3): Round 3's search carried a Result Pick that opened the key June account at https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/, a page the Run had not acquired - should it keep the no-Progress label as a loop member, or be read as Acquisition with Progress?
- flag (round 2): Round 2's navigate argument was a phrase rather than an address and the app reported it rewritten before running it; a reviewer who treats that as a rewritten address rather than a search of the loop would find no loop at rounds 2-3 and would leave the with-Progress label standing.
- flag (round 12): Is an Off-key call fair on a search-results page that was the direct route to the release opened in the very next round?
- flag (round 23): Same borderline as round 12: the results listing carried no fact itself but yielded the exact ScienceDaily address opened at round 24.
- flag (round 19): Rounds 19-21 each counted as Progress for bringing new viewport text, but that text was quotations and mission background on an already-read page - a reviewer might count them productive rather than waste, which would soften the rounds_wasted share.
- flag (round 24): The attempt passed with every check satisfied and ran to budget; a reviewer might make tier_too_small_or_never_escalated the primary verdict and rounds_wasted the secondary.
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:a276e273…, $0.50

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-has-not-yet-left-the-solar-system-… | 19579 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress → Acquisition without Progress | navigate | https://duckduckgo.com/?q=NASA+JPL+Voyager+1+has+not+yet+left+the+solar+system+J… | 3885 | navigate: the settled page state moved to a page this Run had not acquired [unquoted, off-key, search loop, loop head by the streak rule] |
| 3 | Acquisition without Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 5156 | navigate: a search after a search with nothing opened between them (streak 2) [result pick, search loop] |
| 4 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 2179 | read_page: the first read of this page state |
| 5 | Acquisition with Progress | look, record_evidence | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 16650 | look: the first Look at this page state with this question |
| 6 | Acquisition with Progress | navigate | https://www.sciencedaily.com/releases/2013/06/130627140803.htm | 7562 | navigate: the settled page state moved to a page this Run had not acquired |
| 7 | Acquisition with Progress | record_evidence, navigate | https://www.sciencedaily.com/releases/2013/06/130627140803.htm | 6746 | navigate: the settled page state moved to a page this Run had not acquired [result pick] |
| 8 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/how-do-we-know-when-voyager-reaches-interstellar-s… | 9831 | read_page: the first read of this page state |
| 9 | Bookkeeping | record_evidence | https://www.jpl.nasa.gov/news/how-do-we-know-when-voyager-reaches-interstellar-s… | 14405 | record_evidence |
| 10 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 5400 | navigate: the settled page state moved to a page this Run had not acquired |
| 11 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 4656 | read_page: the first read of this page state |
| 12 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=%22NASA+Spacecraft+Embarks+on+Historic+Journey+Into+In… | 12997 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 13 | Acquisition with Progress | navigate | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4148 | navigate: the settled page state moved to a page this Run had not acquired |
| 14 | Acquisition with Progress | look | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 5763 | look: the first Look at this page state with this question |
| 15 | Acquisition with Progress | scroll | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4821 | scroll: the scroll brought new material into view |
| 16 | Acquisition with Progress | scroll | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4118 | scroll: the scroll brought new material into view |
| 17 | Acquisition with Progress | scroll | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4088 | scroll: the scroll brought new material into view |
| 18 | Acquisition with Progress | scroll | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4108 | scroll: the scroll brought new material into view |
| 19 | Acquisition with Progress | scroll | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4193 | scroll: the scroll brought new material into view |
| 20 | Acquisition with Progress | scroll | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4480 | scroll: the scroll brought new material into view |
| 21 | Acquisition with Progress | scroll | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 5750 | scroll: the scroll brought new material into view |
| 22 | Acquisition without Progress | navigate | https://www.sciencedaily.com/releases/2013/09/130912151915.htm | 5680 | navigate: landed on a Not-found Page [not found, off-key] |
| 23 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=sciencedaily.com+releases+2013+09+Voyager+1+embarks+hi… | 4465 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 24 | Acquisition with Progress | navigate | https://www.sciencedaily.com/releases/2013/09/130912135507.htm | 6346 | navigate: the settled page state moved to a page this Run had not acquired |
| 25 | Finalization | record_evidence | https://www.sciencedaily.com/releases/2013/09/130912135507.htm | 8362 | the bookkeeping round (record_evidence) |
| 26 | Finalization | — | — | 17416 | the reserved Answer |

