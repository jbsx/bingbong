# Round Audit — bingbong.live-web.information-hunts (baseline-2)

Generated 2026-09-14T11:58:54.837Z from a capture set created 2026-09-12T18:10:26.845Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 6152d8dc (dirty tree); mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p1; audit run at commit 4586e413

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 102 | 95 | 95 | 3 | 66 (70%) → 63 | 11 (12%) → 14 | 0 (0%) | 6 (6%) | 12 (13%) | 7 (7%) |
| follow_up | 2 | 2 | 45 | 42 | 42 | 1 | 28 (67%) | 5 (12%) | 0 (0%) | 7 (17%) | 2 (5%) | 3 (7%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 2 | 0 | 0 |

- initial: 12 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 0, replay 3, none 1), 0 inherited, 5 rejected Evidence Checkpoint(s), 1 walled round(s), 2 navigate(s) landed on a Not-found Page (1 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 0 stopped early, 5 overrule(s), 21 flag(s); Finalization Causes: budget_exhausted 3, objective_met 1
- follow_up: 19 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 0, replay 2, none 0), 2 inherited, 4 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 0 stopped early, 0 overrule(s), 10 flag(s); Finalization Causes: budget_exhausted 1, objective_met 1

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| scroll | 34 (36%) | 16 (38%) |
| navigate | 27 (28%) | 12 (29%) |
| look | 12 (13%) | 4 (10%) |
| record_evidence | 7 (7%) | 6 (14%) |
| click | 6 (6%) | 2 (5%) |
| read_page | 7 (7%) | 1 (2%) |
| report_run_plan | 4 (4%) | 2 (5%) |
| record_candidate | 0 | 3 (7%) |
| type | 2 (2%) | 0 |
| ground_visual | 1 (1%) | 0 |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (budget_exhausted); tier investigation (1 Tier Escalation(s) at the deadline); 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 401400 ms; LLM stage 389039 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-05 (1 of 10)
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- kinds: Acquisition with Progress 15 (63%) · Acquisition without Progress 5 (21%) · Collection 0 (0%) · Bookkeeping 1 (4%) · Failed round 3 (13%) · Finalization 2 (8%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: rounds wasted** — With rounds 11 and 17 overruled, 7 of 24 budgeted rounds (29%) had no Progress: rounds 1 (a 404), 5, 7, 11, 12, 17 and 18. Another 3 (12.5%) were refused look calls: rounds 8, 13 and 16. Rounds 10 and 15 opened raw.githubusercontent pages that the tools could not render, and both files had to be fetched again at rounds 14 and 19. That is about 12 of 24 rounds (50%) lost to repeats and dead ends. Meanwhile the camera_software.adoc page reached at round 20 was never read, and the unreached fact-05 sits on that path. Round 21 took the libcamera_differences page instead, and rounds 23–24 went to rpicam_still, with the budget warnings at rounds 18 and 21 already out. The work was on-key, but half the budget went to rounds that brought nothing new.
- stopped early: no — The Run used all 24 budgeted Tool Rounds (budget_exhausted) before the Finalization rounds 25–26, so it did not stop with budget left.
- Off-key round 1 (https://www.raspberrypi.com/documentation/computers/camera.html): The navigate landed on a Not-found Page (title 'Page not found – Raspberry Pi'). A 404 can carry none of the required facts, even though the site and subject were right.
- overrule round 11 → Acquisition without Progress: The read_page on the raw cm3.adoc returned only the page header, with no body text (6 output tokens). The next round hit End of Page, a look was refused, and the evidence for this file was later grounded in the GitHub-rendered copy from round 14. The read brought in no material.
- overrule round 17 → Acquisition without Progress: Same pattern as round 11: the read_page on the raw install.adoc returned only the header, with no text. Round 18 answered End of Page and the Run had to re-acquire the file through the GitHub blob view in round 19, where memory-1 is grounded. No new material came in.
- flag (round 11): Is it right to overrule round 11 to acquisition_without_progress? The digest shows only the result head, so the read_page may have returned text that the head cut off.
- flag (round 17): Is it right to overrule round 17 to acquisition_without_progress? It rests on the same truncated result head as round 11.
- flag (round 10): Should rounds 10 and 15 (the raw.githubusercontent .adoc files) count as Off-key or as without Progress? The files are on-key in subject, but the tools could not render them and the same files were re-acquired at rounds 14 and 19.
- flag (round 20): Was the GitHub camera_software.adoc page at round 20 able to carry fact-05 itself, or is it only a list of includes? The answer decides whether fact-05 was one read away or needed further navigation.
- flag (round 21): Could the libcamera_differences.adoc page at round 21 carry fact-05 (it compares the legacy and current stacks), or did it cover only option differences? A careful reader might call it borderline Off-key for fact-05 while it stays on-key for fact-06.
- flag: Should failed_rounds be a secondary verdict? The three refused looks (rounds 8, 13, 16, 12.5% of budget) are counted here as part of the waste, not as the cause of the missed check.
- flag: Is tier_too_small_or_never_escalated a defensible secondary? The Run ran at investigation tier with no Tier Escalation and was cut off by the budget while still making on-key progress at rounds 19–24.
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:f7591b07…, $0.20

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 223259 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 5735 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 7950 | scroll: the scroll brought new material into view |
| 4 | Acquisition with Progress | click | https://www.raspberrypi.com/documentation/accessories/camera.html#camera-module-… | 6456 | click: the settled page state moved |
| 5 | Acquisition without Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 4324 | scroll: a scroll that answered End of Page |
| 6 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html#camera-module-… | 2340 | read_page: the first read of this page state |
| 7 | Acquisition without Progress | look | https://www.raspberrypi.com/documentation/accessories/camera.html | 3826 | look: the Look returned nothing legible |
| 8 | Failed round | look ✗ | https://www.raspberrypi.com/documentation/accessories/camera.html | 7389 | every call was refused (look) |
| 9 | Acquisition with Progress | navigate | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 10080 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Acquisition with Progress | navigate | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 5837 | navigate: the settled page state moved to a page this Run had not acquired |
| 11 | Acquisition with Progress → Acquisition without Progress | read_page | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 1248 | read_page: the first read of this page state |
| 12 | Acquisition without Progress | scroll | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 2103 | scroll: a scroll that answered End of Page |
| 13 | Failed round | look ✗ | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 4488 | every call was refused (look) |
| 14 | Acquisition with Progress | navigate | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 9417 | navigate: the settled page state moved to a page this Run had not acquired |
| 15 | Acquisition with Progress | navigate | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 14381 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Failed round | look ✗ | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 3967 | every call was refused (look) |
| 17 | Acquisition with Progress → Acquisition without Progress | read_page | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 3951 | read_page: the first read of this page state |
| 18 | Acquisition without Progress | scroll | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 1659 | scroll: a scroll that answered End of Page |
| 19 | Acquisition with Progress | navigate | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 5250 | navigate: the settled page state moved to a page this Run had not acquired |
| 20 | Acquisition with Progress | navigate, record_evidence, record_evidence | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 30319 | navigate: the settled page state moved to a page this Run had not acquired |
| 21 | Acquisition with Progress | navigate | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 2364 | navigate: the settled page state moved to a page this Run had not acquired |
| 22 | Bookkeeping | record_evidence | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 6262 | record_evidence |
| 23 | Acquisition with Progress | navigate | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 4518 | navigate: the settled page state moved to a page this Run had not acquired |
| 24 | Acquisition with Progress | scroll | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 2272 | scroll: the scroll brought new material into view |
| 25 | Finalization | record_evidence | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 3063 | the bookkeeping round (record_evidence) |
| 26 | Finalization | — | — | 16581 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (budget_exhausted); tier investigation (1 Tier Escalation(s) at the deadline); 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 355038 ms; LLM stage 340027 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-02 (1 of 6)
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 2 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 18 (75%) · Acquisition without Progress 3 (13%) · Collection 0 (0%) · Bookkeeping 3 (13%) · Failed round 0 (0%) · Finalization 2 (8%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — 13 of 24 budgeted rounds (54%) went to the Camera Module 3 product page (rounds 1-13, plus round 14, which hit End of Page). Most of those were scrolls through feature marketing that could not carry fact-01 or fact-02. Round 12 exposed a link to the verified documentation page, but the Run did not go there until round 19. Rounds 16-18 went to a search results page, a walled forum page and an inherited re-acquisition, and round 20 re-navigated a URL already acquired. Round 15 found the lid verdict on the Zero Case product page. The one Look at the verified source (round 21) came with 3 rounds left, and the rest of the budget went to bookkeeping (rounds 22-24), one call of which was rejected as malformed. fact-02 was never reached, although the page that carries it was open from round 19.
- stopped early: no — The Run used all 24 budgeted Tool Rounds and ended with budget_exhausted, so it did not stop early.
- Off-key round 1 (https://www.raspberrypi.com/products/camera-module-3/): Camera Module 3 product page. It is a source for the initial task, but it has no case-lid or mechanical-fit material, so it cannot carry fact-01 or fact-02. fact-03 restates earlier conclusions and does not need a re-read.
- Off-key round 2 (https://www.raspberrypi.com/products/camera-module-3/): A click on the same product page. The subject is still the camera's features, not whether it fits the Zero Case lid.
- Off-key round 3 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in intro marketing text. It is the wrong subject for the enclosure question.
- Off-key round 4 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in pricing and lens-variant text. Nothing on it bears on the lid.
- Off-key round 5 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in sensor and autofocus marketing text. It is about features, not mechanical fit.
- Off-key round 6 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in the wide-lens section. It is the wrong subject.
- Off-key round 7 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in the section on the no-IR-filter variant. It is the wrong subject.
- Off-key round 8 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in a video embed and frame-rate text. It is the wrong subject.
- Off-key round 9 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in the developer and libcamera blurb. It says nothing about lid fit.
- Off-key round 10 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in the beginner software blurb and a link. It says nothing about lid fit.
- Off-key round 11 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in only a link to the Picamera2 manual. It is the wrong subject.
- Off-key round 12 (https://www.raspberrypi.com/products/camera-module-3): This scroll exposed a link to the documentation page that is the follow-up's verified source, but the product page itself still carries no lid facts. The run did not follow that link until round 19.
- Off-key round 13 (https://www.raspberrypi.com/products/camera-module-3): This scroll brought in image-gallery buttons. It is the wrong subject.
- Off-key round 16 (https://duckduckgo.com/?q=Camera+Module+3+Raspberry+Pi+Zero+Case+camera+lid+not+compatible&ia=web): A search results page. It can point to sources but cannot itself carry a required fact.
- Off-key round 17 (https://forums.raspberrypi.com/viewtopic.php?t=395459): Walled page: the title 'Just a moment...' is a bot-check interstitial, and no forum content loaded.
- flag (round 1): Should rounds 1-13 on the Camera Module 3 product page count as off-key? That page is a source for the initial task and could be read as re-supporting fact-03, the continuity of the earlier conclusions.
- flag (round 18): Is the GitHub cm3.adoc page on-key? It is the documentation source file behind the Camera Module 3 section and might hold the mechanical text for fact-02, but the round was mechanically labeled an inherited repeat.
- flag (round 21): The Look on the verified documentation page asked about dimensions and case compatibility but did not surface fact-02. Was that the page failing to show the mechanical section, or the question and scroll position missing it? If the former, is 'tier_too_small_or_never_escalated' a fair secondary verdict, since no Tier Escalation happened and the budget ran out right after the right page was reached?
- flag (round 22): Round 22's record_candidate was rejected as malformed, costing a budgeted round. Should it be read as a partly failed round instead of plain Bookkeeping?
- flag: Is rounds_wasted the right primary verdict, given that about half the waste was on an official, related page and not on unrelated sites?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:55f47c8a…, $0.22

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, record_evidence, navigate | https://www.raspberrypi.com/products/camera-module-3/ | 143973 | navigate: the settled page state moved to a page this Run had not acquired [off-key, 1 rejected checkpoint] |
| 2 | Acquisition with Progress | click | https://www.raspberrypi.com/products/camera-module-3/ | 7503 | click: the settled page state moved [off-key] |
| 3 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 5100 | scroll: the scroll brought new material into view [off-key] |
| 4 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 5194 | scroll: the scroll brought new material into view [off-key] |
| 5 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 4734 | scroll: the scroll brought new material into view [off-key] |
| 6 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 7496 | scroll: the scroll brought new material into view [off-key] |
| 7 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 1600 | scroll: the scroll brought new material into view [off-key] |
| 8 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 4144 | scroll: the scroll brought new material into view [off-key] |
| 9 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 3901 | scroll: the scroll brought new material into view [off-key] |
| 10 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 3978 | scroll: the scroll brought new material into view [off-key] |
| 11 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 4420 | scroll: the scroll brought new material into view [off-key] |
| 12 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 3891 | scroll: the scroll brought new material into view [off-key] |
| 13 | Acquisition with Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 4051 | scroll: the scroll brought new material into view [off-key] |
| 14 | Acquisition without Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 1419 | scroll: a scroll that answered End of Page |
| 15 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 7107 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 26558 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 17 | Acquisition with Progress | click | https://forums.raspberrypi.com/viewtopic.php?t=395459 | 3178 | click: the settled page state moved [off-key] |
| 18 | Acquisition without Progress | navigate | https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/… | 33793 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 19 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 1949 | navigate: the settled page state moved to a page this Run had not acquired |
| 20 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html#camera-module-… | 1563 | navigate: a navigate to a URL this Run already acquired |
| 21 | Acquisition with Progress | look | https://www.raspberrypi.com/documentation/accessories/camera.html | 4899 | look: the first Look at this page state with this question |
| 22 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 15689 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 23 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 7715 | record_candidate |
| 24 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 8190 | record_candidate |
| 25 | Finalization | — | — | 10002 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 17980 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 216821 ms; LLM stage 196001 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-03, fact-05, fact-08, fact-09, fact-10, fact-11 (6 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 14 (58%) · Acquisition without Progress 4 (17%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 6 (25%) · Finalization 2 (8%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — Rounds 1–9 went to the walled page, landing pages and search results. Seven of the 14 mechanical with-progress rounds (1, 2, 3, 6, 7, 8, 9) are off-key. Once on S1, rounds 12–18 cycled up and down between y=277 and end of page. After overrules, rounds 13, 16, 17 and 18 are repeats without progress, and round 15 was refused as a repeat. The S2 case record, linked from S1, was never opened, so fact-08 to fact-11 were never reached. Fact-03 and fact-05, which S1 carries, were not reached either. On-key productive rounds come to roughly 6 of 24 (11, 12, 14, 21, 22, 24).
- secondary: failed rounds — 6 of 24 budgeted rounds (25%) failed: refused looks in 5, 19 and 20, an aborted navigate in 10, a refused repeat scroll in 15 and an unresolvable API host in 23. Rounds 19–20 alone cost two of the last six rounds, rounds that could have reached S2.
- stopped early: no — The Run used all 24 of its 24 budgeted rounds and ended on budget_exhausted.
- Off-key round 1 (https://collections.rmg.co.uk/search/?searchString=Harrison%20H4): 401 Authorization Required: a walled page that carries no record content.
- Off-key round 2 (https://www.rmg.co.uk/search?q=Harrison%20H4%20watch): Site-wide search results page; lists links, not the object record's fields.
- Off-key round 3 (https://www.rmg.co.uk/collections): Collections landing page on the right site but no object record on it.
- Off-key round 6 (https://www.rmg.co.uk/collections): Click on the landing page that cleared an overlay; still no record content.
- Off-key round 7 (https://www.rmg.co.uk/collections/search/Harrison%20H4): Search results page; a route to the records, not a carrier of any required fact.
- Off-key round 8 (https://www.rmg.co.uk/collections/search/Harrison%20H4): Reading the same search results page; holds result links only.
- Off-key round 9 (https://www.rmg.co.uk/collections/objects/search/Harrison%20H4): Filtered collection results listing; no record detail fields.
- overrule round 11 → Acquisition with Progress: Round 10's navigate to rmgc-object-79142 was aborted, so round 11 is the Run's first successful arrival at S1. The no-progress Notice does not reflect the page actually acquired.
- overrule round 16 → Acquisition without Progress: Scrolling up to y=277 put the Run back in the state it already saw in round 12, with the same 'Next image' button. It repeats an observed state.
- overrule round 18 → Acquisition without Progress: A third return to the y=277 state seen in rounds 12 and 16, part of an up/down cycle on S1 that brought in nothing new.
- flag (round 2): Should rounds 1, 2 and 7 count as one Search Loop for 'Harrison H4', given that each tries a different search surface and rounds 3–6 are navigation between them?
- flag (round 11): Is the upgrade to with-progress right, when the app issued a no-progress Notice after round 10's aborted attempt at the same URL?
- flag (round 24): Is ?view=full on rmgc-object-79142 a genuinely new page state, or a re-acquisition of S1 that should count as without progress?
- flag (round 22): The click in round 22 changed the page signature on S1 but has no recorded outcome for the details table. Does it deserve with-progress?
- flag: Should failed_rounds be primary instead? 25% failed rounds is close to the combined off-key and repeat share, and the refusals in 19–20 came right before the budget ran out.
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:2ba76696…, $0.19

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://collections.rmg.co.uk/search/?searchString=Harrison%20H4 | 55187 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.rmg.co.uk/search?q=Harrison%20H4%20watch | 2260 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 3 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections | 4165 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 4 | Acquisition without Progress | type | https://www.rmg.co.uk/collections | 6532 | type: the result reports no page movement |
| 5 | Failed round | look ✗ | https://www.rmg.co.uk/collections | 7494 | every call was refused (look) |
| 6 | Acquisition with Progress | click | https://www.rmg.co.uk/collections | 7622 | click: the settled page state moved [off-key] |
| 7 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/search/Harrison%20H4 | 5097 | type: the settled page state moved [off-key] |
| 8 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/search/Harrison%20H4 | 1296 | read_page: the first read of this page state [off-key] |
| 9 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects/search/Harrison%20H4?_gl=1*1debyfs*_up… | 1761 | click: the settled page state moved [off-key] |
| 10 | Failed round | navigate ✗ | — | 2288 | every call was refused (navigate) |
| 11 | Acquisition without Progress → Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1786 | navigate: the app’s own no-progress Notice rode the result |
| 12 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 6700 | scroll: the scroll brought new material into view |
| 13 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2769 | scroll: a scroll that answered End of Page |
| 14 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 4568 | read_page: the first read of this page state |
| 15 | Failed round | scroll ✗ | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 7097 | every call was refused (scroll) |
| 16 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1454 | scroll: the scroll brought new material into view |
| 17 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1361 | scroll: a scroll that answered End of Page |
| 18 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1327 | scroll: the scroll brought new material into view |
| 19 | Failed round | look ✗ | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 28474 | every call was refused (look) |
| 20 | Failed round | look ✗ | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2858 | every call was refused (look) |
| 21 | Acquisition with Progress | ground_visual | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1649 | ground_visual: the first Look at this page state with this question |
| 22 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 3933 | click: the settled page state moved |
| 23 | Failed round | navigate ✗ | — | 9886 | every call was refused (navigate) |
| 24 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142?view=full | 1920 | navigate: the settled page state moved to a page this Run had not acquired |
| 25 | Finalization | — | — | 10000 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 16517 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier investigation (1 Tier Escalation(s) at the deadline); 23 of 24 Tool Rounds used; 24 orchestrator rounds, 1 in Finalization; Run duration 382039 ms; LLM stage 374300 ms over 24 joined round(s)
- grade useful_partial; checks not reached: fact-03, fact-07, fact-08 (3 of 14)
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 5 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 18 (78%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 5 (22%) · Failed round 0 (0%) · Finalization 1 (4%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — Acquisition was on-key and done by round 18: S1 in rounds 2–12 and S2 in rounds 13–18, with round 1 the only Off-key round (1/23). The rest of the budget went to 5 bookkeeping rounds (19–23, about 22%) with 5 rejected checkpoints. Rounds 20, 21 and 22 (3/23, 13%) each made one attempt to record the user's constraint, and every one was rejected. That retry streak, plus the rejected first checkpoint in round 19 that round 23 had to redo, ate the remaining budget. The Run reached its final round with 1/24 left and no margin to check the Answer's coverage of fact-03, fact-07 and fact-08.
- stopped early: no — The Run used 23 of its 24 Tool Rounds, with a budget warning at 1/24 in round 23, so it ran to its budget. The unreached checks fact-03, fact-07 and fact-08 needed no new pages: the material was already on S1 and S2, acquired in rounds 2–18. They were missed when the Answer was written, not by stopping acquisition.
- Off-key round 1 (https://duckduckgo.com/?q=eurostar+luggage+allowance+official&ia=web): This is a search results page. It can point to the official sources, but it cannot carry any required fact itself. It did lead straight to S1 in round 2.
- flag (round 1): Should the DuckDuckGo results page be called Off-key? It carries no required fact, but it was a one-round step that led directly to S1.
- flag (round 20): Rounds 20–22 each held a single record_evidence call that was rejected. Should they stay Bookkeeping with the rejections counted beside them, or count as Failed rounds because every call was refused?
- flag (round 4): Rounds 4–12 scrolled S1 in small steps, and some steps showed only navigation links. Were these really Acquisition with Progress, or would a careful reviewer count some of them as low-value repeats?
- flag: Is rounds_wasted the right primary verdict when all acquisition was on-key and the unreached checks were composition misses? Would no verdict from the closed set fit better, or does the 13–22% share of rejected-checkpoint rounds justify it?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:e5eaf4c6…, $0.18

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=eurostar+luggage+allowance+official&ia=web | 130442 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 3996 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | click | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1333 | click: the settled page state moved |
| 4 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9564 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4216 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1358 | scroll: the scroll brought new material into view |
| 7 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2631 | scroll: the scroll brought new material into view |
| 8 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4288 | scroll: the scroll brought new material into view |
| 9 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1412 | scroll: the scroll brought new material into view |
| 10 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1648 | scroll: the scroll brought new material into view |
| 11 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1382 | scroll: the scroll brought new material into view |
| 12 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1402 | scroll: the scroll brought new material into view |
| 13 | Acquisition with Progress | click | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 2026 | click: the settled page state moved |
| 14 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 33611 | scroll: the scroll brought new material into view |
| 15 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 1255 | scroll: the scroll brought new material into view |
| 16 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4231 | scroll: the scroll brought new material into view |
| 17 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4730 | scroll: the scroll brought new material into view |
| 18 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 1797 | scroll: the scroll brought new material into view |
| 19 | Bookkeeping | record_evidence, record_evidence, record_evidence, record_evidence, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 101666 | record_evidence, record_evidence, record_evidence, record_evidence, record_evidence — 2 rejected Evidence Checkpoint(s) [2 rejected checkpoint] |
| 20 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5453 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 21 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5560 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 22 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5306 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 23 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 8565 | record_evidence |
| 24 | Finalization | — | — | 36428 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation (1 Tier Escalation(s) at the deadline); 18 of 24 Tool Rounds used; 19 orchestrator rounds, 1 in Finalization; Run duration 297082 ms; LLM stage 285366 ms over 19 joined round(s)
- grade pass; checks not reached: none
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 2 rejected Evidence Checkpoint(s); 1 inherited round(s); 1 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 10 (56%) · Acquisition without Progress 2 (11%) · Collection 0 (0%) · Bookkeeping 4 (22%) · Failed round 2 (11%) · Finalization 1 (5%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — The run passed, but about 10 of its 18 budgeted rounds gave no on-key progress. That is round 1 (an inherited re-acquisition), round 4 (an unreadable Look), rounds 6 and 8 (refused Looks), rounds 10–13 (four off-key pages: the Help Centre home, the FAQ page that fell back to home, the trains page and a Bing results page) and rounds 16–17 (rejected checkpoints). The on-key work was the scrolls and read on S1 (rounds 2, 3, 5, 7, 9), the equivalent official page at round 14 and the accepted checkpoints at rounds 15 and 18. Moving to the US-English equivalent of S1 could have happened long before round 14.
- stopped early: no — The Run ended with objective_met after 18 of 24 rounds, and every check was reached. With nothing left unreached, it did not stop early.
- Off-key round 10 (https://help.eurostar.com/?language=uk-en): This is the Help Centre home page, a starting point with a quick-search box. It does not itself carry the class-based allowance that fact-02 needs, and no fact-NN check can be settled on a landing page.
- Off-key round 11 (https://help.eurostar.com/faq/uk-en/question/What-luggage-can-I-take-onboard): The URL names a luggage FAQ, but the settled page title is the Help Centre 'Home'. The page seems to have fallen back to the home page rather than showing the FAQ answer, so it could not carry fact-01 to fact-03.
- Off-key round 12 (https://www.eurostar.com/uk-en/train): A general marketing page about trains across Europe. It is on the right site but covers the wrong subject, with no luggage allowance rules.
- Off-key round 13 (https://www.bing.com/search?q=%22Eurostar+Premier%22+luggage+allowance+%223+pieces%22+OR+%22three+pieces+of+luggage%22): A search results page. It can point to sources but is not itself an official statement of the allowance.
- flag (round 1): Round 1 navigated back to an inherited page. The follow-up could only read that page by loading it again, so should this count as a necessary re-entry rather than a round without progress?
- flag (round 10): Is the Help Centre home off-key, or is it a reasonable step toward an equivalent official page that could carry fact-02?
- flag (round 11): The URL names a luggage FAQ but the title reads 'Home'. Did the page actually render the FAQ answer, which would make it on-key, or did it fall back to the home page, and possibly repeat round 10's state?
- flag (round 9): Round 9's read_page is labelled as progress, yet the run then left S1 without the class table. Did this read bring in any useful new material?
- flag: The run passed with 6 rounds of budget unused. Is rounds_wasted still the right primary verdict, or should waste count against a verdict only when it cost the result? Should the two refused Looks (rounds 6 and 8) be a failed_rounds secondary?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:84237167…, $0.16

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 18705 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9647 | scroll: the scroll brought new material into view |
| 3 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7839 | scroll: the scroll brought new material into view |
| 4 | Acquisition without Progress | look | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 14155 | look: the Look returned nothing legible |
| 5 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9484 | scroll: the scroll brought new material into view |
| 6 | Failed round | look ✗ | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 3555 | every call was refused (look) |
| 7 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7926 | scroll: the scroll brought new material into view |
| 8 | Failed round | look ✗ | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2640 | every call was refused (look) |
| 9 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9362 | read_page: the first read of this page state |
| 10 | Acquisition with Progress | navigate | https://help.eurostar.com/?language=uk-en | 22238 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 11 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/What-luggage-can-I-take-onboard | 31699 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 12 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/train | 27627 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 13 | Acquisition with Progress | navigate | https://www.bing.com/search?q=%22Eurostar+Premier%22+luggage+allowance+%223+piec… | 11792 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 14 | Acquisition with Progress | navigate | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 16287 | navigate: the settled page state moved to a page this Run had not acquired |
| 15 | Bookkeeping | record_evidence | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 24157 | record_evidence |
| 16 | Bookkeeping | record_evidence | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 9747 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 17 | Bookkeeping | record_evidence | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 10709 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 18 | Bookkeeping | record_evidence | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 10985 | record_evidence |
| 19 | Finalization | — | — | 36812 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation (1 Tier Escalation(s) at the deadline); 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 452939 ms; LLM stage 398995 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-06, fact-07, fact-08 (3 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 walled round(s)
- navigates that landed on a Not-found Page: 1 (round 16)
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 19 (79%) · Acquisition without Progress 2 (8%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 3 (13%) · Finalization 2 (8%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — Well under half of the budget went to on-key work. Rounds 2-8, 10 and 13 (9 of 24) stayed on https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/, a status-update release that is neither verified source. Round 15 re-fetched that same release from the archive. On that page the Run scrolled, used look, went back to it (round 10) and then read it in full (round 13), covering one text three ways. Round 9 was walled, round 24 was off-key, round 21 was a scroll that hit End of Page, and rounds 11, 12 and 22 were refused. The September announcement page was not reached until round 16 and was read in slices over rounds 17-21. The whole-page read came only at round 23, leaving no rounds for fact-06, fact-07 and fact-08, which that page could carry. The June account itself was never opened on JPL; only the ScienceDaily reprint was, at round 14.
- secondary: failed rounds — 3 of 24 rounds (12.5%: rounds 11, 12 and 22) were look calls refused on region or repeat grounds. Round 22 fell with only 3 rounds left, and the read it forced (round 23) delayed the final work on the September page past the budget.
- stopped early: no — The Run used all 24 of its 24 Tool Rounds and ended on budget_exhausted, so it did not stop early.
- Off-key round 1 (https://duckduckgo.com/?q=jpl.nasa.gov+June+2013+news+release+Voyager+1+has+not+yet+left+the+solar+system&ia=web): Search results page. It lists links but cannot itself carry any required fact.
- Off-key round 9 (https://science.nasa.gov/missions/voyager-program/nasa-voyager-status-update-on-voyager-1-location/): Walled page: a browser challenge on science.nasa.gov, so no article text was shown.
- Off-key round 24 (https://web.archive.org/web/20131103170646/http://www.jpl.nasa.gov/news/news.php?release=2013-261): Right site, wrong subject. The guessed release number led to a Cassini/Saturn moon story that cannot carry any Voyager fact.
- flag (round 2): Should rounds 2-8, 10 and 13 on the status-update release be called Off-key? That page is not the June account, so it cannot carry fact-01, but it touches the magnetic-direction sign behind fact-04.
- flag (round 15): Should round 15 (an archive copy of the release already read at rounds 2-13) be overruled to acquisition_without_progress as a repeat, or kept as progress because it may have shown the publication date the live page lacked?
- flag (round 1): Is a search results page that led straight to a relevant JPL release really Off-key, or should it count as on-key discovery work?
- flag (round 22): Is failed_rounds a fair secondary, given that read_page at round 23 recovered the refused look's route and the unreached facts may have been lost to slice-by-slice reading rather than to the refusal?
- flag: Would tier_too_small_or_never_escalated be a better secondary, since the on-key September-page work ran into the budget of the investigation tier with no Tier Escalation?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:85b078e1…, $0.20

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=jpl.nasa.gov+June+2013+news+release+Voyager+1+has+not+… | 120877 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 4535 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 2655 | scroll: the scroll brought new material into view |
| 4 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 2872 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 1415 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 2978 | scroll: the scroll brought new material into view |
| 7 | Acquisition with Progress | look | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 4594 | look: the first Look at this page state with this question |
| 8 | Acquisition with Progress | look | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 4715 | look: the first Look at this page state with this question |
| 9 | Acquisition with Progress | navigate | https://science.nasa.gov/missions/voyager-program/nasa-voyager-status-update-on-… | 3330 | navigate: the settled page state moved to a page this Run had not acquired [walled, off-key] |
| 10 | Acquisition without Progress | navigate | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 1482 | navigate: a navigate to a URL this Run already acquired |
| 11 | Failed round | look ✗ | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 3194 | every call was refused (look) |
| 12 | Failed round | look ✗ | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 1735 | every call was refused (look) |
| 13 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 1564 | read_page: the first read of this page state |
| 14 | Acquisition with Progress | navigate | https://www.sciencedaily.com/releases/2013/06/130627140803.htm | 20729 | navigate: the settled page state moved to a page this Run had not acquired |
| 15 | Acquisition with Progress | navigate | https://web.archive.org/web/20131126043936/http://www.jpl.nasa.gov/news/news.php… | 36914 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Acquisition with Progress | navigate, navigate | https://www.jpl.nasa.gov/news/voyager1-enters-magnetic-highway/ | 56067 | navigate: the settled page state moved to a page this Run had not acquired [not found] |
| 17 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 2699 | scroll: the scroll brought new material into view |
| 18 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 1453 | scroll: the scroll brought new material into view |
| 19 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 3330 | scroll: the scroll brought new material into view |
| 20 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 1592 | scroll: the scroll brought new material into view |
| 21 | Acquisition without Progress | scroll | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 6365 | scroll: a scroll that answered End of Page |
| 22 | Failed round | look ✗ | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 54159 | every call was refused (look) |
| 23 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 1293 | read_page: the first read of this page state |
| 24 | Acquisition with Progress | navigate | https://web.archive.org/web/20131103170646/http://www.jpl.nasa.gov/news/news.php… | 12769 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 25 | Finalization | — | — | 10003 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 35676 | the reserved Answer |

