# Round Audit — bingbong.live-web.information-hunts (fix-281-1)

Generated 2026-09-28T00:52:17.595Z from a capture set created 2026-09-27T14:51:12.727Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 77a74319; mode measured; protocol 1; prompt version(s) 1
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p3; audit run at commit 303df947

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 74 | 69 | 67 | 1 | 45 (65%) → 46 | 11 (16%) → 10 | 0 (0%) | 10 (14%) | 3 (4%) | 5 (7%) |
| follow_up | 2 | 2 | 15 | 13 | 13 | 0 | 6 (46%) | 4 (31%) | 0 (0%) | 3 (23%) | 0 (0%) | 2 (13%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 3 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 19 Off-key round(s), 5 Search Loop round(s) by the reviewer (5 by the streak rule, heads included: 3 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 3, replay 0, none 1; navigate searches by Search URL form q 9, param 0, path 4; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 2 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 2 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 2, 0 declined no_progress against the replay), 0 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 2 navigate(s) landed on a Not-found Page (2 judged Off-key), 2 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 2 search(es) ran with an Unseen Phrase unquoted (2 judged Off-key), 1 search(es) ran on the Run Engine in place of another Web Engine (1 judged Off-key), 1 Result Pick(s) against 13 listing(s) returned to the model, a search’s result opened in 2.5 round(s) on average (10 of 14 searches), 6 Run-made Evidence Checkpoint(s) from a Selected Passage (6 recorded again by the model from the same page, 5 with the same passage) against 13 record_evidence call(s) by the model and 10 bookkeeping-only round(s), of 6 Run-made Evidence Checkpoint(s), 6 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 4 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 5 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 1 Answer(s) with an Identity Slip, 4 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 2 Malformed Answer(s) (1 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5098 ms, p90 8252 ms over 74 round(s), 4 declared Asked Items (3 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 7 overrule(s), 22 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 1, model_answered 1, objective_met 1
- follow_up: 3 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 1; navigate searches by Search URL form q 1, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 3 inherited, 0 rejected Evidence Checkpoint(s), 1 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 1 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (1 of 1 searches), 1 Run-made Evidence Checkpoint(s) from a Selected Passage (1 recorded again by the model from the same page, 1 with the same passage) against 5 record_evidence call(s) by the model and 3 bookkeeping-only round(s), of 1 Run-made Evidence Checkpoint(s), 1 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 3 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 Malformed Answer(s) (0 retried), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5583 ms, p90 13638 ms over 15 round(s), 2 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 0 answer omitted, 2 overrule(s), 7 flag(s); Finalization Causes: objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 28 (42%) | 5 (38%) |
| read_page | 18 (27%) | 4 (31%) |
| record_evidence | 10 (15%) | 4 (31%) |
| scroll | 9 (13%) | 0 |
| record_candidate | 5 (7%) | 3 (23%) |
| report_run_plan | 4 (6%) | 2 (15%) |
| click | 0 | 1 (8%) |
| look | 1 (1%) | 0 |
| type | 1 (1%) | 0 |

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
| compatibility-pi-camera | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 |
| rule-eurostar-luggage | 1 | 0 | 0 |
| superseded-voyager-interstellar | 1 | 2 | 1 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 1 | 1 | 0 | 0 (n/a) | 0 | 0 (n/a) |
| compatibility-pi-camera (follow-up) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| historical-longitude-watch (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| rule-eurostar-luggage (initial) | 1 | 0 | 1 | 0 (0%) | 0 | 0 (n/a) |
| rule-eurostar-luggage (follow-up) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| superseded-voyager-interstellar (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (follow-up) | objective_met | 1 | 0 (0%) |
| historical-longitude-watch (initial) | budget_exhausted | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | model_answered | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | deadline_reached | 1 | 0 (0%) |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (objective_met); tier investigation (1 Tier Escalation(s): 1 at the deadline); 11 Tool Rounds used over 2 tier epochs, the last budgeted 21; 12 orchestrator rounds, 1 in Finalization; Run duration 186659 ms; LLM stage 183018 ms over 12 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 1 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: unavailable (timeout)
- Malformed Answers: 0 (0 retried)
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
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 3; bookkeeping-only rounds: 3
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 1 (round 9)
- rounds from a search to an opened result: no search
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 4 (36%) · Acquisition without Progress 4 (36%) · Collection 0 (0%) · Bookkeeping 3 (27%) · Failed round 0 (0%) · Finalization 1 (8%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: deadline arm after round 11, replay: no judged call; none declined
- **verdict: rounds wasted** — stopped_early, answer_omitted and failed_rounds are all excluded (pass, no unsatisfied checks, 0 failed rounds), and the budget was never reached (11 of 21 Tool Rounds used, Run ended objective_met), so neither tier_too_small nor budget_too_small applies. The only cost visible in the digest is rounds that acquired nothing: rounds 9, 10 and 11 carried bookkeeping alone, 3 of 11 budgeted rounds (27%), and rounds 10 and 11 were two separate rounds to create and then accept the single candidate memory-4 on Evidence already held, which the app itself flagged at round 10. After the four overrules above, 8 of 11 rounds were on-key Acquisition with Progress on the two verified documentation URLs, so the waste is confined to that closing ceremony and did not cost the result.
- stopped early: no — The Grade is pass with no unsatisfied checks, so there is no check to attribute to a page the Run had not read; the Run also closed itself as objective_met rather than on exhaustion.
- answer omitted: no — No unsatisfied checks are listed for this attempt, so nothing carried by a page the Run had read was left unstated in the Answer.
- overrule round 3 → Acquisition with Progress: Labelled a repeat read because the page signature was unchanged, but the call was read_page part 3 on https://www.raspberrypi.com/documentation/accessories/camera.html, a 27163px page whose part 2 had been read in round 2; a different segment of one long document puts text in front of the assistant that had not been read, and the Evidence recorded in round 5 from this URL rests on the connector NOTE these part reads surfaced.
- overrule round 4 → Acquisition with Progress: read_page part 1 on https://www.raspberrypi.com/documentation/accessories/camera.html is a segment not previously read (rounds 2 and 3 took parts 2 and 3); the same-signature rule mislabels pagination within one long page as re-observation of an already observed state.
- overrule round 7 → Acquisition with Progress: read_page part 2 on https://www.raspberrypi.com/documentation/computers/camera_software.html (83957px, part 1 read in round 6) brought a further segment of that page in, rather than repeating a state already observed.
- overrule round 8 → Acquisition with Progress: read_page part 7 of https://www.raspberrypi.com/documentation/computers/camera_software.html reached a section far from parts 1-2; the Evidence recorded in round 9 (the autofocus-mode option text) is grounded in material only this read could have surfaced, so the round did bring new material in.
- flag (round 3): Should read_page with a new part index on an unchanged page signature (rounds 3, 4, 7, 8) count as Progress, as overruled here, or do the repeated part reads on one URL stand as repeat observations as the app labelled them?
- flag (round 11): Is rounds_wasted the right primary for a passing attempt whose only non-acquiring rounds were bookkeeping, or should the closed set be read as having no fitting label when the Run passed well inside budget with no loops and no Off-key pages?
- flag (round 9): Round 9 recorded Evidence and made no other call while a budget warning was live, and the product page S1 was never visited at all; is that round waste, or necessary consolidation given the Grade passed?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:f83e4fb4…, $0.28

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 21928 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 7427 | read_page: the first read of this page state |
| 3 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 4467 | read_page: a repeat read of a page state already read |
| 4 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 3324 | read_page: a repeat read of a page state already read |
| 5 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 15016 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 13991 | read_page: the first read of this page state |
| 7 | Acquisition without Progress → Acquisition with Progress | record_evidence, read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 28381 | read_page: a repeat read of a page state already read |
| 8 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 10314 | read_page: a repeat read of a page state already read |
| 9 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 23769 | record_evidence |
| 10 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6039 | record_candidate |
| 11 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 11151 | record_candidate |
| 12 | Finalization | — | — | 37211 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation; 10 of 24 Tool Rounds used; 11 orchestrator rounds, 1 in Finalization; Run duration 238569 ms; LLM stage 233451 ms over 11 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 7 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 1 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 1 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.70 against the declared investigation (agrees); garbled 0.05
- Malformed Answers: 0 (0 retried)
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
- Result Picks: 0; listings returned to the model: 1 (round 4)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 4; bookkeeping-only rounds: 3
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 2 (round 4, 4)
- rounds from a search to an opened result: 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 5 (50%) · Acquisition without Progress 2 (20%) · Collection 0 (0%) · Bookkeeping 3 (30%) · Failed round 0 (0%) · Finalization 1 (9%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- **verdict: rounds wasted** — The objective was met inside 10 of 24 Tool Rounds, so no budget, tier, stop or failure verdict applies; what remains to name is the share of rounds that returned nothing. Round 1 re-navigated to https://www.raspberrypi.com/documentation/accessories/camera.html, a page the initial attempt had already checkpointed; round 4 settled on a DuckDuckGo results listing; rounds 5 and 6 spent a click and a read on the Cloudflare challenge at https://forums.raspberrypi.com/viewtopic.php?t=392941 and never saw the thread. That is 4 of the 10 budgeted rounds on off-key or re-acquired states, against 3 productive acquisitions (rounds 2, 3 after overrule, and 7) and 3 bookkeeping rounds. The cost was slack rather than the result, so the call is on the line and is also carried as a flag.
- stopped early: no — The Grade is a pass with no unsatisfied checks, so there is no check to attribute to a page the Run had not read; the question does not arise even though the Run ended on its own terms with 14 Tool Rounds unspent.
- answer omitted: no — No check is listed as unsatisfied, so nothing readable on a page the Run had visited was left unstated in the Answer.
- Off-key round 4 (https://duckduckgo.com/?q=Camera+Module+3+does+not+fit+Raspberry+Pi+Zero+case+camera+lid&ia=web): The settled page for this round is a DuckDuckGo results listing, not a document; a result page carries none of this task's required facts itself — it only offers links. Borderline, since the listing did lead directly to the click in round 5.
- Off-key round 5 (https://forums.raspberrypi.com/viewtopic.php?t=392941): The click changed URL but the page that arrived is the Cloudflare interstitial titled "Just a moment..."; a challenge screen can carry no fact of this task, and the forum thread behind it was never rendered.
- Off-key round 6 (https://forums.raspberrypi.com/viewtopic.php?t=392941): The read returned the same Cloudflare challenge (wall noted by the app, signature 5b9768c9, scroll 0/575); no thread content was ever put in front of the assistant, so no required fact could be carried here.
- overrule round 3 → Acquisition with Progress: Mechanically scored a repeat read because the page signature deb65fce was unchanged, but the call requested part 3 of a paginated read of https://www.raspberrypi.com/documentation/accessories/camera.html, a different slice of a 27163-px document than the part 2 read in round 2. Round 4 then recorded two accepted Evidence Checkpoints grounded in obs-6 at that URL — the mechanical note and the dimensions table — material that had not appeared before round 3. New material reached the assistant, so this is Acquisition with Progress.
- overrule round 6 → Acquisition without Progress: Scored as the first read of a new page state, but round 5's click result head had already rendered the same "Just a moment..." challenge; the read re-observed a state already observed and the app itself flagged the round walled. No new material entered the Run.
- flag (round 4): Should the DuckDuckGo results page in round 4 count as Off-key at all, given it was a single search (streak 1, no loop) that produced the link clicked in round 5 and so functioned as navigation rather than as a dead end?
- flag (round 5): Round 5's click did move the Run to a URL it had not held, but the state that arrived was a Cloudflare interstitial; should it be overruled to Acquisition without Progress alongside round 6 rather than left as Acquisition with Progress and merely marked Off-key?
- flag (round 3): The overrule of round 3 to Acquisition with Progress rests on reading obs-6 — the observation behind round 4's two Evidence Checkpoints — as the part 3 read; if obs-6 is in fact round 2's part 2 observation, the mechanical repeat label stands.
- flag (round 11): Is rounds_wasted the right primary for an attempt that passed every check in 10 of 24 rounds, or should the four non-productive rounds be treated as ordinary search overhead with no verdict-worthy waste?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:ca435ed4…, $0.27

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, record_evidence, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 10824 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 4392 | read_page: the first read of this page state |
| 3 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 5585 | read_page: a repeat read of a page state already read |
| 4 | Acquisition with Progress | record_evidence, record_evidence, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 32063 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 5 | Acquisition with Progress | click | https://forums.raspberrypi.com/viewtopic.php?t=392941 | 18784 | click: the settled page state moved [off-key] |
| 6 | Acquisition with Progress → Acquisition without Progress | read_page | https://forums.raspberrypi.com/viewtopic.php?t=392941 | 15940 | read_page: the first read of this page state [walled, off-key] |
| 7 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 20209 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Bookkeeping | record_evidence, record_candidate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 47098 | record_evidence, record_candidate |
| 9 | Bookkeeping | record_candidate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 6861 | record_candidate |
| 10 | Bookkeeping | record_candidate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 33803 | record_candidate |
| 11 | Finalization | — | — | 37892 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 199580 ms; LLM stage 175827 ms over 26 joined round(s)
- grade useful_partial; checks unsatisfied: fact-08, fact-09, fact-10, fact-11 (4 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.07
- Malformed Answers: 0 (0 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 9 declared; Answer standings 6 stated, 3 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 6 (round 1, 3, 6, 9, 12, 21)
- Evidence Checkpoints the Run made from a Selected Passage: 5 (round 4, 4, 4, 4, 4); recorded again by the model from the same page: 5 (round 4, 4, 4, 4, 4); with the same passage: 4 (round 4, 4, 4, 4); record_evidence calls by the model: 3; bookkeeping-only rounds: 0
- Run-made checkpoints whose passage a later record of the model's contains: 5 (round 4, 4, 4, 4, 4); cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 2 (round 5, 25)
- rounds from a search to an opened result: 2, 2, none, none, 8, none
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 19 (79%) · Acquisition without Progress 4 (17%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 1 (4%) · Finalization 2 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 4
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 2), hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; declined at the budget: no_tier_above (after round 24, replay: no Progress)
- **verdict: rounds wasted** — Of the 24 budgeted rounds, only rounds 4 and 19–20 landed on object records that could carry required facts; roughly fourteen rounds (3, 6–18, 21, 22, 24) were spent on collection results listings at /collections/objects/search/..., including the three-search loop at 6, 9, 12 (search_loop_nudge at 12), seven off-key rounds (1, 5, 13, 15, 16, 18, 22), a repeat navigate at 21, a repeat read at 24 and the refused read at 23. The one record that carries all four unsatisfied checks, https://www.rmg.co.uk/collections/objects/rmgc-object-256323, was linked as a part from the H4 record read at round 4 and was never opened; the budget was consumed scrolling listings of H4's component sub-records instead.
- stopped early: no — The attempt consumed its full 24 Tool Rounds and ended with stop reason budget_exhausted, so by rule it did not stop early. All four unsatisfied checks (fact-08, fact-09, fact-10, fact-11) did require a page the Run never read — the case's own record at https://www.rmg.co.uk/collections/objects/rmgc-object-256323 — but with no budget left that failure is not an early stop.
- answer omitted: no — None of fact-08, fact-09, fact-10 or fact-11 follows from a page the Run read. Rounds 4–5 and 19–20 put the H4 and K1 object records in front of the assistant, and rounds 3–18/21–24 put only collection results listings there; the case record at https://www.rmg.co.uk/collections/objects/rmgc-object-256323 was never opened, and its per-side placement and dating fields appear nowhere in the pages the Run acquired. Under the key's constraint on fact-08, the part title seen on the H4 record does not by itself carry that check.
- Search Loop over rounds 6, 9, 12: Three consecutive collection searches — 'ZAA0037.1' (6), 'Carrying case for H4 and K1' (9), 'ZAA0037' (12) — with nothing opened between them: the only intervening calls were scrolls (7, 10) and read_page (8, 11) on the results pages themselves, none of which breaks a loop. The app's streak counting agrees for 9 (streak 2) and 12 (streak 3, search_loop_nudge). Round 6 is the head of the same loop: the rule reset the streak only because round 5 navigated to https://www.rmg.co.uk/collections/objects/rmgc-object-79142.1, which settled on a contentless page (no title, 962px scroll height) and so put nothing in front of the assistant.
- Off-key round 1 (https://collections.rmg.co.uk/search/results/?q=Harrison%20longitude%20watch): The settled page is '401 Authorization Required' — a wall on the legacy collections host. It carries no object record and therefore none of the key's required facts.
- Off-key round 5 (https://www.rmg.co.uk/collections/objects/rmgc-object-79142.1): The navigate settled on an empty record page (blank title '| Royal Museums Greenwich', 962px scroll height, no result body). Nothing on it can carry a required fact; the case's own record lives at a different object id that the Run never reached.
- Off-key round 13 (https://www.rmg.co.uk/collections/objects/search/ZAA0037): Scroll on a search-results listing that surfaced only H4 component sub-records ('Movement', 'Winding key'). A results page of component parts carries none of the case facts still outstanding at this point.
- Off-key round 15 (https://www.rmg.co.uk/collections/objects/search/ZAA0037): Further scroll on the same results listing, surfacing the already-known H4 link plus 'Pins' and 'Winding key' component records — no page here can carry the case's side assignment or its dating.
- Off-key round 16 (https://www.rmg.co.uk/collections/objects/search/ZAA0037): Further scroll on the same results listing, surfacing 'Three fragments of mainspring removed from H4' and 'Counter poise' — component sub-records that carry no required fact.
- Off-key round 18 (https://www.rmg.co.uk/collections/objects/search/ZAA0037): Further scroll on the same results listing, surfacing 'Winding key' and 'Rear bearing cap' — again component sub-records; this round was spent under budget_warning 6/24 on a surface that cannot hold the outstanding facts.
- Off-key round 22 (https://www.rmg.co.uk/collections/objects/search/ZAA0037.1): Scroll on a results page already scrolled and read at rounds 7–8, surfacing only the K1 link already opened at round 19. The listing carries no case record and so no required fact left outstanding.
- overrule round 5 → Acquisition without Progress: The mechanical label credits progress because the URL https://www.rmg.co.uk/collections/objects/rmgc-object-79142.1 had not been acquired, but the page settled with no title and 962px of content — a not-found landing that put no new material in front of the assistant. The round's other call was an accepted Evidence Checkpoint grounded in the round-4 page, not in this navigation.
- overrule round 6 → Acquisition without Progress: Labelled with progress only because the streak was reset by round 5's contentless landing; on the evidence it is the head of the search loop at rounds 6, 9 and 12, a blind results-page search with nothing opened before it since round 4.
- flag (round 6): Round 6 was overruled into the loop at 6/9/12 on the view that round 5's landing on rmgc-object-79142.1 put nothing before the assistant; a reviewer who treats that navigate as a genuine opening — it did establish that the sub-record page is empty, later cited in round 25's evidence — would start the loop at round 9 and leave round 6 as acquisition with progress.
- flag (round 5): Is round 5 better read as acquisition with progress? It reached a URL the Run had not acquired and the emptiness of that page was itself the finding recorded at round 25, even though no required fact could be on it.
- flag (round 3): Rounds 1 and 3 run the same query 'Harrison longitude watch' on two surfaces with only round 2's navigate to the collections landing page between them; because round 1 hit a 401 wall, a reviewer might extend the loop back to include 1 and 3 rather than accept round 2 as an opening.
- flag (round 2): Should round 2 (https://www.rmg.co.uk/collections/objects, the collection index reached after the 401) also be called off-key? It carries no required fact, though it was the navigational entry that produced the working search box.
- flag (round 13): The ZAA0037 results listing at rounds 13–18 does display the case's part entry 'Carrying case for H4 and K1 (ZAA0037.1)'; a reviewer could hold those scrolls on-key for fact-07 rather than off-key, even though that fact was already taken from the H4 record at round 4.
- flag (round 20): fact-08 bundles the other watch's name with the per-side placement; the K1 record read at rounds 19–20 and the part title on the H4 record supply the name, so a reviewer weighing the halves differently might place fact-08 under answerOmitted instead of treating it as needing the unread case record.
- flag: Is rounds_wasted the decisive verdict, or would failed_rounds/none-of-the-above fit better given that only round 23 failed and the run did reach its budget with two real object records read?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:8e002203…, $0.48

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://collections.rmg.co.uk/search/results/?q=Harrison%20longitude%20watch | 13011 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects | 6039 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/objects/search/Harrison%20longitude%20watch | 5570 | type: the settled page state moved |
| 4 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 5877 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress → Acquisition without Progress | record_evidence, navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 8057 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 6 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 4088 | navigate: the settled page state moved to a page this Run had not acquired [search loop, loop head by the streak rule] |
| 7 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 4282 | scroll: the scroll brought new material into view |
| 8 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 5048 | read_page: the first read of this page state |
| 9 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20an… | 3500 | navigate: a search after a search with nothing opened between them (streak 2) [search loop] |
| 10 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20an… | 5657 | scroll: the scroll brought new material into view |
| 11 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20an… | 5694 | read_page: the first read of this page state |
| 12 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 5303 | navigate: a search after a search with nothing opened between them (streak 3) [search loop] |
| 13 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 3992 | scroll: the scroll brought new material into view [off-key] |
| 14 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 3860 | read_page: the first read of this page state |
| 15 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 5674 | scroll: the scroll brought new material into view [off-key] |
| 16 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 5098 | scroll: the scroll brought new material into view [off-key] |
| 17 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 4161 | read_page: the first read of this page state |
| 18 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037 | 6301 | scroll: the scroll brought new material into view [off-key] |
| 19 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 21806 | navigate: the settled page state moved to a page this Run had not acquired |
| 20 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 4120 | read_page: the first read of this page state |
| 21 | Acquisition without Progress | record_evidence, navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 10778 | navigate: a navigate to a URL this Run already acquired |
| 22 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 4353 | scroll: the scroll brought new material into view [off-key] |
| 23 | Failed round | read_page ✗ | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 10493 | every call was refused (read_page) |
| 24 | Acquisition without Progress | read_page | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 5820 | read_page: a repeat read of a page state already read |
| 25 | Finalization | record_evidence | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 6099 | the bookkeeping round (record_evidence) |
| 26 | Finalization | — | — | 11146 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done (model_answered); tier investigation (1 Tier Escalation(s): 1 at the deadline); 10 Tool Rounds used over 2 tier epochs, the last budgeted 22; 12 orchestrator rounds, 1 in Finalization; Run duration 202046 ms; LLM stage 189946 ms over 12 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.66 against the declared lookup (disagrees); garbled 0.05
- Malformed Answers: 2 (1 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 6 declared; Answer standings 0 stated, 6 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 1 (round 2)
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 1 (round 2); listings returned to the model: 2 (round 5, 8)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 2; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 1, 2, 2
- Identity Slips: 1 Answer(s) with an Identity Slip, 4 id(s) slipped
- kinds: Acquisition with Progress 8 (73%) · Acquisition without Progress 1 (9%) · Collection 0 (0%) · Bookkeeping 1 (9%) · Failed round 1 (9%) · Finalization 1 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 3, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: deadline arm after round 10, replay: no judged call; none declined
- **verdict: rounds wasted** — The attempt passed on 10 of 22 Tool Rounds, so no budget or tier verdict applies; the only cost worth naming is the rounds that carried no on-key progress: round 1's navigate to a guessed address that returned a Not-found Page, the two DuckDuckGo results surfaces in rounds 5 and 8, and the empty round 11 — 4 of the 11 budgeted rounds (~36%) against the 4 rounds that actually delivered the two verified sources (rounds 2-3 and 6-7, plus round 9's help-centre confirmation).
- secondary: failed rounds — Round 11 closed with no tool call and no Answer, 1 of 11 budgeted rounds (~9%); it cost a round and forced the reserved Answer in round 12, but with 12 Tool Rounds still unspent it did not cost the attempt its result, which is why it is secondary rather than primary.
- stopped early: no — The Grade is a pass with no unsatisfied checks, so there is no check to attribute to a page the Run had not read.
- answer omitted: no — The Grade lists no unsatisfied checks, so nothing was left unstated for this judgement to name.
- Off-key round 1 (https://www.eurostar.com/rail-travel-guide/luggage): The composed address resolved to a Not-found Page on eurostar.com ("Sorry, we can't find the page you're looking for"); a 404 shell carries no policy text, so this landing could carry none of the task's required facts.
- Off-key round 5 (https://duckduckgo.com/?q=musical+instruments+site%3Aeurostar.com+uk-en+travel-info&ia=web): A DuckDuckGo results page: an index of links, not a page that can state any allowance or instrument rule. On-key material only arrived when the result was opened in round 6.
- Off-key round 8 (https://duckduckgo.com/?q=musical+instruments+site%3Ahelp.eurostar.com&ia=web): A second DuckDuckGo results page; a search surface cannot carry the task's required facts itself, and the on-key page was reached in round 9.
- flag (round 5): Rounds 5 and 8 are marked Off-key as search results pages, yet each was a single navigational step that opened the on-key page in the very next round (6 and 9); should productive one-hop SERPs be counted against the attempt at all?
- flag (round 1): Round 1's Not-found landing came bundled with report_run_plan; a reviewer might label that round bookkeeping with a failed navigate rather than an Off-key acquisition without progress.
- flag (round 2): Round 2's navigate was rewritten into a site search yet the digest shows the settled page as the official luggage page — is this one acquisition with progress, or a search round whose result was auto-opened, which would bear on any loop boundary with round 5?
- flag (round 11): Round 11 spent 41 s at max effort with 5612 chars of reasoning and no call; is that a failed round or a deliberative round the taxonomy has no kind for, and does that change the secondary verdict?
- flag (round 12): With a passing Grade and 12 Tool Rounds unspent, is rounds_wasted the right primary verdict, or should the closed set be read as having no fitting label for an efficient pass?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:fa20b1e2…, $0.15

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/rail-travel-guide/luggage | 16378 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4321 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, result pick] |
| 3 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7730 | read_page: the first read of this page state |
| 4 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 8806 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=musical+instruments+site%3Aeurostar.com+uk-en+travel-i… | 6972 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 6 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5028 | navigate: the settled page state moved to a page this Run had not acquired |
| 7 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4360 | read_page: the first read of this page state |
| 8 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=musical+instruments+site%3Ahelp.eurostar.com&ia=web | 29253 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 9 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on… | 4506 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Bookkeeping | record_evidence, record_evidence | https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on… | 42039 | record_evidence, record_evidence |
| 11 | Failed round | — | — | 41091 | the round completed with no tool call and no Answer |
| 12 | Finalization | — | — | 19462 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 3 of 12 Tool Rounds used; 4 orchestrator rounds, 1 in Finalization; Run duration 66484 ms; LLM stage 63044 ms over 4 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 2 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: lookup at 0.75 against the declared lookup (agrees); garbled 0.09
- Malformed Answers: 0 (0 retried)
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
- Evidence Checkpoints the Run made from a Selected Passage: 1 (round 1); recorded again by the model from the same page: 1 (round 1); with the same passage: 1 (round 1); record_evidence calls by the model: 1; bookkeeping-only rounds: 0
- Run-made checkpoints whose passage a later record of the model's contains: 1 (round 1); cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 1 (round 3)
- rounds from a search to an opened result: no search
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (33%) · Acquisition without Progress 2 (67%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 0 (0%) · Finalization 1 (25%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- **verdict: rounds wasted** — Nothing failed here — the Run passed in 3 of 12 budgeted Tool Rounds (66.5 s) with one accepted Evidence Checkpoint — so the only admissible reading in the closed set is the no-Progress share: 2 of 3 budgeted rounds (rounds 1 and 3) were labelled acquisition_without_progress because both navigates re-acquired pages the initial attempt had already checkpointed, leaving 1 acquisition_with_progress round (round 2, the read of https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage). The waste is nominal rather than costly: both pages (the luggage page and https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments) are the key's verified sources, both were on-key, there were no searches, no Search Loops, no failed rounds and no rejected checkpoints.
- stopped early: no — The Grade is a pass with no unsatisfied checks, so no check can be attributed to a page the Run had not read; the Run also stopped voluntarily after 3 of 12 Tool Rounds with its objective met.
- answer omitted: no — No unsatisfied checks are listed, so nothing followed from a read page that the Answer left unstated.
- flag (round 1): Round 1's navigate to https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage is marked no-Progress only as an inherited re-acquisition; since this Run had not itself put that page in front of the assistant and the round also filed the Run Plan, a careful reviewer might overrule it to acquisition_with_progress.
- flag (round 3): Round 3 pairs an inherited re-acquisition of https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments with an accepted record_evidence whose note flags a contradiction with earlier inherited observations from the same source — is the round better read as bookkeeping (or as Progress, since the contradiction was resolved there) than as acquisition_without_progress?
- flag (round 2): Is rounds_wasted defensible at all for a passing 3-round Run whose only two page visits are the key's verified sources? The verdict rests on the 2-of-3 no-Progress share alone and no other option in the closed set applies; a reviewer might consider the label unfair to an attempt with no loops, no off-key pages and no failed rounds.
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:3abbd30a…, $0.15

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9362 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5102 | read_page: the first read of this page state |
| 3 | Acquisition without Progress | navigate, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 13714 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 4 | Finalization | — | — | 34866 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended failed (deadline_reached); tier investigation; 22 of 24 Tool Rounds used; 24 orchestrator rounds, 1 in Finalization; Run duration 331977 ms; LLM stage 302565 ms over 24 joined round(s)
- grade unsuccessful; checks unsatisfied: fact-01, fact-02, fact-03, fact-04, fact-05, fact-06, fact-07, fact-08, fact-09 (9 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted (0 merged, a floor) and 3 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.05
- Malformed Answers: 0 (0 retried)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 1 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 6 declared; Answer standings 0 stated, 6 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 1 (round 11)
- of the rewrites, judged Off-key by the reviewer: 1
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 2 (round 2, 5)
- of those, judged Off-key by the reviewer: 2
- searches that ran on the Run Engine in place of another Web Engine: 1 (round 2)
- of those, judged Off-key by the reviewer: 1
- Result Picks: 0; listings returned to the model: 5 (round 2, 5, 7, 8, 11)
- Evidence Checkpoints the Run made from a Selected Passage: 1 (round 12); recorded again by the model from the same page: 1 (round 12); with the same passage: 1 (round 12); record_evidence calls by the model: 5; bookkeeping-only rounds: 6
- Run-made checkpoints whose passage a later record of the model's contains: 1 (round 12); cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 1 (round 18)
- rounds from a search to an opened result: 2, 2, none, 2, 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 14 (61%) · Acquisition without Progress 2 (9%) · Collection 0 (0%) · Bookkeeping 6 (26%) · Failed round 1 (4%) · Finalization 1 (4%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 5, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; declined at the deadline: no_tier_above (after round 23, replay: no judged call)
- **verdict: answer omitted** — The Run acquired everything it needed: of 23 budgeted rounds, 14 carried progress, and by round 16 both of the key's verified sources had been read (rounds 9-10 and 12-13) and the later release's date confirmed on the JPL copy (rounds 14-16), with five Evidence Checkpoints accepted and a candidate written at rounds 20-21. All nine unsatisfied checks (fact-01..fact-09) rest on those read pages, yet the Answer at round 24 stated none of them. That gap between what was read and what was said is the decisive failure.
- secondary: rounds wasted — Roughly half the budget produced nothing toward the Answer: round 1 landed on a 404, rounds 7-8 are a search loop, rounds 3, 4 and 6 worked a status-update release that is neither official account (round 6 overruled to no progress as a mirror of round 4), and rounds 17-22 — 6 of 23 budgeted rounds, about 26% — went entirely to bookkeeping, three of which had their checkpoints rejected (excerpt_unsupported at 17, unknown_candidate at 19, malformed at 22). Those six rounds ran after the last acquisition at round 16 and consumed the window in which the findings could have been composed, leaving round 23 to be cut by the deadline.
- stopped early: no — The attempt ended deadline_reached: 22 of a 24 Tool Round budget were used, round 23 was cut by the active-work deadline and round 24 was the reserved Answer, so the Run did not end with budget and time left. Separately, no unsatisfied check needed a page the Run had not read — both of the key's verified sources were opened and read (round 10 at https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/ and round 13 at https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-into-interstellar-space/, with the JPL copy of the later release scrolled and Looked at in rounds 14-16).
- answer omitted: yes (fact-01, fact-02, fact-03, fact-04, fact-05, fact-06, fact-07, fact-08, fact-09) — Every unsatisfied check follows from material on pages the Run had already read. Round 10 read the June JPL release (https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/), which supports fact-01 and fact-04; round 13 read the September NASA release (https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-into-interstellar-space/), which supports fact-03 and fact-05 through fact-08; rounds 14-16 on https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-interstellar-space/ produced and recorded the material behind fact-02 (memory-4, accepted at round 18); fact-09 is the comparison between those two read pages, and the candidate written at rounds 20-21 shows the material was in hand. The reserved Answer at round 24 nevertheless left all nine unstated.
- Search Loop over rounds 7, 8: Round 7 ran a DuckDuckGo query and round 8 ran another with nothing opened between them (the app marked streak 2, new terms). No page read, Look, scroll or opening separated the two, so they are one loop. It is bounded: round 6 opened a page before round 7 and round 9 opened a real result after round 8, so the loop does not extend in either direction.
- Off-key round 1 (https://www.jpl.nasa.gov/news/voyager-1-has-not-yet-left-the-solar-system-or-has-it): A composed JPL address that resolved to a Not-found Page; a 404 body can carry no required fact of this task.
- Off-key round 2 (https://duckduckgo.com/?q=JPL+June+2013+%22Voyager+1%22+has+not+yet+left+the+solar+system+news+release&ia=web): Search results page. Result heads and snippets are not the official accounts the task names, so the landed page carries none of fact-01..fact-09 itself.
- Off-key round 3 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/): A JPL Voyager status-update release on the right site and adjacent subject, but neither of the two official accounts this task is built on (the key's verified sources S1 and S2); it can carry none of the required facts as the key frames them.
- Off-key round 4 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/): Read of the same status-update release as round 3 — wrong article for every required fact; the read consumed a round without touching either account named by the task.
- Off-key round 5 (https://duckduckgo.com/?q=Voyager+1+Has+Not+Yet+Left+the+Solar+System%2C+or+Has+It%3F+jpl+2013&ia=web): Search results page; the quoted phrase was stripped by the app's rewrite and the landed page holds no required fact.
- Off-key round 6 (https://science.nasa.gov/missions/voyager-program/nasa-voyager-status-update-on-voyager-1-location/): The science.nasa.gov mirror of the same status-update release already read at round 4 — still not either official account, so it carries none of the required facts.
- Off-key round 7 (https://duckduckgo.com/?q=jpl.nasa.gov+voyager+1+June+27+2013+or+has+it+interstellar+space+Science+paper&ia=web): Search results page: no required fact can live on the SERP itself.
- Off-key round 8 (https://duckduckgo.com/?q=site%3Ajpl.nasa.gov+voyager+1+solar+bubble+final+frontier&ia=web): Search results page and the second member of the rounds 7-8 loop; carries no required fact.
- Off-key round 11 (https://duckduckgo.com/?ia=web&q=news+nasas+voyager+embarks+on+historic+journey+to+interstellar+space+site%3Anasa.gov): The intended JPL navigate was rewritten into a site search, so the round landed on a search results page, which carries no required fact (the accepted Evidence in the same round was grounded in the page read at round 10, not in this landing).
- overrule round 6 → Acquisition without Progress: The mechanical rule scored progress because the URL was new, but science.nasa.gov/missions/voyager-program/nasa-voyager-status-update-on-voyager-1-location/ is the mirror of the article already navigated at round 3 and read in full at round 4 — a repeat observation of material the Run had already seen, at a second host.
- flag (round 3): Rounds 3, 4 and 6 are called Off-key because the JPL status-update release is neither official account the task names; a careful human might count it as legitimate on-site background on the missing-sign question rather than an Off-key landing.
- flag (round 6): Is the overrule of round 6 to acquisition_without_progress right, given the science.nasa.gov mirror is a distinct URL that might have carried a publication date the JPL copy did not show?
- flag (round 6): If round 6's mirror were treated as putting nothing new before the assistant, the loop would extend to rounds 5-8 rather than 7-8; the boundary was drawn at round 7 because the mirror did load and display an article.
- flag (round 2): Round 2's search results landing is marked Off-key by the definition, yet the same chain of searches is what surfaced the two official accounts opened at rounds 9 and 12 — a reviewer might decline to score productive SERP hops as Off-key.
- flag (round 11): Round 11's navigate was rewritten by the app into a site search, so the landing was a SERP through no choice of the assistant; counting it Off-key may be harsh, and the round did carry an accepted Evidence Checkpoint.
- flag (round 23): Should failed_rounds be the secondary instead of rounds_wasted? Round 23 was the single cut round (1 of 23) and it immediately preceded the reserved Answer, so it may be what cost the attempt its write-up.
- flag (round 24): answer_omitted is chosen over rounds_wasted as primary on the view that the material was in hand by round 16; a reviewer who weighs the 26% bookkeeping share and three rejected checkpoints more heavily could invert the two.
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:64240658…, $0.53

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/voyager-1-has-not-yet-left-the-solar-system-or-has… | 14070 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=JPL+June+2013+%22Voyager+1%22+has+not+yet+left+the+sol… | 5646 | navigate: the settled page state moved to a page this Run had not acquired [unquoted, engine rewritten, off-key] |
| 3 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 8008 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 4 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 11118 | read_page: the first read of this page state [off-key] |
| 5 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=Voyager+1+Has+Not+Yet+Left+the+Solar+System%2C+or+Has+… | 25844 | navigate: the settled page state moved to a page this Run had not acquired [unquoted, off-key] |
| 6 | Acquisition with Progress → Acquisition without Progress | navigate | https://science.nasa.gov/missions/voyager-program/nasa-voyager-status-update-on-… | 9199 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=jpl.nasa.gov+voyager+1+June+27+2013+or+has+it+interste… | 6892 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 8 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=site%3Ajpl.nasa.gov+voyager+1+solar+bubble+final+front… | 7481 | navigate: a search after a search with nothing opened between them (streak 2) [off-key, search loop] |
| 9 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 4610 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 4349 | read_page: the first read of this page state |
| 11 | Acquisition with Progress | navigate, record_evidence | https://duckduckgo.com/?q=news+nasas+voyager+embarks+on+historic+journey+to+inte… | 20600 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 12 | Acquisition with Progress | navigate | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 2115 | navigate: the settled page state moved to a page this Run had not acquired |
| 13 | Acquisition with Progress | read_page | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 4625 | read_page: the first read of this page state |
| 14 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 15141 | navigate: the settled page state moved to a page this Run had not acquired |
| 15 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 5389 | scroll: the scroll brought new material into view |
| 16 | Acquisition with Progress | look | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 5178 | look: the first Look at this page state with this question |
| 17 | Bookkeeping | record_evidence | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 8253 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 18 | Bookkeeping | record_evidence, record_evidence | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 23554 | record_evidence, record_evidence |
| 19 | Bookkeeping | record_candidate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 52030 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 20 | Bookkeeping | record_candidate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 4775 | record_candidate |
| 21 | Bookkeeping | record_candidate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 6244 | record_candidate |
| 22 | Bookkeeping | record_evidence | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 12426 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 23 | Failed round | — | — | 27124 | cut by the active-work deadline |
| 24 | Finalization | — | — | 17894 | the reserved Answer |

