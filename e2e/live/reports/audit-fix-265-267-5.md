# Round Audit — bingbong.live-web.information-hunts (fix-265-267-5)

Generated 2026-09-22T02:09:22.133Z from a capture set created 2026-09-22T01:18:24.274Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) b44d9dc6; mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p3; audit run at commit da049891

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 63 | 60 | 58 | 1 | 29 (48%) → 35 | 13 (22%) → 7 | 0 (0%) | 13 (22%) | 5 (8%) | 3 (5%) |
| follow_up | 2 | 2 | 17 | 15 | 15 | 0 | 5 (33%) → 6 | 4 (27%) → 3 | 0 (0%) | 6 (40%) | 0 (0%) | 2 (12%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 1 | 0 | 0 |
| answer omitted | 1 | 0 | 0 | 0 |
| failed rounds | 1 | 0 | 0 | 0 |

- initial: 13 Off-key round(s), 4 Search Loop round(s) by the reviewer (4 by the streak rule, heads included: 2 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 4, replay 0, none 0; navigate searches by Search URL form q 10, param 0, path 1; 1 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 1 recovery round(s) over 1 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 2 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 1 deadline-armed Tier Escalation(s) (replay found Progress before 1, none before 0), declined no_tier_above 2, 0 declined no_progress against the replay), 0 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 3 navigate(s) landed on a Not-found Page (1 judged Off-key), 6 Composed Address(es) rewritten into a site search (5 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 5 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 2 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 6952 ms, p90 20581 ms over 61 round(s), 4 declared Asked Items (1 with an unverified standing, 0 shape failure(s), 0 retried), 1 stopped early, 1 answer omitted, 6 overrule(s), 14 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 1, none 1, objective_met 1
- follow_up: 1 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 0, replay 0, none 2; navigate searches by Search URL form q 0, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 3 inherited, 1 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 2 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 5544 ms, p90 16722 ms over 17 round(s), 2 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 0 answer omitted, 1 overrule(s), 6 flag(s); Finalization Causes: objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 26 (45%) | 5 (33%) |
| read_page | 14 (24%) | 4 (27%) |
| record_evidence | 11 (19%) | 6 (40%) |
| record_candidate | 6 (10%) | 2 (13%) |
| report_run_plan | 4 (7%) | 2 (13%) |
| scroll | 4 (7%) | 0 |
| type | 2 (3%) | 0 |

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
| rule-eurostar-luggage | 1 | 0 | 0 | 0 | 1 | 1 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Tier Escalations by hunt

Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.

| hunt | budget arm | deadline arm | Progress before | no Progress before | declined no_rail | declined no_tier_above | declined once_spent | declined hard_ceiling | declined no_progress | against the replay | not recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055) and searches that ran with an Unseen Phrase unquoted (ADR 0064), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases |
| --- | --- | --- |
| compatibility-pi-camera | 2 | 0 |
| historical-longitude-watch | 0 | 0 |
| rule-eurostar-luggage | 4 | 0 |
| superseded-voyager-interstellar | 0 | 0 |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended failed (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 25 orchestrator rounds, 1 in Finalization; Run duration 339394 ms; LLM stage 318307 ms over 25 joined round(s)
- grade unsuccessful; checks unsatisfied: fact-01, fact-02, fact-03, fact-04, fact-05, fact-06 (6 of 10)
- 0 Subagent round(s) over 0 Subagent(s); 6 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 1 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 4 declared; Answer standings 0 stated, 4 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 2 (round 2, 18)
- of the rewrites, judged Off-key by the reviewer: 2
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 10 (42%) · Acquisition without Progress 8 (33%) · Collection 0 (0%) · Bookkeeping 5 (21%) · Failed round 1 (4%) · Finalization 1 (4%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 4, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; declined at the budget: no_tier_above (after round 24, replay: no judged call)
- **verdict: answer omitted** — All six unsatisfied checks follow from the two official documentation pages the Run read in rounds 3–17 and grounded as Evidence in rounds 6, 18 and 21. The Answer in round 25 did not state them. With the overrules, 16 of the 24 budgeted rounds brought new material. The budget running out did not keep any needed page from being read.
- stopped early: no — The attempt used all 24 of its 24 Tool Rounds and ended because the budget ran out, so it did not stop early.
- answer omitted: yes (fact-01, fact-02, fact-03, fact-04, fact-05, fact-06) — The Run read https://www.raspberrypi.com/documentation/accessories/camera.html (rounds 3–5) and https://www.raspberrypi.com/documentation/computers/camera_software.html (rounds 7–17). It also recorded evidence from both pages in rounds 6, 18 and 21, and accepted Candidate memory-5 built on that evidence. Between them, those two pages carry every one of the six unsatisfied checks. The Answer in round 25 still left all six unstated.
- Off-key round 2 (https://duckduckgo.com/?q=documentation+accessories+camera+site%3Araspberrypi.com&ia=web): This is a search results page that the rewrite produced. It lists links and cannot itself carry any required fact.
- Off-key round 6 (https://duckduckgo.com/?q=rpicam-still+replaces+raspistill+bookworm+site%3Araspberrypi.com&ia=web): This is a search results page. The navigate in this round only listed results and carried no required fact.
- Off-key round 12 (https://duckduckgo.com/?q=rpicam-still+autofocus-mode+continuous+site%3Araspberrypi.com&ia=web): This is a search results page. The autofocus material it pointed to was on camera_software.html, which the Run had already acquired.
- Off-key round 14 (https://duckduckgo.com/?q=rpicam-still+autofocus-mode+continuous+site%3Araspberrypi.com&ia=web): This round read the text of a search results page. That page cannot carry any required fact.
- Off-key round 18 (https://duckduckgo.com/?q=news+bookworm+the+new+version+of+raspberry+pi+os+site%3Araspberrypi.com&ia=web): This is a search results page that the rewrite produced. It carries no required fact.
- overrule round 5 → Acquisition with Progress: This read part 2 of accessories/camera.html, and round 4 had read only part 1. The page signature did not change, but new text came in, so this was not a repeat read.
- overrule round 9 → Acquisition with Progress: This read part 3 of camera_software.html, a part not read before. It is new material, not a repeat.
- overrule round 10 → Acquisition with Progress: This read part 2 of camera_software.html for the first time. It is new material.
- overrule round 11 → Acquisition with Progress: This read part 5 of camera_software.html for the first time. It is new material.
- overrule round 16 → Acquisition with Progress: This read part 6 of camera_software.html for the first time. The autofocus options recorded in round 21 came from this later part of the page.
- overrule round 17 → Acquisition with Progress: This read part 7 of camera_software.html for the first time. It is new material.
- flag (round 19): Should the Bookworm announcement at https://www.raspberrypi.com/news/bookworm-the-new-version-of-raspberry-pi-os/ count as Off-key? It is on the right site and about the right OS release, but the evidence recorded from it covered display-system changes rather than any required fact.
- flag (round 5): The digest shows the same page signature for different read_page parts (rounds 5, 9, 10, 11, 16, 17). Should reads of new parts be overruled to Progress, as done here, or does the rule deliberately treat a page state as read once?
- flag (round 14): Round 14 read a search results page after the refused call in round 13. Should it count as a wasted Off-key acquisition, or as a legitimate first look at the listed results before round 15 opened one of them?
- flag (round 25): The Run had grounded every fact as Evidence, yet all six facts went unsatisfied. Was the Answer truncated or malformed rather than simply incomplete? If so, would failed_rounds describe the cause better than answer_omitted?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:e185e07b…, $0.20

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 23515 | navigate: landed on a Not-found Page [not found] |
| 2 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=documentation+accessories+camera+site%3Araspberrypi.co… | 8129 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 3 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 4211 | navigate: the settled page state moved to a page this Run had not acquired |
| 4 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 3409 | read_page: the first read of this page state |
| 5 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 12258 | read_page: a repeat read of a page state already read |
| 6 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 13016 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 7059 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 7678 | read_page: the first read of this page state |
| 9 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 12411 | read_page: a repeat read of a page state already read |
| 10 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 9255 | read_page: a repeat read of a page state already read |
| 11 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 22171 | read_page: a repeat read of a page state already read |
| 12 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=rpicam-still+autofocus-mode+continuous+site%3Araspberr… | 18360 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 13 | Failed round | read_page ✗ | https://duckduckgo.com/?ia=web&q=rpicam-still+autofocus-mode+continuous+site%3Ar… | 8673 | every call was refused (read_page) |
| 14 | Acquisition with Progress | read_page | https://duckduckgo.com/?q=rpicam-still+autofocus-mode+continuous+site%3Araspberr… | 9719 | read_page: the first read of this page state [off-key] |
| 15 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 7907 | navigate: a navigate to a URL this Run already acquired |
| 16 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3229 | read_page: a repeat read of a page state already read |
| 17 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2238 | read_page: a repeat read of a page state already read |
| 18 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 18902 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 19 | Acquisition with Progress | navigate | https://www.raspberrypi.com/news/bookworm-the-new-version-of-raspberry-pi-os/ | 11529 | navigate: the settled page state moved to a page this Run had not acquired |
| 20 | Bookkeeping | record_evidence | https://www.raspberrypi.com/news/bookworm-the-new-version-of-raspberry-pi-os | 10306 | record_evidence |
| 21 | Bookkeeping | record_evidence | https://www.raspberrypi.com/news/bookworm-the-new-version-of-raspberry-pi-os | 5191 | record_evidence |
| 22 | Bookkeeping | record_candidate | https://www.raspberrypi.com/news/bookworm-the-new-version-of-raspberry-pi-os | 61459 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 23 | Bookkeeping | record_candidate | https://www.raspberrypi.com/news/bookworm-the-new-version-of-raspberry-pi-os | 10576 | record_candidate |
| 24 | Bookkeeping | record_candidate | https://www.raspberrypi.com/news/bookworm-the-new-version-of-raspberry-pi-os | 4153 | record_candidate |
| 25 | Finalization | — | — | 22953 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation; 12 of 24 Tool Rounds used; 13 orchestrator rounds, 1 in Finalization; Run duration 294172 ms; LLM stage 291743 ms over 13 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 6 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 2 inherited round(s); 1 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; Answer standings 3 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 4 (33%) · Acquisition without Progress 3 (25%) · Collection 0 (0%) · Bookkeeping 5 (42%) · Failed round 0 (0%) · Finalization 1 (8%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- **verdict: rounds wasted** — The attempt passed, used 12 of 24 Tool Rounds and had no failed rounds, so no failure mode applies strongly. The only inefficiency was minor. Two of 12 rounds (4 and 5, about 17%) re-navigated to the documentation page inherited from the initial attempt. Round 3 detoured to the off-key Module 2 page. Five of 12 rounds (8–12) were bookkeeping only, including one rejected checkpoint in round 11.
- stopped early: no — The attempt was graded pass and no checks are unsatisfied, so there is nothing to judge here.
- answer omitted: no — The attempt was graded pass and no checks are unsatisfied, so the Answer left nothing unstated.
- Off-key round 3 (https://www.raspberrypi.com/products/camera-module-v2/): This is the Camera Module 2 product page. The follow-up's required facts are about Module 3 and the Zero Case camera lid, and they rest on the camera documentation page. This page only repeats cable information the Run already had from the Module 3 page, so it could not carry fact-01, fact-02 or fact-03.
- overrule round 7 → Acquisition with Progress: read_page asked for part 3, a different section from the part 2 read in round 6. The request size grew from 40179 chars at round 7 to 47598 chars at round 8, so new text arrived. Round 8 then recorded the mechanical-compatibility evidence from this page (obs-10). That is new material, not a repeat of what had already been read.
- flag: The attempt passed with no unsatisfied checks, and rounds_wasted is a weak fit given only about 17% of rounds without progress. Should a passing attempt carry any failure verdict at all?
- flag (round 3): Is the Module 2 product page really off-key? It gave the cable-rule evidence recorded in round 12, which supports the unchanged-electrical point behind fact-03.
- flag (round 7): The result head shows the same scroll position and signature as round 6. Was read_page part 3 truly new material, as the overrule assumes, or a repeat read as the mechanical label says?
- flag (round 4): This page was inherited from the initial attempt, but it held the mechanical section this follow-up needed. Should re-navigating to it count as Acquisition with Progress instead?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:7b727379…, $0.13

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/products/camera-module-3/ | 23976 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 7663 | read_page: the first read of this page state |
| 3 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/products/camera-module-3 | 10354 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 4 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 4378 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 5 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html#camera-module-… | 13485 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 6 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html#camera-module-… | 2848 | read_page: the first read of this page state |
| 7 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html#camera-module-… | 5550 | read_page: a repeat read of a page state already read |
| 8 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 53029 | record_evidence, record_evidence |
| 9 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 51653 | record_candidate |
| 10 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 21264 | record_candidate |
| 11 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 43740 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 12 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 2505 | record_evidence |
| 13 | Finalization | — | — | 51298 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / completed (objective_met); tier investigation (1 Tier Escalation(s): 1 at the deadline); 15 Tool Rounds used over 2 tier epochs, the last budgeted 22; 16 orchestrator rounds, 1 in Finalization; Run duration 249760 ms; LLM stage 182650 ms over 16 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 8 declared; Answer standings 8 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 7 (47%) · Acquisition without Progress 1 (7%) · Collection 0 (0%) · Bookkeeping 5 (33%) · Failed round 2 (13%) · Finalization 1 (6%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 1
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 3), hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: deadline arm after round 10, replay: Progress; none declined
- **verdict: rounds wasted** — The attempt passed, using 15 of 22 Tool Rounds. The only real inefficiency was small: 2 failed rounds (2, 5), 1 round without Progress (4) and 2 off-key listing pages (3, 4) at the start. That is about a third of the budgeted rounds before round 6 reached the H4 record at https://www.rmg.co.uk/collections/objects/rmgc-object-79142. None of this cost the result.
- stopped early: no — The attempt was graded pass with no unsatisfied checks, so there is nothing to judge.
- answer omitted: no — The attempt was graded pass with no unsatisfied checks, so nothing was left unstated.
- Search Loop over rounds 2, 4: Two searches with nothing opened between them. The round 2 search URL was refused, and round 3's read_page, which landed on the generic collection listing, does not break a loop. The app's rule counted this as a streak of 2 (the round 4 search rewords the round 2 one). The loop ended when round 6 put the H4 record in front of the Run.
- Off-key round 3 (https://www.rmg.co.uk/collections/objects): A generic collection listing page. It is not a record and cannot carry any required fact.
- Off-key round 4 (https://www.rmg.co.uk/collections/objects/search/Harrison%20longitude%20watch%20H4): A search results page. It lists links but carries none of the record fields the checks need.
- flag: The attempt passed with budget to spare. Is any failure verdict meaningful here, or should rounds_wasted be read only as a note on minor early inefficiency?
- flag (round 2): The round 2 search was refused and never executed. Should it count as a Search Loop member alongside round 4?
- flag (round 7): Should the search results page for ZAA0037.1 (rounds 7–9) count as off-key? It is a listing page, but its visible links revealed the case record and the case's own ID.
- flag (round 11): Is the K1 record https://www.rmg.co.uk/collections/objects/rmgc-object-79143 on-key? It is not a verified source, and the other watch's identity was already on the case record. Arguably this navigation added nothing that the checks require.
- flag (round 5): The round 5 navigate was refused, yet round 6 read the target H4 page. Is round 5 really a failed round, or did its navigation take effect?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:6a4272ee…, $0.13

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Bookkeeping | report_run_plan, navigate ✗ | — | 14547 | report_run_plan, navigate |
| 2 | Failed round | navigate ✗ | — | 5940 | every call was refused (navigate) [search loop, loop head by the streak rule] |
| 3 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects | 10358 | read_page: the first read of this page state [off-key] |
| 4 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects/search/Harrison%20longitude%20watch%20… | 8176 | type: a search after a search with nothing opened between them (streak 2, rewording the one before it) [off-key, search loop] |
| 5 | Failed round | navigate ✗ | — | 15037 | every call was refused (navigate) |
| 6 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1788 | read_page: the first read of this page state |
| 7 | Acquisition with Progress | record_evidence, navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 8364 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 2782 | scroll: the scroll brought new material into view |
| 9 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 3389 | scroll: the scroll brought new material into view |
| 10 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 4255 | navigate: the settled page state moved to a page this Run had not acquired |
| 11 | Acquisition with Progress | record_evidence, navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 26240 | navigate: the settled page state moved to a page this Run had not acquired |
| 12 | Bookkeeping | record_evidence | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 11246 | record_evidence |
| 13 | Bookkeeping | record_candidate | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 9673 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 14 | Bookkeeping | record_candidate | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 38009 | record_candidate |
| 15 | Bookkeeping | record_candidate | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 5198 | record_candidate |
| 16 | Finalization | — | — | 17648 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (deadline_reached); tier investigation; 17 of 24 Tool Rounds used; 19 orchestrator rounds, 1 in Finalization; Run duration 347251 ms; LLM stage 262619 ms over 19 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 1 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 5 declared; Answer standings 5 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 4 (round 2, 7, 10, 13)
- of the rewrites, judged Off-key by the reviewer: 3
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 11 (61%) · Acquisition without Progress 3 (17%) · Collection 0 (0%) · Bookkeeping 3 (17%) · Failed round 1 (6%) · Finalization 1 (5%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 4, param 0, path 0
- Blocked Actions covered 1 (round 12), not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block 12 +1
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; declined at the deadline: no_tier_above (after round 18, replay: no judged call)
- **verdict: rounds wasted** — The attempt passed, so this is the only real inefficiency. Of the 18 budgeted rounds, 3 made no progress: round 1 (not-found page), round 12 (blocked typing) and round 13 (the second search of a loop). Another 4 acquisition rounds landed on off-key pages: rounds 2, 7, 10 and 11. In total 7 of 18 rounds (about 39%) brought no rule text. The work that counted was done in rounds 3–6, 8–9 and 14 on the two official rules pages and the help-centre FAQ page.
- stopped early: no — The attempt is graded pass with no unsatisfied checks, so there is nothing to judge. The run also ended on the deadline, not by stopping.
- answer omitted: no — The attempt is graded pass with no unsatisfied checks, so no check was left out of the Answer.
- Search Loop over rounds 12, 13: Round 12 typed a query into the help-centre search box. Round 13 ran another search (a rewritten navigate) with nothing opened in between, so this is a two-search streak, as the rule marked. Round 12's typing was blocked, so it added nothing, but it was still a search attempt.
- Off-key round 2 (https://duckduckgo.com/?q=uk+en+travel+info+luggage+site%3Aeurostar.com&ia=web): A search results page, not an official rules page. It cannot carry any required fact itself.
- Off-key round 7 (https://duckduckgo.com/?q=uk+en+travel+info+planning+musical+instruments+site%3Aeurostar.com&ia=web): A search results page produced by a rewritten navigate. No rule text is on it.
- Off-key round 10 (https://duckduckgo.com/?q=site%3Aeurostar.com&ia=web): A bare site search with no subject terms. It cannot carry any fact for this task.
- Off-key round 11 (https://help.eurostar.com/?language=uk-en&intcmp_HP_Header): The help-centre home page is a menu page. It links onward but does not itself state the allowance or the instrument rules.
- flag (round 12): The typing in round 12 was blocked by an overlay and never happened. Should it count as a failed round rather than acquisition without progress, and should it count as a search in the round 12–13 loop at all?
- flag (round 11): Round 11's help-centre home page led to the FAQ page used in round 14. Is it fair to call it off-key rather than a necessary stepping stone?
- flag (round 18): Round 18 was cut by the deadline, but the attempt still passed. Should failed_rounds be named anyway, given it did not cost the result?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:07e65407…, $0.15

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/luggage%E5%85%81%E8%AE%B8 | 28697 | navigate: landed on a Not-found Page [not found] |
| 2 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=uk+en+travel+info+luggage+site%3Aeurostar.com&ia=web | 8748 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 3 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2833 | navigate: the settled page state moved to a page this Run had not acquired |
| 4 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7170 | read_page: the first read of this page state |
| 5 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 11909 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7216 | scroll: the scroll brought new material into view |
| 7 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=uk+en+travel+info+planning+musical+instruments+site%3A… | 14948 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 8 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5090 | navigate: the settled page state moved to a page this Run had not acquired |
| 9 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 1961 | read_page: the first read of this page state |
| 10 | Acquisition with Progress | record_evidence, record_evidence, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 53874 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key, 1 rejected checkpoint] |
| 11 | Acquisition with Progress | navigate | https://help.eurostar.com/?language=uk-en&intcmp_HP_Header | 22547 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 12 | Acquisition without Progress | type | https://help.eurostar.com/?intcmp_HP_Header=&language=uk-en | 25030 | type: the result reports no page movement [search loop, loop head by the streak rule] |
| 13 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=faq+uk+en+question+What+luggage+can+I+take+onboard+sit… | 7714 | navigate: a search after a search with nothing opened between them (streak 2) [rewritten, search loop] |
| 14 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 2765 | navigate: the settled page state moved to a page this Run had not acquired |
| 15 | Bookkeeping | record_evidence | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 7061 | record_evidence |
| 16 | Bookkeeping | record_evidence | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 24503 | record_evidence |
| 17 | Bookkeeping | record_evidence | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 6953 | record_evidence |
| 18 | Failed round | — | — | 5056 | cut by the active-work deadline |
| 19 | Finalization | — | — | 18544 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 3 of 12 Tool Rounds used; 4 orchestrator rounds, 1 in Finalization; Run duration 60143 ms; LLM stage 56470 ms over 4 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 2 declared; Answer standings 2 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (33%) · Acquisition without Progress 1 (33%) · Collection 0 (0%) · Bookkeeping 1 (33%) · Failed round 0 (0%) · Finalization 1 (25%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- **verdict: rounds wasted** — This label is nominal: the attempt passed after using 3 of its 12 Tool Rounds (25%). The only round without Progress was round 1 (1 of 3 budgeted rounds, about 33%), which navigated again to https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, a page the initial attempt had already checkpointed. That re-acquisition was needed so the page could be read fresh in round 2. Round 2 was on-key Acquisition with Progress, round 3 was Bookkeeping, and there were no Off-key pages, loops or failed rounds. No category in the closed set describes a clean pass; the one repeat is the only cost there is to name.
- stopped early: no — The attempt was graded pass with no unsatisfied checks, so no check needed a page the Run had not read. It ended after 3 of 12 Tool Rounds, but only because the objective was met.
- answer omitted: no — There are no unsatisfied checks, so nothing on a page the Run had read was left out of the Answer.
- flag (round 1): Round 1's navigate was labelled Acquisition without Progress because the page was inherited. Should it count as necessary work, since the follow-up needed a fresh read of the same page to get the Premier allowance?
- flag: The attempt passed efficiently and no category in the closed set fits. Is rounds_wasted as primary too harsh when it rests on a single inherited re-navigate?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:3180ca3f…, $0.08

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9069 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 8514 | read_page: the first read of this page state |
| 3 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 11622 | record_evidence |
| 4 | Finalization | — | — | 27265 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- no_answer; ended failed; tier investigation; 2 of 24 Tool Rounds used; 3 orchestrator rounds, 0 in Finalization; Run duration 88673 ms; LLM stage 62852 ms over 3 joined round(s)
- grade unsuccessful; checks unsatisfied: fact-01, fact-02, fact-03, fact-04, fact-05, fact-06, fact-07, fact-08, fact-09 (9 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 7 declared; no standings on the Answer; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (33%) · Acquisition without Progress 1 (33%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 1 (33%) · Finalization 0 (0%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- Tier Escalations: none fired; none declined
- **verdict: failed rounds** — Round 3 failed (1 of 3 budgeted rounds, 33%), with the stop reason terminal. That ended the attempt after only 2 of 24 Tool Rounds and before any official source was opened. The failure is what cost the attempt its result.
- secondary: stopped early — The Run ended with 22 Tool Rounds unused, and all nine unsatisfied checks needed pages it never read. Both rounds that did run were off-key: round 1 guessed a URL and hit a 404, and round 2 landed on a search results page.
- stopped early: yes (fact-01, fact-02, fact-03, fact-04, fact-05, fact-06, fact-07, fact-08, fact-09) — The Run used 2 of 24 Tool Rounds and ran for about 89 seconds. It never read either official account. It read only a 404 page in round 1 and a search results page in round 2. So every unsatisfied check needed a page the Run had not read. The Run ended with budget left, and under the definition that counts as an early stop, even though the direct cause was the failed round 3.
- answer omitted: no — Neither page the Run read carries the material for any unsatisfied check. Round 1 landed on a 404, and round 2 landed on a search results page with no result opened. Nothing the Run read was left out of the Answer.
- Off-key round 1 (https://www.jpl.nasa.gov/news/voyager-has-not-yet-left-the-solar-system-or-has-it/): The URL was guessed and returned a 404 Not-found Page. It is the right site but has no content, so it can carry none of the required facts.
- Off-key round 2 (https://duckduckgo.com/?q=Voyager+1+has+not+yet+left+the+solar+system+June+2013+JPL+news&ia=web): This is a search results page. At most it points toward the official accounts, and it is not either of them. No result was opened before the Run failed.
- flag (round 3): Should stoppedEarly be true when the Run ended because of a terminal failed round rather than choosing to stop? It is marked true here under the literal definition, since budget and time were left.
- flag (round 2): Is a search results page that points toward the official sources off-key? Or should it count as on-key navigation, since the next step would have been to open a result?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:c7d8d32c…, $0.09

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/voyager-has-not-yet-left-the-solar-system-or-has-i… | 29240 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=Voyager+1+has+not+yet+left+the+solar+system+June+2013+… | 26590 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 3 | Failed round | — | — | 7022 | the round ended failed |

