# Round Audit — bingbong.live-web.information-hunts (baseline-1)

Generated 2026-09-14T11:58:54.837Z from a capture set created 2026-09-12T17:06:30.219Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) fbd2b865 (dirty tree); mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p1; audit run at commit 4586e413

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 73 | 66 | 66 | 3 | 41 (62%) → 37 | 16 (24%) → 20 | 1 (2%) | 4 (6%) | 4 (6%) | 7 (10%) |
| follow_up | 2 | 2 | 42 | 39 | 38 | 0 | 19 (49%) → 16 | 11 (28%) → 14 | 0 (0%) | 7 (18%) | 2 (5%) | 3 (7%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 26 Off-key round(s), 6 Search Loop round(s) by the reviewer (5 by the streak rule; attempts by search source rail 0, replay 3, none 1), 0 inherited, 1 rejected Evidence Checkpoint(s), 1 walled round(s), 6 navigate(s) landed on a Not-found Page (6 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 1 stopped early, 4 overrule(s), 23 flag(s); Finalization Causes: budget_exhausted 3, model_answered 1
- follow_up: 8 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 0, replay 1, none 1), 5 inherited, 2 rejected Evidence Checkpoint(s), 0 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 4 Held Page round(s) without Progress, 0 stopped early, 3 overrule(s), 9 flag(s); Finalization Causes: deadline_reached 1, objective_met 1

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 32 (48%) | 13 (34%) |
| scroll | 13 (20%) | 10 (26%) |
| record_evidence | 6 (9%) | 5 (13%) |
| look | 3 (5%) | 4 (11%) |
| read_page | 4 (6%) | 2 (5%) |
| report_run_plan | 4 (6%) | 2 (5%) |
| type | 5 (8%) | 1 (3%) |
| click | 4 (6%) | 1 (3%) |
| record_candidate | 0 | 3 (8%) |
| agent_results | 1 (2%) | 0 |
| spawn_agent | 1 (2%) | 0 |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (budget_exhausted); tier investigation (1 Tier Escalation(s) at the deadline); 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 423979 ms; LLM stage 411453 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-05 (1 of 10)
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 2 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 17 (71%) · Acquisition without Progress 4 (17%) · Collection 1 (4%) · Bookkeeping 1 (4%) · Failed round 1 (4%) · Finalization 2 (8%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: rounds wasted** — fact-05, the one check not reached, lives on camera_software.html, which the Run reached in round 9. The Run never extracted it there. Instead: round 10 re-navigated to a URL already acquired, round 12's type failed, the look in round 13 returned nothing legible, and round 14 was refused. Rounds 15-18 then went on a raw-GitHub include-index file, fetched twice under two paths, including an End of Page scroll in round 16. Round 21 was another End of Page scroll, and round 23 landed on an off-key gallery post. Counting those rounds (10, 12, 13, 14, 15, 16, 17, 18, 21, 23), about 10 of 24 budgeted rounds (~42%) went without progress, failed or were off-key. That is enough to have covered the missing check on a page the Run already had.
- secondary: tier too small or never escalated — The Run stayed at the investigation tier (24 rounds) for the whole attempt. The time milestone notice in round 22 prompted a decision on escalating, but no Tier Escalation followed. The on-key work that did happen (rounds 1-9 on S1, S2 and S3, plus the Subagent collected in round 19) covered the other checks, and the budget ran out 2 rounds after that notice.
- stopped early: no — The Run used all 24 of its 24 budgeted Tool Rounds and ended on budget_exhausted, so it did not stop with budget left.
- Off-key round 15 (https://raw.githubusercontent.com/raspberrypi/documentation/refs/heads/master/documentation/asciidoc/computers/camera_software.adoc): This is the top-level asciidoc file for the camera software page. Its rendered height (scroll 277/965 by round 17) is far too short to hold the documentation itself, so it is most likely just a list of include directives. The required facts sit in the included section files, not in this file.
- Off-key round 17 (https://raw.githubusercontent.com/raspberrypi/documentation/refs/heads/master/documentation/asciidoc/computers/camera_software.adoc): A full read of the same short include-index file from round 15. It cannot carry fact-05 or fact-06 text.
- Off-key round 18 (https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation/asciidoc/computers/camera_software.adoc): The same include-index file under a different branch path. It carries no content beyond what round 15 already showed.
- Off-key round 23 (https://www.raspberrypi.com/news/camera-module-3-show-off-your-shots/): The requested URL redirected to a community photo-gallery post. It is on the right site but the wrong subject: no cable, legacy-stack or capture-software material the key checks.
- overrule round 18 → Acquisition without Progress: The URL is new only as a string. It resolves to the same asciidoc file acquired in round 15 (the branch alias master in place of refs/heads/master), so no new material came in.
- overrule round 12 → Acquisition without Progress: The type call did not execute ('field unavailable after page change'). The only movement was a fragment jump within camera_software.html, a page already acquired in rounds 9-11.
- flag (round 15): Is the raw camera_software.adoc truly an include-only index that cannot carry fact-05 or fact-06, or did it show real documentation text that the digest's result head hides? If it showed real text, rounds 15, 17 and 18 are not Off-key.
- flag (round 20): Should the rpicam-apps README on raw.githubusercontent.com count as Off-key? It is not a verified source, but it could plausibly name the rpicam applications relevant to fact-06, so it was left on-key.
- flag (round 24): The 'New autofocus camera modules!' launch post was judged on-key for fact-04 (and possibly fact-05). Would a stricter reader treat a launch news post as outside the key's sources?
- flag (round 12): Is the overrule right? The page signature did move to #autofocus-mode, which may have been new material in view even though the type call itself failed.
- flag (round 18): Is the overrule of round 18 to without-progress sound, given the app treated the different branch path as a new URL?
- flag: Is the secondary verdict tier_too_small_or_never_escalated warranted when the primary cause was waste, or should there be no secondary at all?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:7cd6c971…, $0.28

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate, spawn_agent | https://www.raspberrypi.com/products/camera-module-3/ | 186399 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/products/camera-module-3 | 6032 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 5848 | scroll: the scroll brought new material into view |
| 4 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 4116 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 5876 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 5205 | scroll: the scroll brought new material into view |
| 7 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 4060 | scroll: the scroll brought new material into view |
| 8 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 9441 | record_evidence |
| 9 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5036 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 12200 | navigate: a navigate to a URL this Run already acquired |
| 11 | Acquisition with Progress | click | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 19035 | click: the settled page state moved |
| 12 | Acquisition with Progress → Acquisition without Progress | type | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 5487 | type: the settled page state moved |
| 13 | Acquisition without Progress | look | https://www.raspberrypi.com/documentation/computers/camera_software.html | 10024 | look: the Look returned nothing legible |
| 14 | Failed round | look ✗ | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6525 | every call was refused (look) |
| 15 | Acquisition with Progress | navigate | https://raw.githubusercontent.com/raspberrypi/documentation/refs/heads/master/do… | 10535 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 16 | Acquisition without Progress | scroll | https://raw.githubusercontent.com/raspberrypi/documentation/refs/heads/master/do… | 4400 | scroll: a scroll that answered End of Page |
| 17 | Acquisition with Progress | read_page | https://raw.githubusercontent.com/raspberrypi/documentation/refs/heads/master/do… | 3877 | read_page: the first read of this page state [off-key] |
| 18 | Acquisition with Progress → Acquisition without Progress | navigate | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 4329 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 19 | Collection | agent_results | https://raw.githubusercontent.com/raspberrypi/documentation/master/documentation… | 4505 | read a finished Subagent Report |
| 20 | Acquisition with Progress | navigate | https://raw.githubusercontent.com/raspberrypi/rpicam-apps/main/README.md | 36969 | navigate: the settled page state moved to a page this Run had not acquired |
| 21 | Acquisition without Progress | scroll | https://raw.githubusercontent.com/raspberrypi/rpicam-apps/main/README.md | 4144 | scroll: a scroll that answered End of Page |
| 22 | Acquisition with Progress | read_page | https://raw.githubusercontent.com/raspberrypi/rpicam-apps/main/README.md | 5939 | read_page: the first read of this page state |
| 23 | Acquisition with Progress | navigate | https://www.raspberrypi.com/news/camera-module-3-show-off-your-shots/ | 13020 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 24 | Acquisition with Progress | navigate | https://www.raspberrypi.com/news/new-autofocus-camera-modules/ | 4711 | navigate: the settled page state moved to a page this Run had not acquired |
| 25 | Finalization | scroll ✗ | https://www.raspberrypi.com/news/new-autofocus-camera-modules | 4838 | a Finalization round whose calls were refused — the tools are closed (scroll) |
| 26 | Finalization | — | — | 28902 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (deadline_reached); tier investigation; 20 of 24 Tool Rounds used; 23 orchestrator rounds, 2 in Finalization; Run duration 401951 ms; LLM stage 385882 ms over 23 joined round(s)
- grade useful_partial; checks not reached: fact-02 (1 of 6)
- 0 Subagent round(s) over 0 Subagent(s); 7 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 3 inherited round(s); 3 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 9 (43%) · Acquisition without Progress 6 (29%) · Collection 0 (0%) · Bookkeeping 4 (19%) · Failed round 2 (10%) · Finalization 2 (9%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: rounds wasted** — Of the 21 budgeted rounds, 8 made no progress once rounds 11 and 16 are overruled (rounds 2, 3, 9, 10, 11, 14, 15, 16). Another 2 failed: round 5 was a refused repeat scroll and round 21 was cut. Round 6 was off-key, and rounds 7-8 went to a launch article that could not carry fact-02. That comes to roughly half the budget. The Run did load the verified source https://www.raspberrypi.com/documentation/accessories/camera.html in rounds 9-16, but it used scrolls and screenshot Looks that came back illegible (rounds 11, 15, 16) and never read the page text. So the mechanical section behind fact-02 was never extracted. Long reasoning rounds (1, 2, 17, each over 60 s) also used up the time before the deadline.
- stopped early: no — The Run was ended by the active-work deadline: round 21 was cut and the end reason was deadline_reached. It did not choose to stop with time left. It had shifted to bookkeeping in rounds 17-20 while 6 of 24 tool rounds remained, and fact-02 was reachable on camera.html, which it had already loaded in rounds 9-16. But time, not a decision to stop, ended the Run.
- Off-key round 6 (https://www.raspberrypi.com/news/camera-module-3-show-off-your-shots/): The navigate to /news/camera-module-3/ redirected to a community photo showcase post. That is the right site but the wrong subject. A gallery of user shots cannot carry the enclosure verdict (fact-01), the official mechanical reason (fact-02) or the electrical and software carry-over (fact-03).
- overrule round 11 → Acquisition without Progress: The Look on https://www.raspberrypi.com/documentation/accessories/camera.html returned 'not legible'. Nothing new came in. Round 15 got the same result and was labelled without progress, so round 11 should be too.
- overrule round 16 → Acquisition without Progress: The region Look on camera.html also returned 'not legible', and the app itself added a no-progress notice to the result. No material came in, the same as round 15.
- flag (round 7): Should the launch article https://www.raspberrypi.com/news/new-autofocus-camera-modules/ (rounds 7-8) also count as off-key? It could plausibly carry general compatibility statements relevant to fact-03, so it was left on-key.
- flag (round 11): Is overruling rounds 11 and 16 to without-progress right, given that the app counts a first Look with a new question as progress even when the Look returns nothing legible?
- flag (round 21): Should failed_rounds be a secondary verdict? The deadline cut at round 21 ended the Run, but by then acquisition had already stopped and fact-02 had already been missed.
- flag (round 17): Should the Run count as stopped early? It left the camera.html source for bookkeeping at round 17 with budget left and fact-02 still within reach on that page, even though the formal end was the deadline.
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:5fa2d7bb…, $0.08

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 72549 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition without Progress | record_evidence, record_evidence, navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 63845 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited, 1 rejected checkpoint] |
| 3 | Acquisition without Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 9291 | scroll: a scroll that answered End of Page |
| 4 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 7073 | read_page: the first read of this page state |
| 5 | Failed round | scroll ✗ | https://www.raspberrypi.com/products/camera-module-3 | 10248 | every call was refused (scroll) |
| 6 | Acquisition with Progress | navigate | https://www.raspberrypi.com/news/camera-module-3-show-off-your-shots/ | 15173 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition with Progress | navigate | https://www.raspberrypi.com/news/new-autofocus-camera-modules/ | 8488 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | scroll | https://www.raspberrypi.com/news/new-autofocus-camera-modules | 6821 | scroll: the scroll brought new material into view |
| 9 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 19709 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 10 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html#camera-module-… | 4842 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 11 | Acquisition with Progress → Acquisition without Progress | look | https://www.raspberrypi.com/documentation/accessories/camera.html | 2420 | look: the first Look at this page state with this question |
| 12 | Acquisition with Progress | look | https://www.raspberrypi.com/documentation/accessories/camera.html | 8883 | look: the first Look at this page state with this question |
| 13 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 10101 | scroll: the scroll brought new material into view |
| 14 | Acquisition without Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 4524 | scroll: a scroll that answered End of Page |
| 15 | Acquisition without Progress | look | https://www.raspberrypi.com/documentation/accessories/camera.html | 4493 | look: the Look returned nothing legible |
| 16 | Acquisition with Progress → Acquisition without Progress | look | https://www.raspberrypi.com/documentation/accessories/camera.html | 6321 | look: the first Look at this page state with this question |
| 17 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 67940 | record_evidence, record_evidence |
| 18 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 15993 | record_candidate |
| 19 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 5433 | record_candidate |
| 20 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 6079 | record_candidate |
| 21 | Failed round | — | — | 6266 | cut by the active-work deadline |
| 22 | Finalization | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 8346 | the bookkeeping round (record_candidate) |
| 23 | Finalization | — | — | 21044 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier lookup; 12 of 12 Tool Rounds used; 14 orchestrator rounds, 2 in Finalization; Run duration 178437 ms; LLM stage 141672 ms over 14 joined round(s)
- grade useful_partial; checks not reached: fact-02, fact-03, fact-05, fact-08, fact-10, fact-11 (6 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 7 (58%) · Acquisition without Progress 2 (17%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 3 (25%) · Finalization 2 (14%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — Only rounds 11 and 12 (2 of 12) were on a page that could carry key facts (S1). The other 10 rounds went elsewhere. Rounds 2, 5 and 7 were refusals; rounds 3 and 6 repeated an equivalent typing action and drew the no-progress Notice; round 9 went back to the listing page (overruled); and rounds 1, 4, 8 and 10 landed on listing or search pages that were off-key. By the time S1 was reached, no budget was left to finish reading it (fact-02, fact-03, fact-05) or to open S2 (fact-08, fact-10, fact-11).
- secondary: failed rounds — Three of the 12 budgeted rounds (2, 5, 7) failed outright because every call was refused on the listing page. They also caused the repeat attempts in rounds 3 and 6, so about 5 of 12 rounds were lost to the refused typing path before the Run switched to search by URL in round 8.
- stopped early: no — The Run used all 12 of its 12 Tool Rounds (budget_exhausted) and got a finalize instruction in round 13. It ran to its budget, so it did not stop early.
- Off-key round 1 (https://www.rmg.co.uk/collections/objects): This is the generic collection listing page. It is not the watch record (S1) or the case record (S2), so it cannot carry any fact-NN check. It is only a place to start searching from.
- Off-key round 4 (https://www.rmg.co.uk/collections/objects): Same generic listing page. The click changed the page state, probably by dismissing an overlay, but the page still carries no required fact.
- Off-key round 8 (https://www.rmg.co.uk/collections/search?q=Harrison+longitude+watch): An on-site search results page. At most it lists objects; it cannot state any fact-NN check.
- Off-key round 9 (https://www.rmg.co.uk/collections/objects?_gl=1*uz4w2p*_up*MQ..*_ga*MjA4NDczMzEwOC4xNzg5MjMxODA1*_ga_7JJ3J5DBF6*czE3ODkyMzE4MDUkbzEkZzEkdDE3ODkyMzE4MDUkajYwJGwwJGgyMDY1MzIzMTk5*_ga_4MH5VEZTEK*czE3ODkyMzE4MDUkbzEkZzEkdDE3ODkyMzE4MDUkajYwJGwwJGgw): The click from the search results put the Run back on the generic listing page, with only analytics parameters added. It is not an object record and carries no required fact.
- Off-key round 10 (https://duckduckgo.com/?q=site%3Armg.co.uk+collections+object+Harrison+longitude+timekeeper+H4+1759&ia=web): An external search engine results page. It gave the Run the S1 address used in round 11, but a results page cannot carry any fact-NN check itself.
- overrule round 9 → Acquisition without Progress: The page this click reached is the same /collections/objects listing already acquired in rounds 1 and 4. The only difference is the _gl/_ga analytics parameters, so nothing new came in, whatever the page signature says.
- flag (round 9): Should the click that reached a listing URL with only analytics parameters stay as progress, since the app saw a page-signature change, rather than being overruled as a repeat of the round 1/4 listing?
- flag (round 10): Is it right to mark the DuckDuckGo results page off-key when it is the step that found the S1 address, or should a search that directly surfaces a verified source count as on-key?
- flag (round 10): Do rounds 8 and 10 form one Search Loop, since both look for the Harrison watch record, or does the switch from on-site search to a site-restricted external engine with a new query break it?
- flag (round 4): Should the overlay-dismissing click on the listing page count as off-key, or as a necessary step toward the site's search box?
- flag: Should the secondary verdict be tier_too_small_or_never_escalated instead of failed_rounds? The lookup tier's 12 rounds were never escalated, and the task needs two catalogue records plus a full read of the first.
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:d7ca694b…, $0.09

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects | 50045 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects | 6304 | every call was refused (type) |
| 3 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects | 6551 | type: the app’s own no-progress Notice rode the result |
| 4 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects | 8703 | click: the settled page state moved [off-key] |
| 5 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects | 1658 | every call was refused (type) |
| 6 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects | 1738 | type: the app’s own no-progress Notice rode the result |
| 7 | Failed round | click ✗ | https://www.rmg.co.uk/collections/objects | 1385 | every call was refused (click) |
| 8 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/search?q=Harrison+longitude+watch | 7948 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 9 | Acquisition with Progress → Acquisition without Progress | click | https://www.rmg.co.uk/collections/objects?_gl=1*uz4w2p*_up*MQ..*_ga*MjA4NDczMzEw… | 7490 | click: the settled page state moved [off-key] |
| 10 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=site%3Armg.co.uk+collections+object+Harrison+longitude… | 14876 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 11 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1983 | navigate: the settled page state moved to a page this Run had not acquired |
| 12 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 13579 | read_page: the first read of this page state |
| 13 | Finalization | record_evidence | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 8052 | the bookkeeping round (record_evidence) |
| 14 | Finalization | — | — | 11360 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done (model_answered); tier lookup; 6 of 12 Tool Rounds used; 7 orchestrator rounds, 1 in Finalization; Run duration 231365 ms; LLM stage 224830 ms over 7 joined round(s)
- grade useful_partial; checks not reached: fact-07, fact-08 (2 of 14)
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 3 (50%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 3 (50%) · Failed round 0 (0%) · Finalization 1 (14%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: stopped early** — All 5 non-finalization rounds after round 1 were on-key: rounds 2 and 3 reached both verified sources, and rounds 4 to 6 recorded evidence from them (5 accepted checkpoints, 1 rejected). Only 1 of 6 budgeted rounds (17%, round 1) was a search page, with no loops, no repeats and no failed rounds. The Run then answered at round 7 with half the budget unused, leaving fact-07 and fact-08 unreached even though pages already in hand covered them.
- stopped early: yes — The Run used 6 of its 12 Tool Rounds and answered with 6 left. The checks it never reached, fact-07 and fact-08, needed no page beyond the two it already held: https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage (opened in round 3, recorded in rounds 5 and 6) and https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments (opened in round 2, recorded in round 4). Both checks could be worked out from that material. A time notice at round 4 said 60% of the active-work deadline was spent, but time was left when the Run stopped.
- Off-key round 1 (https://duckduckgo.com/?q=Eurostar+luggage+allowance+musical+instruments+official+eurostar.com&ia=web): A search engine results page. It can point to the official sources but cannot itself carry any required fact as an official rule. It worked only as a step toward the pages opened in rounds 2 and 3.
- flag (round 1): Should the DuckDuckGo results page in round 1 count as Off-key? It cannot carry a fact itself, but it was the necessary way to find the official pages opened in rounds 2 and 3.
- flag (round 7): Should this be called stopped_early? The misses on fact-07 and fact-08 are gaps in how the Answer was written from material already acquired, and more Tool Rounds might not have closed them.
- flag (round 4): Did the 60% time notice at round 4 make stopping at round 6 reasonable, so that time left, not rounds left, is the better measure of whether the Run stopped early?
- flag (round 4): Round 4's first record_evidence was rejected because its excerpt did not appear in anything retained from the luggage page, which was only re-recorded in rounds 5 and 6. Should rounds 5 and 6 count partly as repair of that rejection rather than as fresh Bookkeeping?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:8493fa21…, $0.12

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=Eurostar+luggage+allowance+musical+instruments+officia… | 88450 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4997 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 13221 | navigate: the settled page state moved to a page this Run had not acquired |
| 4 | Bookkeeping | record_evidence, record_evidence, record_evidence, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 70195 | record_evidence, record_evidence, record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 5 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5221 | record_evidence |
| 6 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5849 | record_evidence |
| 7 | Finalization | — | — | 36897 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation (1 Tier Escalation(s) at the deadline); 18 of 24 Tool Rounds used; 19 orchestrator rounds, 1 in Finalization; Run duration 288265 ms; LLM stage 278916 ms over 19 joined round(s)
- grade pass; checks not reached: none
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 2 inherited round(s); 1 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 1 (round 12)
- of those, judged Off-key by the reviewer: 1
- kinds: Acquisition with Progress 10 (56%) · Acquisition without Progress 5 (28%) · Collection 0 (0%) · Bookkeeping 3 (17%) · Failed round 0 (0%) · Finalization 1 (5%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — The attempt passed after using 18 of its 24 rounds, but most acquisition work did not advance it. After the round-8 overrule, 6 of the 15 acquisition rounds had no Progress (1, 2, 7, 8, 12, 17). Rounds 6-10 went to the Help Centre home hub, round 12 hit a 404 and round 13 was a search results page. That is 10 of 15 acquisition rounds with no Progress or on Off-key pages. The deciding pages were the luggage page (rounds 3-5, and round 14's us-en copy), round 11's FAQ and the instruments page (round 17), and they could have been reached in far fewer rounds.
- stopped early: no — The Run ended with objective_met and a pass grade, and no checks were left unreached. There was nothing within reach left to check, so this was not an early stop.
- Off-key round 6 (https://help.eurostar.com/?language=uk-en): Help Centre home page: a navigation hub of category links and a search box. It states no fare-class allowance, so it can carry none of fact-01..03.
- Off-key round 7 (https://help.eurostar.com/?language=uk-en): The same hub page, and the typed query was blocked by an overlay. Nothing on it could carry a required fact.
- Off-key round 8 (https://help.eurostar.com/?language=uk-en): A re-read of the Help Centre home. The hub lists categories but has no allowance text.
- Off-key round 9 (https://help.eurostar.com/?language=uk-en): A scroll on the Help Centre home that brought only category 'See more' links into view, none about allowances.
- Off-key round 10 (https://help.eurostar.com/?language=uk-en): A scroll on the Help Centre home. It surfaced a link to the luggage category, but the page itself carries no allowance figures.
- Off-key round 12 (https://www.eurostar.com/uk-en/travel-info/tickets-fares/eurostar-premier): A Not-found page (404) on the right site. It carries nothing.
- Off-key round 13 (https://duckduckgo.com/?q=site%3Aeurostar.com+Eurostar+Premier+luggage+allowance&ia=web): A search results page. It lists links but is not an official rule page, so it cannot itself carry a required fact.
- overrule round 8 → Acquisition without Progress: read_page returned the same page state round 6 had already put in front of the assistant: the same URL, signature ce3bfea4 and scroll 0/6081. It repeated an observation rather than making a first read of a new state.
- flag (round 6): Should rounds 6-10 on the Help Centre home count as on-key navigation, since the hub led to round 11's FAQ page (a possible equivalent official source), rather than as Off-key?
- flag (round 8): Is round 8's read_page really a repeat of round 6's observation (same signature ce3bfea4), or did the full read add content that round 6's navigate result had cut off?
- flag (round 17): Round 17 re-opened an inherited, already-checkpointed page only to re-ground a claim after round 16's rejection, and fact-03 treats the guitar exception as unchanged. Is 'without progress' the right label, or did it make progress within this run?
- flag (round 1): Round 1 re-navigated to the inherited S1 page, which is where the Premier allowance for this follow-up sits. Should that re-acquisition count as without progress?
- flag: The attempt passed with 6 of 24 rounds unused. Is 'rounds_wasted' a fair primary verdict when the waste did not cost the result?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:a651591a…, $0.17

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 68519 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition without Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 17787 | scroll: a scroll that answered End of Page |
| 3 | Acquisition with Progress | click | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 13100 | click: the settled page state moved |
| 4 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 6334 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4454 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | navigate | https://help.eurostar.com/?language=uk-en | 58032 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition without Progress | type | https://help.eurostar.com/?language=uk-en | 9071 | type: the result reports no page movement [off-key] |
| 8 | Acquisition with Progress → Acquisition without Progress | read_page | https://help.eurostar.com/?language=uk-en | 6054 | read_page: the first read of this page state [off-key] |
| 9 | Acquisition with Progress | scroll | https://help.eurostar.com/?language=uk-en | 7957 | scroll: the scroll brought new material into view [off-key] |
| 10 | Acquisition with Progress | scroll | https://help.eurostar.com/?language=uk-en | 2602 | scroll: the scroll brought new material into view [off-key] |
| 11 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 4432 | navigate: the settled page state moved to a page this Run had not acquired |
| 12 | Acquisition without Progress | navigate | https://www.eurostar.com/uk-en/travel-info/tickets-fares/eurostar-premier | 5110 | navigate: landed on a Not-found Page [not found, off-key] |
| 13 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=site%3Aeurostar.com+Eurostar+Premier+luggage+allowance… | 1553 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 14 | Acquisition with Progress | navigate | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 4254 | navigate: the settled page state moved to a page this Run had not acquired |
| 15 | Bookkeeping | record_evidence, record_evidence | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 33703 | record_evidence, record_evidence |
| 16 | Bookkeeping | record_evidence | https://www.eurostar.com/us-en/travel-info/travel-planning/luggage | 6054 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 17 | Acquisition without Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 1732 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 18 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4479 | record_evidence |
| 19 | Finalization | — | — | 23689 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 388291 ms; LLM stage 337974 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-07 (1 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 walled round(s)
- navigates that landed on a Not-found Page: 6 (round 1, 5, 7, 9, 22, 24)
- of those, judged Off-key by the reviewer: 6
- kinds: Acquisition with Progress 14 (58%) · Acquisition without Progress 10 (42%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 0 (0%) · Finalization 2 (8%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — Only rounds 15-21 (7 of 24, about 29%) worked a page that could carry required facts, which was S1. Round 6 is borderline. About 16 of 24 rounds (roughly two-thirds) landed on off-key pages: six guessed-URL 404s (rounds 1, 5, 7, 9, 22, 24), seven search results pages (2, 3, 4, 8, 10, 14, 23) and three rounds on a CDX index (11-13). Two search loops (rounds 2-4 and 8-10) and five failed URL guesses for the September release used up the budget, so the verified September source was never opened and fact-07 went unreached.
- stopped early: no — The Run used all 24 of its 24 budgeted Tool Rounds and ended on budget_exhausted. It did not stop with budget left.
- Search Loop over rounds 2, 3, 4: Three consecutive searches, on Google and then DuckDuckGo, all reworded one intent: finding the June 2013 JPL statement. The app counted streaks 1 to 3 and sent a search_loop_nudge at round 4.
- Search Loop over rounds 8, 9, 10: Rounds 8 and 10 reworded one intent: finding the September 2013 NASA release. Round 9 between them was a guessed-URL navigate toward the same release, so it did not break the loop. The app counted round 10 as streak 2.
- Off-key round 1 (https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-entering-interstellar-space/): A 404 on the right site. A not-found page carries no content.
- Off-key round 2 (https://www.google.com/search?q=NASA+Voyager+statement+June+2013+%22has+not+yet+left+the+heliosphere%22+or+%22not+yet+in+interstellar+space%22+jpl): A search results page that was also walled by a Google challenge, so nothing was shown.
- Off-key round 3 (https://duckduckgo.com/?q=NASA+Voyager+1+June+2013+statement+%22not+yet+in+interstellar+space%22+%22magnetic+field%22+jpl.nasa.gov&ia=web): A search results page. It can point to sources but carries none of the required facts itself.
- Off-key round 4 (https://duckduckgo.com/?q=Voyager+1+June+27+2013+NASA+statement+interstellar+space+not+yet&ia=web): A search results page, and a loop member.
- Off-key round 5 (https://www.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar-space): A 404 at a guessed URL. The verified September source is at a different path.
- Off-key round 7 (https://science.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar-space/): A 404 at a guessed URL on the right organisation's site.
- Off-key round 8 (https://duckduckgo.com/?q=science.nasa.gov+%22Voyager+1+officially+interstellar+space%22+September+2013+press+release&ia=web): A search results page.
- Off-key round 9 (https://www.nasa.gov/content/nasa-voyager-1-officially-in-interstellar-space/): A 404 at a guessed URL.
- Off-key round 10 (https://duckduckgo.com/?q=site%3Anasa.gov+voyager+1+officially+interstellar+space+September+12+2013&ia=web): A search results page, and a loop member.
- Off-key round 11 (http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=prefix&from=20130601&to=20131231&filter=statuscode:200&limit=300&collapse=urlkey): A Wayback CDX index listing. It holds only archived URLs and timestamps, not any release text, so it can carry no required fact.
- Off-key round 12 (http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=prefix&from=20130601&to=20131231&filter=statuscode:200&limit=300&collapse=urlkey): A read of the same CDX index listing. It has no release content.
- Off-key round 13 (http://web.archive.org/cdx/search/cdx?collapse=urlkey&filter=statuscode%3A200&from=20130601&limit=300&matchType=prefix&to=20131231&url=jpl.nasa.gov%2Fnews%2Fnews.php): A look at the same CDX index listing. It returned URL strings only, and none of them was followed.
- Off-key round 14 (https://www.bing.com/search?q=jpl.nasa.gov+%22Voyager+1%22+June+2013+%22has+not+yet%22+interstellar+space+magnetic+field+statement): A search results page. It did lead to S1 in round 15.
- Off-key round 22 (https://www.jpl.nasa.gov/news/nasas-voyager-1-officially-in-interstellar-space/): A 404 at a guessed URL.
- Off-key round 23 (https://www.bing.com/search?q=site%3Ajpl.nasa.gov+Voyager+1+%22interstellar+space%22+September+2013+plasma+wave+%22April+9%2C+2013%22&rdr=1&rdrig=6CE13DA215DA498E83E3439FF6BA44C5): A search results page.
- Off-key round 24 (https://science.nasa.gov/universe/nasas-voyager-1-officially-in-interstellar-space/): A 404 at a guessed URL.
- overrule round 2 → Acquisition without Progress: The page moved to a new URL, but what loaded was a Google challenge wall with no results. No new material came in, and the round opened the rounds 2-4 search loop.
- flag (round 2): Should the walled Google challenge page count as acquisition_without_progress, as overruled, or keep the mechanical with-progress label because the URL was new?
- flag (round 6): Is https://science.nasa.gov/resource/voyager-reaches-interstellar-space/ on-key because it could carry the crossing date? Or is it off-key as a modern resource page that is not either official 2013 account?
- flag (round 9): Does a guessed-URL navigate between searches 8 and 10 belong inside the loop, or does it break it?
- flag (round 22): Rounds 5, 7, 9, 22 and 24 all guessed URL variants for the same September release. Should they be treated as a loop-like repeat even though they are navigates, not searches?
- flag (round 11): Is the CDX index work in rounds 11-13 off-key? The listing carries no facts itself, but it was a reasonable route to archived releases.
- flag (round 14): Should search results pages that led straight to an on-key source (round 14 led to S1) be marked off-key?
- flag (round 16): Rounds 16 and 17 only scrolled slide buttons and share links into view. Should they count as Acquisition with Progress?
- flag: Is rounds_wasted right as the sole verdict given a useful_partial grade with only fact-07 unreached? Or does the investigation tier's 24-round budget with no escalation also justify a tier_too_small_or_never_escalated secondary?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:f886a913…, $0.27

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-entering-interstellar… | 117157 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.google.com/search?q=NASA+Voyager+statement+June+2013+%22has+not+yet+… | 8156 | navigate: the settled page state moved to a page this Run had not acquired [walled, off-key, search loop, loop head by the streak rule] |
| 3 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=NASA+Voyager+1+June+2013+statement+%22not+yet+in+inter… | 2607 | navigate: a search that rewords the one before it (streak 2) [off-key, search loop] |
| 4 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=Voyager+1+June+27+2013+NASA+statement+interstellar+spa… | 5926 | navigate: a search that rewords the one before it (streak 3) [off-key, search loop] |
| 5 | Acquisition without Progress | navigate | https://www.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar-spa… | 7521 | navigate: landed on a Not-found Page [not found, off-key] |
| 6 | Acquisition with Progress | navigate | https://science.nasa.gov/resource/voyager-reaches-interstellar-space/ | 3846 | navigate: the settled page state moved to a page this Run had not acquired |
| 7 | Acquisition without Progress | navigate | https://science.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar… | 3922 | navigate: landed on a Not-found Page [not found, off-key] |
| 8 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=science.nasa.gov+%22Voyager+1+officially+interstellar+… | 3453 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 9 | Acquisition without Progress | navigate | https://www.nasa.gov/content/nasa-voyager-1-officially-in-interstellar-space/ | 7863 | navigate: landed on a Not-found Page [not found, off-key, search loop] |
| 10 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=site%3Anasa.gov+voyager+1+officially+interstellar+spac… | 2259 | navigate: a search that rewords the one before it (streak 2) [off-key, search loop] |
| 11 | Acquisition with Progress | navigate | http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=p… | 21415 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 12 | Acquisition with Progress | read_page | http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=p… | 5512 | read_page: the first read of this page state [off-key] |
| 13 | Acquisition with Progress | look | http://web.archive.org/cdx/search/cdx?collapse=urlkey&filter=statuscode%3A200&fr… | 2307 | look: the first Look at this page state with this question [off-key] |
| 14 | Acquisition with Progress | navigate | https://www.bing.com/search?q=jpl.nasa.gov+%22Voyager+1%22+June+2013+%22has+not+… | 19156 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 15 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 6698 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 30285 | scroll: the scroll brought new material into view |
| 17 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 3961 | scroll: the scroll brought new material into view |
| 18 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 1418 | scroll: the scroll brought new material into view |
| 19 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 4802 | scroll: the scroll brought new material into view |
| 20 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 5314 | scroll: the scroll brought new material into view |
| 21 | Acquisition without Progress | scroll | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 4040 | scroll: a scroll that answered End of Page |
| 22 | Acquisition without Progress | record_evidence, navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 15364 | navigate: landed on a Not-found Page [not found, off-key] |
| 23 | Acquisition with Progress | navigate | https://www.bing.com/search?q=site%3Ajpl.nasa.gov+Voyager+1+%22interstellar+spac… | 5202 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 24 | Acquisition without Progress | navigate | https://science.nasa.gov/universe/nasas-voyager-1-officially-in-interstellar-spa… | 3543 | navigate: landed on a Not-found Page [not found, off-key] |
| 25 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 36246 | the reserved Answer |

