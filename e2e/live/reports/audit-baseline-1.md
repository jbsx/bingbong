# Round Audit — bingbong.live-web.information-hunts (baseline-1)

Generated 2026-09-13T22:10:41.876Z from a capture set created 2026-09-12T17:06:30.219Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) fbd2b865 (dirty tree); mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p1; audit run at commit 182d4d68 (dirty tree)

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 73 | 66 | 66 | 3 | 48 (73%) → 37 | 9 (14%) → 20 | 1 (2%) | 4 (6%) | 4 (6%) | 7 (10%) |
| follow_up | 2 | 2 | 42 | 39 | 38 | 0 | 20 (51%) → 17 | 10 (26%) → 13 | 0 (0%) | 7 (18%) | 2 (5%) | 3 (7%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 3 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 26 Off-key round(s), 5 Search Loop round(s) by the reviewer (3 by the streak rule), 0 inherited, 1 rejected Evidence Checkpoint(s), 1 walled round(s), 13 Subagent round(s), 1 stopped early, 11 overrule(s), 22 flag(s); Finalization Causes: budget_exhausted 3, model_answered 1
- follow_up: 7 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule), 5 inherited, 2 rejected Evidence Checkpoint(s), 0 walled round(s), 0 Subagent round(s), 0 stopped early, 3 overrule(s), 9 flag(s); Finalization Causes: deadline_reached 1, objective_met 1

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
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 2 accepted and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 17 (71%) · Acquisition without Progress 4 (17%) · Collection 1 (4%) · Bookkeeping 1 (4%) · Failed round 1 (4%) · Finalization 2 (8%)
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
- 0 Subagent round(s) over 0 Subagent(s); 7 accepted and 1 rejected Evidence Checkpoint(s); 3 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 9 (43%) · Acquisition without Progress 6 (29%) · Collection 0 (0%) · Bookkeeping 4 (19%) · Failed round 2 (10%) · Finalization 2 (9%)
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
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 7 (58%) · Acquisition without Progress 2 (17%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 3 (25%) · Finalization 2 (14%)
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
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 3 (50%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 3 (50%) · Failed round 0 (0%) · Finalization 1 (14%)
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
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted and 1 rejected Evidence Checkpoint(s); 2 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 11 (61%) · Acquisition without Progress 4 (22%) · Collection 0 (0%) · Bookkeeping 3 (17%) · Failed round 0 (0%) · Finalization 1 (5%)
- **verdict: rounds wasted** — The attempt passed within budget. Of its 18 budgeted rounds, only 3 to 5 (on S1), 11, 14 and 17 landed on pages that could carry the required facts, and the evidence that counted came from rounds 14 and 17. About a third went to rounds without progress: 1, 2, 7, 17, plus round 8 after the overrule. Another 6 went to off-key pages: 6, 8, 9 and 10 on the Help Centre hub, the 404 in round 12 and the search page in round 13. Round 16 also spent a bookkeeping round on a rejected checkpoint for a page it had not yet opened. The run met its objective anyway, but rounds 6 to 13 were a detour that did not advance it.
- stopped early: no — The run ended once the objective was met, with 18 of 24 rounds used, and the grade reports no unreached checks. Nothing was left undone that it could have reached.
- Off-key round 6 (https://help.eurostar.com/?language=uk-en): Help Centre home page: a hub of category links and a search box. It states no per-class allowance and no instrument rule, so it cannot carry fact-01, fact-02 or fact-03 itself.
- Off-key round 8 (https://help.eurostar.com/?language=uk-en): A read of the same Help Centre hub. It is navigation material only and holds none of the required facts.
- Off-key round 9 (https://help.eurostar.com/?language=uk-en): A scroll on the Help Centre hub. It only brought more category links into view, not an allowance statement.
- Off-key round 10 (https://help.eurostar.com/?language=uk-en): A scroll on the Help Centre hub. It surfaced the Luggage category link but no allowance text.
- Off-key round 12 (https://www.eurostar.com/uk-en/travel-info/tickets-fares/eurostar-premier): The title says the page was not found. A 404 page carries no facts.
- Off-key round 13 (https://duckduckgo.com/?q=site%3Aeurostar.com+Eurostar+Premier+luggage+allowance&ia=web): A search results page. It lists links but cannot itself carry the official allowance, and the run did not open any result from it.
- overrule round 8 → Acquisition without Progress: The read_page shows the same URL and the same page signature (ce3bfea4) that the round 6 navigate already returned, and round 7's type was blocked, so the page did not change. This was a repeat observation of a state already seen, not a first read.
- flag (round 6): Should the Help Centre hub (rounds 6, 8, 9, 10) count as off-key, or as reasonable on-site navigation toward a luggage FAQ that could have carried the allowance?
- flag (round 8): Is round 8's read_page really a repeat of round 6's state (same signature ce3bfea4), or did the read expose page text the navigate result had cut off, which would make it progress?
- flag (round 11): Is the Help Centre FAQ page from round 11 on-key? It is an official luggage page that could state class allowances, but it is not the verified source.
- flag (round 17): Round 17 is labelled a re-acquisition of an inherited page. Should it count as productive, given that the run needed a fresh observation of that page for round 18's checkpoint to be accepted?
- flag: Is 'rounds_wasted' too strong as the primary verdict for an attempt that passed with 6 rounds to spare, when none of the listed categories really cost it its result?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:7f2ae15e…, $0.16

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 68519 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition without Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 17787 | scroll: a scroll that answered End of Page |
| 3 | Acquisition with Progress | click | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 13100 | click: the settled page state moved |
| 4 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 6334 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4454 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | navigate | https://help.eurostar.com/?language=uk-en | 58032 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition without Progress | type | https://help.eurostar.com/?language=uk-en | 9071 | type: the result reports no page movement |
| 8 | Acquisition with Progress → Acquisition without Progress | read_page | https://help.eurostar.com/?language=uk-en | 6054 | read_page: the first read of this page state [off-key] |
| 9 | Acquisition with Progress | scroll | https://help.eurostar.com/?language=uk-en | 7957 | scroll: the scroll brought new material into view [off-key] |
| 10 | Acquisition with Progress | scroll | https://help.eurostar.com/?language=uk-en | 2602 | scroll: the scroll brought new material into view [off-key] |
| 11 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 4432 | navigate: the settled page state moved to a page this Run had not acquired |
| 12 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/tickets-fares/eurostar-premier | 5110 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
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
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 1 walled round(s)
- kinds: Acquisition with Progress 21 (88%) · Acquisition without Progress 3 (13%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 0 (0%) · Finalization 2 (8%)
- **verdict: rounds wasted** — Only about 8 of the 24 budgeted rounds did on-key productive work: round 6, and rounds 15-20 reading https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-solar-bubble/ (S1), plus round 14, whose results led there. About 16 of 24 rounds (~67%) went elsewhere. Six were 404s from guessing slugs for the September release (rounds 1, 5, 7, 9, 22, 24). Three were the search loop in rounds 2-4, including a walled Google page. Three more were search pages for the same release (rounds 8, 10, 23). Three were spent on a Wayback CDX index (rounds 11-13), and round 21 was an End of Page scroll. The verified September source was never reached, which leaves fact-07 unreached.
- stopped early: no — The Run used all 24 of its 24 Tool Rounds and ended on budget_exhausted.
- Search Loop over rounds 2, 3, 4: Three searches in a row for the same intent: the June 2013 JPL statement. Round 2 hit a Google wall, and rounds 3 and 4 reran reworded versions of that query on DuckDuckGo. The app's streak count confirms it, and the round 4 search_loop_nudge fired.
- Search Loop over rounds 8, 10: Both searches seek the same thing, the September 2013 NASA release (rounds 8 and 10). The only round between them is round 9, one more guessed nasa.gov URL for that same release, so the intent never changed. The app reset the streak because the engine and wording changed.
- Off-key round 1 (https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-entering-interstellar-space/): A 404 at a guessed JPL slug, so the page holds no content.
- Off-key round 2 (https://www.google.com/search?q=NASA+Voyager+statement+June+2013+%22has+not+yet+left+the+heliosphere%22+or+%22not+yet+in+interstellar+space%22+jpl): A search results page behind a Google challenge wall. It can carry no required fact.
- Off-key round 3 (https://duckduckgo.com/?q=NASA+Voyager+1+June+2013+statement+%22not+yet+in+interstellar+space%22+%22magnetic+field%22+jpl.nasa.gov): A search results page. It can lead to a source but cannot carry any fact-NN itself.
- Off-key round 4 (https://duckduckgo.com/?q=Voyager+1+June+27+2013+NASA+statement+interstellar+space+not+yet): A search results page, and a loop member.
- Off-key round 5 (https://www.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar-space): A 404 at a guessed nasa.gov slug. The verified September source lives at a different path.
- Off-key round 7 (https://science.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar-space/): A 404 at a guessed science.nasa.gov slug.
- Off-key round 8 (https://duckduckgo.com/?q=science.nasa.gov+%22Voyager+1+officially+interstellar+space%22+September+2013+press+release): A search results page. No required fact can be carried there.
- Off-key round 9 (https://www.nasa.gov/content/nasa-voyager-1-officially-in-interstellar-space/): A 404 at a guessed slug.
- Off-key round 10 (https://duckduckgo.com/?q=site%3Anasa.gov+voyager+1+officially+interstellar+space+September+12+2013): A search results page.
- Off-key round 11 (http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=prefix&from=20130601&to=20131231&filter=statuscode:200&limit=300&collapse=urlkey): A Wayback CDX index, which lists only capture URLs and timestamps. It cannot carry any fact about the release content.
- Off-key round 12 (http://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=prefix&from=20130601&to=20131231&filter=statuscode:200&limit=300&collapse=urlkey): A read of the same CDX index. The page is only a capture listing.
- Off-key round 13 (http://web.archive.org/cdx/search/cdx?collapse=urlkey&filter=statuscode%3A200&from=20130601&limit=300&matchType=prefix&to=20131231&url=jpl.nasa.gov%2Fnews%2Fnews.php): A Look at the CDX index. It returned timestamped news.php URLs, not release text.
- Off-key round 14 (https://www.bing.com/search?q=jpl.nasa.gov+%22Voyager+1%22+June+2013+%22has+not+yet%22+interstellar+space+magnetic+field+statement): A search results page. It did lead to the June source, but the page itself carries no fact.
- Off-key round 22 (https://www.jpl.nasa.gov/news/nasas-voyager-1-officially-in-interstellar-space/): A 404 at a guessed JPL slug for the September release.
- Off-key round 23 (https://www.bing.com/search?q=site%3Ajpl.nasa.gov+Voyager+1+%22interstellar+space%22+September+2013+plasma+wave+%22April+9%2C+2013%22): A search results page, restricted to jpl.nasa.gov, while the verified September source is on nasa.gov.
- Off-key round 24 (https://science.nasa.gov/universe/nasas-voyager-1-officially-in-interstellar-space/): A 404 at a guessed science.nasa.gov slug.
- overrule round 1 → Acquisition without Progress: The navigate landed on a 404 at https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-entering-interstellar-space/. The URL was new, but no material came in.
- overrule round 2 → Acquisition without Progress: This opens the loop of rounds 2-4, and the Google page was walled by a challenge, so nothing was acquired.
- overrule round 5 → Acquisition without Progress: The guessed URL returned a 404 with no material.
- overrule round 7 → Acquisition without Progress: The guessed URL returned a 404 with no material.
- overrule round 9 → Acquisition without Progress: The guessed URL returned a 404 with no material.
- overrule round 10 → Acquisition without Progress: This search rewords round 8's search for the same September release, making it a loop member.
- overrule round 22 → Acquisition without Progress: The navigate in this round hit a 404. The accepted record_evidence call rides alongside it, but the acquisition itself brought nothing.
- overrule round 24 → Acquisition without Progress: The guessed URL returned a 404 with no material.
- flag (round 1): Should the 404 navigations in rounds 1, 5, 7, 9, 22 and 24 stay as Acquisition with Progress, since the URLs were new? Or is the overrule to without-Progress right, since nothing came in?
- flag (round 14): Is it fair to call the round 14 Bing results page Off-key, when it is what led the Run to S1 in round 15?
- flag (round 6): https://science.nasa.gov/resource/voyager-reaches-interstellar-space/ is a NASA resource page and was left on-key. Could it carry any fact-NN, or is it a modern summary that should count as Off-key under pitfall-05?
- flag (round 10): Are rounds 8 and 10 one Search Loop, even though a guessed-URL navigate (round 9) sits between them? And should round 23, which seeks the same September release after further guesses, be counted in that loop too?
- flag (round 11): Were the CDX index rounds 11-13 a reasonable archival detour, since the listing could have revealed release URLs, rather than Off-key waste?
- flag (round 16): Rounds 16 and 17 brought only carousel buttons and share links into view. Should they count as Progress?
- flag: The grade is useful_partial with only fact-07 unreached. Is rounds_wasted too harsh as primary, given that the Answer still carried most of the checks?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:453f8ad1…, $0.26

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress → Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-entering-interstellar… | 117157 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.google.com/search?q=NASA+Voyager+statement+June+2013+%22has+not+yet+… | 8156 | navigate: the settled page state moved to a page this Run had not acquired [walled, off-key, search loop, loop head by the streak rule] |
| 3 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=NASA+Voyager+1+June+2013+statement+%22not+yet+in+inter… | 2607 | navigate: a search that rewords the one before it (streak 2) [off-key, search loop] |
| 4 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=Voyager+1+June+27+2013+NASA+statement+interstellar+spa… | 5926 | navigate: a search that rewords the one before it (streak 3) [off-key, search loop] |
| 5 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar-spa… | 7521 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 6 | Acquisition with Progress | navigate | https://science.nasa.gov/resource/voyager-reaches-interstellar-space/ | 3846 | navigate: the settled page state moved to a page this Run had not acquired |
| 7 | Acquisition with Progress → Acquisition without Progress | navigate | https://science.nasa.gov/press-release/nasa-voyager-1-officially-in-interstellar… | 3922 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 8 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=science.nasa.gov+%22Voyager+1+officially+interstellar+… | 3453 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 9 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.nasa.gov/content/nasa-voyager-1-officially-in-interstellar-space/ | 7863 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 10 | Acquisition with Progress → Acquisition without Progress | navigate | https://duckduckgo.com/?q=site%3Anasa.gov+voyager+1+officially+interstellar+spac… | 2259 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
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
| 22 | Acquisition with Progress → Acquisition without Progress | record_evidence, navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 15364 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 23 | Acquisition with Progress | navigate | https://www.bing.com/search?q=site%3Ajpl.nasa.gov+Voyager+1+%22interstellar+spac… | 5202 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 24 | Acquisition with Progress → Acquisition without Progress | navigate | https://science.nasa.gov/universe/nasas-voyager-1-officially-in-interstellar-spa… | 3543 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 25 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 36246 | the reserved Answer |

