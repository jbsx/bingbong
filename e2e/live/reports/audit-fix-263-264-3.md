# Round Audit — bingbong.live-web.information-hunts (fix-263-264-3)

Generated 2026-09-21T17:47:44.777Z from a capture set created 2026-09-21T17:33:59.206Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) e26f7f0d; mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p3; audit run at commit 30968502

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 80 | 75 | 73 | 1 | 38 (51%) → 36 | 23 (31%) → 25 | 0 (0%) | 9 (12%) | 5 (7%) | 5 (6%) |
| follow_up | 2 | 2 | 15 | 13 | 13 | 0 | 5 (39%) | 3 (23%) | 0 (0%) | 5 (39%) | 0 (0%) | 2 (13%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 1 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 0 | 1 | 1 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 12 Off-key round(s), 16 Search Loop round(s) by the reviewer (16 by the streak rule, heads included: 11 at streak 2 or beyond, 6 at 3 or beyond; attempts by search source rail 4, replay 0, none 0; navigate searches by Search URL form q 17, param 0, path 0; 0 covered, 1 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 1 recovery round(s) over 1 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 2 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 0 inherited, 1 rejected Evidence Checkpoint(s), 2 walled round(s), 5 navigate(s) landed on a Not-found Page (3 judged Off-key), 2 Composed Address(es) rewritten into a site search (1 judged Off-key, 0 to an address the Run was shown), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 2 Held Page round(s) without Progress, 4 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 1 skipped bookkeeping round(s), 1 Finalization round(s) cut by the Allowance (1 after a first token, 0 silent); first-token latency p50 2296 ms, p90 3334 ms over 80 round(s), 4 declared Asked Items (2 with an unverified standing, 1 shape failure(s), 1 retried), 0 stopped early, 1 answer omitted, 10 overrule(s), 15 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 1, objective_met 2
- follow_up: 1 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 1; navigate searches by Search URL form q 1, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 3 inherited, 1 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 1 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2146 ms, p90 4530 ms over 15 round(s), 2 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 1 answer omitted, 0 overrule(s), 5 flag(s); Finalization Causes: objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 33 (45%) | 5 (38%) |
| read_page | 18 (25%) | 3 (23%) |
| record_evidence | 13 (18%) | 5 (38%) |
| report_run_plan | 4 (5%) | 2 (15%) |
| scroll | 6 (8%) | 0 |
| look | 5 (7%) | 0 |
| click | 3 (4%) | 0 |
| record_candidate | 0 | 2 (15%) |

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
| superseded-voyager-interstellar | 0 | 1 | 0 | 0 | 1 | 1 | 0 |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 19 of 24 Tool Rounds used; 21 orchestrator rounds, 1 in Finalization; Run duration 168625 ms; LLM stage 160533 ms over 21 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 2 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (1 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 5 declared; Answer standings 5 stated, 0 unverified; 1 shape failure(s) (1 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 9 (45%) · Acquisition without Progress 6 (30%) · Collection 0 (0%) · Bookkeeping 4 (20%) · Failed round 1 (5%) · Finalization 1 (5%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 2, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — The attempt passed after using 19 of 24 Tool Rounds, so no shortfall cost it the result. The only waste is small, about 4 of 20 budgeted rounds after the overrules: the off-key Search Loop in rounds 11–12, the re-navigation to an already-acquired URL in round 15, and the failed round 20. The three verified sources were reached directly in rounds 1, 4 and 7. This is the closest label in the closed set, not a cause of failure.
- stopped early: no — The attempt was graded pass with no unsatisfied checks, so no check could have needed an unread page.
- answer omitted: no — There are no unsatisfied checks, so the Answer left nothing unstated that it had read.
- Search Loop over rounds 11, 12: Two DuckDuckGo searches in a row with nothing opened between them. Round 12 used new terms right after round 11's results page, and the loop ended when round 13 opened the GitHub README.
- Off-key round 11 (https://duckduckgo.com/?q=rpicam-still+autofocus+--af-mode+autofocus-on-capture+github+rpicam-apps&ia=web): A search results page. It lists links but cannot itself carry any required fact.
- Off-key round 12 (https://duckduckgo.com/?q=rpicam-apps+github+autofocus+control+documentation&ia=web): A search results page and a Search Loop member. It cannot carry any required fact.
- overrule round 3 → Acquisition with Progress: read_page part 2 of the accessories camera page came after part 1 in round 2. The rule matched the page signature and ignored the part, so this read brought in a different section. Round 10's evidence rests on this page's content.
- overrule round 6 → Acquisition with Progress: read_page part 1 of camera_software.html came after part 2 in round 5, so this is a different section. The legacy-stack warning recorded in round 7 (grounded in obs-8) appears to come from this read.
- overrule round 17 → Acquisition with Progress: read_page part 6 is a different section from part 8, read in round 16. The autofocus-on-capture excerpt recorded in round 19 was captured only after rounds 17 and 18.
- overrule round 18 → Acquisition with Progress: read_page part 7 is another section not yet read. It came just before the round-19 autofocus evidence, which is grounded in a later observation.
- flag: The attempt passed and no finding in the closed set really fits it. Should rounds_wasted stand as primary when the waste is only about 4 of 20 rounds and did not change the result?
- flag (round 3): Does reading a different part of a page with the same signature count as progress? The overrules of rounds 3, 6, 17 and 18 rest on that reading.
- flag (round 13): The GitHub rpicam-apps README only partly bears on fact-06 (the rename to rpicam-*). Is it on-key, given that it is not a verified source?
- flag (round 15): Round 15 navigated to a fragment anchor on an already-acquired page. Its later reads of new parts (rounds 16–18) made it useful. Should it stay without progress?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:770a4484…, $0.16

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 20123 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 2855 | read_page: the first read of this page state |
| 3 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 5858 | read_page: a repeat read of a page state already read |
| 4 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6091 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2178 | read_page: the first read of this page state |
| 6 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5860 | read_page: a repeat read of a page state already read |
| 7 | Acquisition with Progress | navigate, record_evidence | https://www.raspberrypi.com/products/camera-module-3/ | 17097 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 1303 | read_page: the first read of this page state |
| 9 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/camera-module-3 | 17954 | record_evidence |
| 10 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/camera-module-3 | 3352 | record_evidence |
| 11 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=rpicam-still+autofocus+--af-mode+autofocus-on-capture+… | 9867 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 12 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=rpicam-apps+github+autofocus+control+documentation&ia=… | 1676 | navigate: a search after a search with nothing opened between them (streak 2) [off-key, search loop] |
| 13 | Acquisition with Progress | navigate | https://github.com/raspberrypi/rpicam-apps/blob/main/README.md | 1490 | navigate: the settled page state moved to a page this Run had not acquired |
| 14 | Bookkeeping | record_evidence | https://github.com/raspberrypi/rpicam-apps/blob/main/README.md | 2777 | record_evidence |
| 15 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 1448 | navigate: a navigate to a URL this Run already acquired |
| 16 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 4604 | read_page: the first read of this page state |
| 17 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 3339 | read_page: a repeat read of a page state already read |
| 18 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 1276 | read_page: a repeat read of a page state already read |
| 19 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 4281 | record_evidence |
| 20 | Failed round | — | — | 29587 | the round completed with no tool call and no Answer |
| 21 | Finalization | — | — | 17517 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation; 10 of 24 Tool Rounds used; 11 orchestrator rounds, 1 in Finalization; Run duration 156702 ms; LLM stage 152631 ms over 11 joined round(s)
- grade useful_partial; checks unsatisfied: pitfall-01 (1 of 6)
- 0 Subagent round(s) over 0 Subagent(s); 6 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 2 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; Answer standings 3 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 4 (40%) · Acquisition without Progress 2 (20%) · Collection 0 (0%) · Bookkeeping 4 (40%) · Failed round 0 (0%) · Finalization 1 (9%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: answer omitted** — 5 of 6 checks were satisfied, using 4 progress rounds out of 10 (rounds 2, 4, 9, plus the search in round 1) and a budget that was only 42% used. The single failure, pitfall-01, comes from the Answer's inference about the replacement camera. Material read in round 4 already covered it, so the problem was not a lack of rounds or pages.
- stopped early: no — The Run ended with 14 of 24 Tool Rounds unused, but its one unsatisfied check did not need a page it had not read. The camera documentation read in round 4 (https://www.raspberrypi.com/documentation/accessories/camera.html) was enough to avoid it.
- answer omitted: yes (pitfall-01) — In rounds 7 and 10 the Run recorded and accepted a candidate that swaps in Camera Module 2. The Answer then offered that replacement without saying it loses the autofocus requirement. The camera documentation read in round 4 compares the modules, so this was already on a page the Run had read. The Answer left it unstated and fell into pitfall-01.
- Off-key round 1 (https://duckduckgo.com/?q=Raspberry+Pi+Camera+Module+3+dimensions+fit+official+Pi+Zero+Case+camera+lid&ia=web): A search results page. It lists links but cannot itself be the source for any required fact. The Run opened a result from it in the next round.
- flag (round 1): Should a search results page that led straight to a relevant product page in round 2 be counted as Off-key, or treated as a neutral step toward the sources?
- flag: pitfall-01 is a check about avoiding a wrong inference, not a missing fact. Is it right to count it under answerOmitted, based on the module comparison in the camera documentation read in round 4?
- flag (round 2): The Zero Case product page is not among the key's verified sources, but it bears directly on whether the camera fits the lid. Is counting it as on-key correct?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:6206ae2d…, $0.12

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=Raspberry+Pi+Camera+Module+3+dimensions+fit+official+P… | 7689 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 4532 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition without Progress | record_evidence, navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 15485 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 4 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 2135 | read_page: the first read of this page state |
| 5 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 40890 | record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 6 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 1547 | record_evidence |
| 7 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 2215 | record_candidate |
| 8 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 10245 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 9 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5739 | read_page: the first read of this page state |
| 10 | Bookkeeping | record_evidence, record_candidate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 31599 | record_evidence, record_candidate |
| 11 | Finalization | — | — | 30555 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 126844 ms; LLM stage 98825 ms over 26 joined round(s)
- grade useful_partial; checks unsatisfied: fact-08, fact-11 (2 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 1 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 1 round(s) cut by the Finalization Allowance (1 after a first token, 0 silent)
- Asked Items: 9 declared; Answer standings 6 stated, 3 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 3 (round 1, 2, 3)
- of those, judged Off-key by the reviewer: 3
- Composed Addresses rewritten into a site search: 1 (round 3)
- of the rewrites, judged Off-key by the reviewer: 1
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 14 (58%) · Acquisition without Progress 8 (33%) · Collection 0 (0%) · Bookkeeping 1 (4%) · Failed round 1 (4%) · Finalization 2 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 6, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — About 13 of 24 budgeted rounds made no progress. Rounds 1–5 were 404s and a blind search loop, round 9 was refused, rounds 10–11 were an illegible Look and an End of Page scroll, rounds 13–14 were a second search loop, and rounds 21–24 were illegible Looks or a repeat scroll. Only about 11 rounds were productive (6–8, 12, 15–18, 20, plus bookkeeping). The budget ran out while the Run was still trying to extract the case description.
- secondary: answer omitted — fact-08 and fact-11 sit on the case page the Run had read (rounds 15–20). Round 20 brought part of that description into view, yet the Answer left both checks unstated.
- stopped early: no — The Run used all 24 Tool Rounds (it ended on budget_exhausted), so it did not stop early.
- answer omitted: yes (fact-08, fact-11) — Both unsatisfied checks are carried on https://www.rmg.co.uk/collections/objects/rmgc-object-256323. The Run opened that page in round 15 and read it in round 17, and the round-20 Look put part of its description text in front of the assistant. The Answer did not state either check.
- Search Loop over rounds 1, 3, 4, 5: Round 1 searched rmg.co.uk and landed on a 404. Round 2 was another Not-found Landing, which does not break a loop. Round 3 was rewritten into a site search, round 4 was a walled Google search and round 5 a DuckDuckGo search. No result was opened until round 6.
- Search Loop over rounds 13, 14: Two DuckDuckGo searches in a row for the case record, with nothing opened between them. The loop ends when round 15 opens the case page.
- Off-key round 1 (https://www.rmg.co.uk/search-results?collection=1&q=Harrison%20longitude%20watch): A 404 page, so it can carry no required fact.
- Off-key round 2 (https://www.rmg.co.uk/collections-object-of-the-month/-/0/1): A 404 page, so it can carry no required fact.
- Off-key round 3 (https://www.rmg.co.uk/search-results?q=collections+site%3Armg.co.uk): A site search that landed on a 404.
- Off-key round 4 (https://www.google.com/search?q=rmg.co.uk+Harrison+H4+marine+timekeeper+object+ID): A walled search page (challenge) that showed no content.
- Off-key round 5 (https://duckduckgo.com/?q=rmg.co.uk+Harrison+H4+marine+timekeeper+catalogue&ia=web): A search results page, not a catalogue record.
- Off-key round 13 (https://duckduckgo.com/?q=%22ZAA0037.1%22+carrying+case+H4+K1+rmg&ia=web): A search results page, not a catalogue record.
- Off-key round 14 (https://duckduckgo.com/?q=rmg.co.uk+%22H4+and+K1%22+carrying+case+object&ia=web): A search results page, not a catalogue record.
- overrule round 13 → Acquisition without Progress: Its search opens the two-search loop with round 14 and landed only on a search results page. The record_evidence call in the same round is bookkeeping, not acquisition.
- overrule round 21 → Acquisition without Progress: The Look returned 'not legible', so it brought nothing new. Round 10, with the same outcome, was labelled without progress.
- overrule round 22 → Acquisition without Progress: It scrolled back up to y=277 on https://www.rmg.co.uk/collections/objects/rmgc-object-256323, a position already observed in rounds 16–17. That is a repeat state.
- overrule round 23 → Acquisition without Progress: The Look returned 'not legible' and brought in no material.
- overrule round 24 → Acquisition without Progress: The Look returned 'not legible' and brought in no material.
- flag (round 2): Is round 2, a navigate to a 404 page with no search, rightly treated as not breaking the search loop of rounds 1–5?
- flag (round 13): Should round 13 be overruled to without progress, given that it also held an accepted record_evidence and its search was the first one after the H4 record was read?
- flag (round 22): Is scrolling back up to y=277 a repeat state, or did it bring new material into view as the mechanical label says?
- flag (round 17): Did the round-17 read_page text carry the side placement and the full dating description? If not, should fact-08 and fact-11 count as a page not fully read rather than as material the Answer omitted?
- flag: Should answer_omitted be the primary verdict instead of rounds_wasted, since both unsatisfied checks were on a page the Run had read?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:1f9ba5bb…, $0.20

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.rmg.co.uk/search-results?collection=1&q=Harrison%20longitude%20watch | 5598 | navigate: landed on a Not-found Page [not found, off-key, search loop, loop head by the streak rule] |
| 2 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections-object-of-the-month/-/0/1 | 2430 | navigate: landed on a Not-found Page [not found, off-key] |
| 3 | Acquisition without Progress | navigate | https://www.rmg.co.uk/search-results?q=collections+site%3Armg.co.uk | 2297 | navigate: landed on a Not-found Page [not found, rewritten, off-key, search loop] |
| 4 | Acquisition without Progress | navigate | https://www.google.com/search?q=rmg.co.uk+Harrison+H4+marine+timekeeper+object+I… | 2134 | navigate: a search after a search with nothing opened between them (streak 3) [walled, off-key, search loop] |
| 5 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=rmg.co.uk+Harrison+H4+marine+timekeeper+catalogue&ia=w… | 1555 | navigate: a search after a search with nothing opened between them (streak 4, rewording the one before it) [off-key, search loop] |
| 6 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1966 | navigate: the settled page state moved to a page this Run had not acquired |
| 7 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2882 | read_page: the first read of this page state |
| 8 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2789 | scroll: the scroll brought new material into view |
| 9 | Failed round | read_page ✗ | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2256 | every call was refused (read_page) |
| 10 | Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2147 | look: the Look returned nothing legible |
| 11 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1818 | scroll: a scroll that answered End of Page |
| 12 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2375 | read_page: the first read of this page state |
| 13 | Acquisition with Progress → Acquisition without Progress | record_evidence, navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 6809 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 14 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=rmg.co.uk+%22H4+and+K1%22+carrying+case+object&ia=web | 4091 | navigate: a search after a search with nothing opened between them (streak 2) [off-key, search loop] |
| 15 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1389 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1712 | scroll: the scroll brought new material into view |
| 17 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1905 | read_page: the first read of this page state |
| 18 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1315 | scroll: the scroll brought new material into view |
| 19 | Bookkeeping | record_evidence | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 2751 | record_evidence |
| 20 | Acquisition with Progress | look | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 6288 | look: the first Look at this page state with this question |
| 21 | Acquisition with Progress → Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 5169 | look: the first Look at this page state with this question |
| 22 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1741 | scroll: the scroll brought new material into view |
| 23 | Acquisition with Progress → Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1766 | look: the first Look at this page state with this question |
| 24 | Acquisition with Progress → Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 5071 | look: the first Look at this page state with this question |
| 25 | Finalization | — | — | 12689 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 15882 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier lookup; 7 of 12 Tool Rounds used; 8 orchestrator rounds, 1 in Finalization; Run duration 112760 ms; LLM stage 107651 ms over 8 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 5 declared; Answer standings 5 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 5 (71%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 2 (29%) · Failed round 0 (0%) · Finalization 1 (13%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 2), hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — This verdict is nominal because the attempt passed using 7 of its 12 Tool Rounds. The only loss is minor. Round 1 was an off-key search results page, 1 of 5 acquisition rounds. Rounds 6 and 7 were bookkeeping, 2 of 7 budgeted rounds, and round 7 re-recorded evidence after round 6's checkpoint was rejected. Rounds 2 to 5 read both official pages, all on-key and productive.
- stopped early: no — The attempt passed with no unsatisfied checks, so no check needed an unread page.
- answer omitted: no — The attempt passed with no unsatisfied checks, so the Answer left no required material unstated.
- Off-key round 1 (https://duckduckgo.com/?q=eurostar.com+luggage+allowance+what+can+I+take+on+board&ia=web): This is a search results page. It led to the official luggage page but cannot itself carry any required fact.
- flag (round 1): Should the search in round 1 count as off-key, given that it was the step that found the official luggage page opened in round 2?
- flag (round 7): Should round 7 count as waste, since it only re-recorded evidence that round 6's rejected checkpoint had failed to record?
- flag: The attempt passed with budget to spare, so no verdict in the closed set really fits. Should rounds_wasted be read as nominal here?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:f68109fd…, $0.10

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=eurostar.com+luggage+allowance+what+can+I+take+on+boar… | 10328 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2677 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2368 | read_page: the first read of this page state |
| 4 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 3916 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 1358 | read_page: the first read of this page state |
| 6 | Bookkeeping | record_evidence, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 48043 | record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 7 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 3279 | record_evidence |
| 8 | Finalization | — | — | 35682 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 3 of 12 Tool Rounds used; 4 orchestrator rounds, 1 in Finalization; Run duration 33961 ms; LLM stage 32640 ms over 4 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 1 declared; Answer standings 1 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (33%) · Acquisition without Progress 1 (33%) · Collection 0 (0%) · Bookkeeping 1 (33%) · Failed round 0 (0%) · Finalization 1 (25%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — The attempt passed using 3 of its 12 Tool Rounds, so no failure mode applies. This label is used only because the schema requires one. It rests on the single round without Progress, round 1 (1 of 3 budgeted rounds, about 33%). That round re-navigated to https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, which the initial attempt had already checkpointed. The navigation was cheap, and round 2's read of the same page supplied the evidence recorded in round 3. Nothing was actually lost.
- stopped early: no — The grade is a pass and no check is unsatisfied, so no check needed a page the Run had not read. The Run ended with objective_met after 3 of 12 Tool Rounds.
- answer omitted: no — No check is unsatisfied, so no material the Run had read was left out of the Answer.
- flag (round 1): The navigate in round 1 is labelled acquisition_without_progress because the page was inherited. The page still had to be reopened before round 2 could read it. Should this count as necessary setup rather than a repeat?
- flag: The attempt passed with no unsatisfied checks. Should a verdict be recorded at all, given that rounds_wasted is a forced placeholder here and does not describe a real failure?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:fbe555ce…, $0.07

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5714 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2259 | read_page: the first read of this page state |
| 3 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 12034 | record_evidence |
| 4 | Finalization | — | — | 12633 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / partial (deadline_reached); tier investigation; 23 of 24 Tool Rounds used; 25 orchestrator rounds, 1 in Finalization; Run duration 353891 ms; LLM stage 261370 ms over 25 joined round(s)
- grade useful_partial; checks unsatisfied: fact-01 (1 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); 1 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 1 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 8 declared; Answer standings 7 stated, 1 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 2 (round 1, 2)
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 1 (round 5)
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 10 (42%) · Acquisition without Progress 9 (38%) · Collection 0 (0%) · Bookkeeping 2 (8%) · Failed round 3 (13%) · Finalization 1 (4%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 8, param 0, path 0
- Blocked Actions covered 0, not shown 1 (round 18), inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block 18 +1
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — At least 11 of the 24 budgeted rounds brought nothing usable. Rounds 1–5 went to a 404 page and a search loop. Rounds 9–12 were a second loop, with round 9 overruled to without-progress. Rounds 17–18 were spent on an off-subject release. That leaves 9 productive acquisition rounds after the overrule. The Run found the March release (round 16) instead of the June account, and had no rounds left to look for the June account needed for fact-01 when the deadline arrived.
- secondary: failed rounds — Rounds 22–24 (3 of 24) were lost: a navigate hung in round 21, the next two rounds were refused as a result, and round 24 was cut by the deadline. These were the Run's last chance to reach another official release.
- stopped early: no — The Run ended on the active-work deadline (deadline_reached), with 23 of 24 Tool Rounds used and round 24 cut. It did not end with both rounds and time left, so this is not an early stop, even though fact-01 needed a page the Run never read.
- answer omitted: no — fact-01 depends on the June account (verified source S1), which the Run never opened. The only early-2013 release it read was the archived March release 2013-107 (rounds 7, 16). Nothing in the digest shows that any page it read (2013-107, the Ed Stone Q&A, 2013-278) carries this check.
- Search Loop over rounds 2, 3, 4, 5: Four searches in a row with nothing opened between them: a JPL site search (round 2), a walled Google search (round 3), a DuckDuckGo search (round 4), and a composed JPL URL that was rewritten into a site search (round 5). The first thing opened was the click in round 6.
- Search Loop over rounds 9, 10, 11, 12: Four DuckDuckGo searches in a row, rounds 9–12, with nothing opened between them. The record_evidence call in round 9 is bookkeeping and puts no page in front of the assistant. The loop ends with the click in round 13.
- Off-key round 17 (https://web.archive.org/web/20140105053444/http://www.jpl.nasa.gov/news/news.php?release=2013-229): Right site, wrong subject: this archived JPL release is about Earth images taken by a distant spacecraft, not either of the two Voyager 1 accounts the task asks for.
- Off-key round 18 (https://web.archive.org/web/20140105053444/http://www.jpl.nasa.gov/news/news.php?release=2013-229): The click failed on the same off-subject page and moved nothing.
- overrule round 9 → Acquisition without Progress: The navigate in this round is a search that opens the four-search loop running through round 12. Search Loop members count as Acquisition without Progress, even though the rule marked this one as progress because it was streak 1.
- flag (round 16): Should the archived March release 2013-107 (also read in rounds 6–8) count as off-key? It is not one of the two accounts the task names, but it may carry the missing-sign material that fact-04 needs.
- flag (round 9): Is round 9 rightly overruled to without-progress as the first member of a loop, given that the rule counted it as progress at streak 1?
- flag: Would failed_rounds be a better primary verdict, since the deadline and the hung navigate in rounds 21–24 ended the Run while it was still doing on-key work?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:b67f0e48…, $0.20

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/nasa-provides-voyager-1-update/ | 26824 | navigate: landed on a Not-found Page [not found] |
| 2 | Acquisition without Progress | navigate | https://www.jpl.nasa.gov/search.php?q=Voyager+1+has+not+yet+left+the+solar+syste… | 1966 | navigate: landed on a Not-found Page [not found, search loop, loop head by the streak rule] |
| 3 | Acquisition without Progress | navigate | https://www.google.com/search?q=JPL+June+2013+%22Voyager+1%22+%22has+not+yet+lef… | 1918 | navigate: a search after a search with nothing opened between them (streak 2, rewording the one before it) [walled, search loop] |
| 4 | Acquisition without Progress | navigate | https://html.duckduckgo.com/html/?q=site%3Ajpl.nasa.gov+voyager+1+has+not+yet+le… | 3410 | navigate: a search after a search with nothing opened between them (streak 3, rewording the one before it) [search loop] |
| 5 | Acquisition without Progress | navigate | https://html.duckduckgo.com/html/?q=news+nasa+voyager+status+update+on+location+… | 4456 | navigate: a search after a search with nothing opened between them (streak 4) [rewritten, search loop] |
| 6 | Acquisition with Progress | click | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 3293 | click: the settled page state moved |
| 7 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 2493 | read_page: the first read of this page state |
| 8 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 2737 | scroll: the scroll brought new material into view |
| 9 | Acquisition with Progress → Acquisition without Progress | record_evidence, navigate | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 3208 | navigate: the settled page state moved to a page this Run had not acquired [search loop, loop head by the streak rule] |
| 10 | Acquisition without Progress | navigate | https://html.duckduckgo.com/html/?q=NASA+%22Voyager+1%22+%22Sept.+12%2C+2013%22+… | 2675 | navigate: a search after a search with nothing opened between them (streak 2) [search loop] |
| 11 | Acquisition without Progress | navigate | https://html.duckduckgo.com/html/?q=site%3Ascience.nasa.gov+OR+site%3Anasa.gov+%… | 3824 | navigate: a search after a search with nothing opened between them (streak 3) [search loop] |
| 12 | Acquisition without Progress | navigate | https://html.duckduckgo.com/html/?q=site%3Anasa.gov+voyager+1+interstellar+space… | 7049 | navigate: a search after a search with nothing opened between them (streak 4) [search loop] |
| 13 | Acquisition with Progress | click | https://science.nasa.gov/mission/voyager/questions-and-answers-with-dr-ed-stone/ | 1268 | click: the settled page state moved |
| 14 | Acquisition with Progress | read_page | https://science.nasa.gov/mission/voyager/questions-and-answers-with-dr-ed-stone/ | 1304 | read_page: the first read of this page state |
| 15 | Bookkeeping | record_evidence | https://science.nasa.gov/mission/voyager/questions-and-answers-with-dr-ed-stone | 62923 | record_evidence |
| 16 | Acquisition with Progress | navigate | https://web.archive.org/web/20131126043936/http://www.jpl.nasa.gov/news/news.php… | 13383 | navigate: the settled page state moved to a page this Run had not acquired |
| 17 | Acquisition with Progress | record_evidence, navigate | https://web.archive.org/web/20131126043936/http://www.jpl.nasa.gov/news/news.php… | 52876 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 18 | Acquisition without Progress | click | https://web.archive.org/web/20140105053444/http://www.jpl.nasa.gov/news/news.php… | 3377 | click: the result reports no page movement [off-key] |
| 19 | Acquisition with Progress | navigate | https://web.archive.org/web/20141222010135/http://www.jpl.nasa.gov/news/news.php… | 1752 | navigate: the settled page state moved to a page this Run had not acquired |
| 20 | Acquisition with Progress | read_page | https://web.archive.org/web/20141222010135/http://www.jpl.nasa.gov/news/news.php… | 1368 | read_page: the first read of this page state |
| 21 | Bookkeeping | record_evidence, navigate ✗ | https://web.archive.org/web/20141222010135/http://www.jpl.nasa.gov/news/news.php… | 23515 | record_evidence, navigate |
| 22 | Failed round | navigate ✗ | — | 2015 | every call was refused (navigate) |
| 23 | Failed round | read_page ✗ | https://web.archive.org/web/20141222010135/http://www.jpl.nasa.gov/news/news.php… | 1971 | every call was refused (read_page) |
| 24 | Failed round | — | — | 4711 | cut by the active-work deadline |
| 25 | Finalization | — | — | 27054 | the reserved Answer |

