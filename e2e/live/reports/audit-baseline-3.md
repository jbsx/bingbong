# Round Audit — bingbong.live-web.information-hunts (baseline-3)

Generated 2026-09-13T03:47:10.128Z from a capture set created 2026-09-12T18:57:29.347Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 59bdf48b (dirty tree); mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p1; audit run at commit 81048ebf (dirty tree)

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 71 | 64 | 63 | 2 | 40 (63%) → 32 | 8 (13%) → 16 | 1 (2%) | 8 (13%) | 7 (11%) | 7 (10%) |
| follow_up | 2 | 2 | 40 | 36 | 36 | 2 | 23 (64%) → 20 | 4 (11%) → 7 | 1 (3%) | 5 (14%) | 3 (8%) | 4 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 2 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 1 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 1 | 0 | 0 | 0 |
| failed rounds | 1 | 1 | 0 | 1 |

- initial: 15 Off-key round(s), 5 Search Loop round(s) by the reviewer (1 by the streak rule), 0 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 13 Subagent round(s), 1 stopped early, 8 overrule(s), 20 flag(s); Finalization Causes: budget_exhausted 2, deadline_reached 1, objective_met 1
- follow_up: 1 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule), 2 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 13 Subagent round(s), 0 stopped early, 3 overrule(s), 10 flag(s); Finalization Causes: budget_exhausted 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| scroll | 17 (27%) | 14 (39%) |
| navigate | 21 (33%) | 6 (17%) |
| record_evidence | 8 (13%) | 3 (8%) |
| look | 3 (5%) | 5 (14%) |
| type | 7 (11%) | 0 |
| read_page | 2 (3%) | 3 (8%) |
| report_run_plan | 3 (5%) | 2 (6%) |
| record_candidate | 0 | 4 (11%) |
| click | 3 (5%) | 0 |
| agent_results | 1 (2%) | 1 (3%) |
| ground_visual | 0 | 2 (6%) |
| spawn_agent | 1 (2%) | 1 (3%) |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 266324 ms; LLM stage 196187 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-05, fact-06 (2 of 10)
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 4 accepted and 3 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 16 (67%) · Acquisition without Progress 2 (8%) · Collection 1 (4%) · Bookkeeping 5 (21%) · Failed round 0 (0%) · Finalization 2 (8%)
- **verdict: rounds wasted** — About 9 of the 24 budgeted rounds (roughly 38%) produced nothing new: round 1 was an off-key 404, rounds 7–10 scrolled up and back down over parts of camera_software.html that rounds 4–6 had already shown, rounds 16 and 20 navigated back to URLs the run already had, and rounds 12 and 24 were evidence records that were all rejected. The unreached fact-05 and fact-06 both sit on camera_software.html, the page the run held from round 4 onward. Its scrolling there went no deeper than y=1385, and the rounds that went back over the top of the page could have been spent reading further down.
- secondary: tier too small or never escalated — The rest of the work stayed on the two key pages and was productive: rounds 2–6, 11, 17–18 and 21–22 plus the subagent (rounds 15 and 23) supported the cable and hardware findings. The investigation-tier budget of 24 rounds ran out while the run was still on the right page, and it never moved up a tier.
- stopped early: no — The run used all 24 of its budgeted rounds and ended with budget_exhausted. It did not stop with budget left.
- Off-key round 1 (https://www.raspberrypi.com/documentation/computers/camera.html): The navigate landed on a 'Page not found' 404. The page has no content, so it can carry none of the required facts.
- overrule round 7 → Acquisition without Progress: Scrolled up to y=277 on camera_software.html, a scroll position round 5 had already shown. It re-observed a known state instead of reaching the unread sections further down.
- overrule round 8 → Acquisition without Progress: Scrolled up to y=0 on camera_software.html, the top of the page that the round 4 navigate had already shown (cookie banner and header links).
- overrule round 9 → Acquisition without Progress: Scrolled down to y=277 on camera_software.html. Its result head matches round 5 word for word, so it repeats a state already seen.
- overrule round 10 → Acquisition without Progress: Scrolled down to y=554 on camera_software.html. Its result head matches round 6 word for word, so it repeats a state already seen.
- flag (round 7): Round 7's result head lists a Camera Module 2 link that round 5's head did not show. Was round 7 really a repeat of round 5's state, or did it bring in a little new material?
- flag (round 16): The navigate to the #autofocus anchor on camera_software.html is labelled as a repeat URL. Should it count as progress if the anchor moved the view to a section the run had not seen, given that round 17 then reports y=1108?
- flag (round 21): Rounds 21–22 scrolled accessories/camera.html to y=277 and y=554 after an anchor navigate. Round 3 had already scrolled to y=277 on that page, though with a different result head. Do these rounds count as progress or as repeats?
- flag (round 12): Rounds 12 and 24 had all of their evidence records rejected as malformed. Should they count toward wasted rounds, or stay as ordinary bookkeeping?
- flag: Should the secondary verdict be tier_too_small_or_never_escalated, or is rounds_wasted alone enough, since the wasted rounds, if spent reading, might have reached fact-05 and fact-06 within the same budget?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:e03bffa8…, $0.20

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 82344 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 1697 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 3298 | scroll: the scroll brought new material into view |
| 4 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1480 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 4788 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2982 | scroll: the scroll brought new material into view |
| 7 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5513 | scroll: the scroll brought new material into view |
| 8 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3429 | scroll: the scroll brought new material into view |
| 9 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 4166 | scroll: the scroll brought new material into view |
| 10 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2196 | scroll: the scroll brought new material into view |
| 11 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5125 | scroll: the scroll brought new material into view |
| 12 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6103 | record_evidence, record_evidence — 2 rejected Evidence Checkpoint(s) [2 rejected checkpoint] |
| 13 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5385 | record_evidence |
| 14 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3318 | record_evidence |
| 15 | Acquisition with Progress | spawn_agent | https://www.raspberrypi.com/documentation/computers/camera_software.html | 11890 | spawn_agent: delegated a Subagent |
| 16 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 8643 | navigate: a navigate to a URL this Run already acquired |
| 17 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3949 | scroll: the scroll brought new material into view |
| 18 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1905 | scroll: the scroll brought new material into view |
| 19 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2264 | record_evidence |
| 20 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html#install-a-rasp… | 4161 | navigate: a navigate to a URL this Run already acquired |
| 21 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 1241 | scroll: the scroll brought new material into view |
| 22 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 1562 | scroll: the scroll brought new material into view |
| 23 | Collection | agent_results | https://www.raspberrypi.com/documentation/accessories/camera.html | 4124 | read a finished Subagent Report |
| 24 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 3018 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 25 | Finalization | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 3095 | the bookkeeping round (record_evidence) |
| 26 | Finalization | — | — | 18511 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (budget_exhausted); tier investigation (1 Tier Escalation(s) at the deadline); 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 443819 ms; LLM stage 426768 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-02 (1 of 6)
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 5 accepted and 3 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 14 (58%) · Acquisition without Progress 3 (13%) · Collection 1 (4%) · Bookkeeping 5 (21%) · Failed round 1 (4%) · Finalization 2 (8%)
- **verdict: rounds wasted** — The source for the unreached fact-02, https://www.raspberrypi.com/documentation/accessories/camera.html, was open from round 12, but little of the remaining budget went into reading it. Round 13 was an illegible look and round 14 a refused ground_visual. Rounds 15–18 scrolled 277 px at a time and only got to y=1108 on a long page. They never did a read_page, which would have surfaced the mechanical section. Before that, rounds 2–11 spent 10 of 24 rounds (42%) on the Camera Module 3 product page and two news posts. Round 7 was off-key, and rounds 3, 6 and 10 made no progress. At the end, rounds 20–24 went to bookkeeping (5 of 24, 21%), and rounds 21 and 22 were record_candidate calls rejected as malformed. In all, about 7 rounds made no progress or failed (3, 6, 10, 13, 14, 21, 22), 1 was off-key (7), and only rounds 12 and 15–18 worked toward fact-02 on its source.
- stopped early: no — The Run used all 24 of its 24 Tool Rounds (budget_exhausted) and received a budget warning at round 23. It did not stop with budget left.
- Off-key round 7 (https://www.raspberrypi.com/news/camera-module-3-show-off-your-shots/): The guessed URL redirected to a community photo showcase post. That is the right site but the wrong subject: it covers neither case-lid fit, nor mechanical dimensions, nor electrical or software compatibility, so it can carry none of fact-01, fact-02 or fact-03.
- overrule round 6 → Acquisition without Progress: ground_visual only returned a element ref on the Camera Module 3 product page that round 5 had already looked at. The app's own notice in the same result says two consecutive actions made no progress. No new material came in.
- overrule round 10 → Acquisition without Progress: The look on https://www.raspberrypi.com/news/new-autofocus-camera-modules returned only the article title, which the round 8 navigate had already shown. Nothing new came in, and round 11 had to read the page again.
- flag (round 12): The navigate to camera.html is labelled without progress because the initial attempt already checkpointed that page. Its mechanical section, the part this follow-up needed, had never been read. Should it count as Acquisition with Progress for this step?
- flag (round 8): Could the Camera Module 3 launch post https://www.raspberrypi.com/news/new-autofocus-camera-modules/ carry part of fact-02 (for example matching board dimensions)? Or is it off-key because fact-02 depends on the official mechanical documentation, which would make rounds 8–11 off-key as well?
- flag (round 2): The Camera Module 3 product page (rounds 2–6) is judged on-key because it could support fact-03, which concerns compatibility that does not change. Should it instead be treated as off-key for a follow-up whose new question is lid fit?
- flag (round 3): The scroll answered End of Page at y=277, but round 4 shows the page is 8310 px tall. Was this a real End of Page, or a scroll failure that should be classed as a failed round?
- flag (round 10): Is a look that returned only the page title really a round without progress, or should the mechanical label with progress stand?
- flag: Should tier_too_small_or_never_escalated be a secondary verdict? The Run stayed on the investigation tier and never escalated, but much of its budget went to unproductive rounds, so a larger budget may not have been what it lacked.
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:aab3fc84…, $0.21

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, record_evidence, navigate, spawn_agent | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 172200 | navigate: the settled page state moved to a page this Run had not acquired [1 rejected checkpoint] |
| 2 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/camera-module-3/ | 5013 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition without Progress | scroll | https://www.raspberrypi.com/products/camera-module-3 | 2045 | scroll: a scroll that answered End of Page |
| 4 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 5469 | read_page: the first read of this page state |
| 5 | Acquisition with Progress | look | https://www.raspberrypi.com/products/camera-module-3 | 5550 | look: the first Look at this page state with this question |
| 6 | Acquisition with Progress → Acquisition without Progress | ground_visual | https://www.raspberrypi.com/products/camera-module-3 | 1684 | ground_visual: the first Look at this page state with this question |
| 7 | Acquisition with Progress | navigate | https://www.raspberrypi.com/news/camera-module-3-show-off-your-shots/ | 6887 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 8 | Acquisition with Progress | navigate | https://www.raspberrypi.com/news/new-autofocus-camera-modules/ | 2059 | navigate: the settled page state moved to a page this Run had not acquired |
| 9 | Acquisition with Progress | scroll | https://www.raspberrypi.com/news/new-autofocus-camera-modules | 3046 | scroll: the scroll brought new material into view |
| 10 | Acquisition with Progress → Acquisition without Progress | look | https://www.raspberrypi.com/news/new-autofocus-camera-modules | 5835 | look: the first Look at this page state with this question |
| 11 | Acquisition with Progress | read_page | https://www.raspberrypi.com/news/new-autofocus-camera-modules/ | 8545 | read_page: the first read of this page state |
| 12 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 31176 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 13 | Acquisition without Progress | look | https://www.raspberrypi.com/documentation/accessories/camera.html | 10154 | look: the Look returned nothing legible |
| 14 | Failed round | ground_visual ✗ | https://www.raspberrypi.com/documentation/accessories/camera.html | 8019 | every call was refused (ground_visual) |
| 15 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 3539 | scroll: the scroll brought new material into view |
| 16 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 1330 | scroll: the scroll brought new material into view |
| 17 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 4865 | scroll: the scroll brought new material into view |
| 18 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/accessories/camera.html | 5731 | scroll: the scroll brought new material into view |
| 19 | Collection | record_evidence, agent_results | https://www.raspberrypi.com/documentation/accessories/camera.html | 17751 | read a finished Subagent Report |
| 20 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 61489 | record_evidence, record_evidence |
| 21 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 12167 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 22 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 10731 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 23 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 8956 | record_candidate |
| 24 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 5226 | record_candidate |
| 25 | Finalization | — | — | 10002 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 17299 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 186557 ms; LLM stage 157331 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-03, fact-05, fact-08, fact-10, fact-11 (5 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 13 (54%) · Acquisition without Progress 5 (21%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 6 (25%) · Finalization 2 (8%)
- **verdict: rounds wasted** — Rounds 1 to 16 never reached a record page. Nine of them (1, 4, 8, 9, 11, 13, 14, 15, 16) were off-key listings or results pages, and rounds 8 to 15 formed one Search Loop. With rounds 3, 6, 10, 19 and 21 already labelled without progress and rounds 9, 13, 15 and 24 overruled, 9 of 24 rounds (38%) made no progress. Only rounds 17, 18 and 23, about 3 of 24 (13%), were on-key and productive. The watch record (S1) arrived at round 17 with 7 rounds left, which was too late to also reach the case record (S2) that fact-08, fact-10 and fact-11 need.
- secondary: failed rounds — Six of 24 rounds (25%) failed: 2, 5, 7, 12, 20 and 22. The refusals in rounds 2, 5 and 7 blocked the on-site search box and pushed the Run toward outside search engines. The Look refusals in rounds 20 and 22 on S1 cost two of the last seven rounds before the round 23 read_page.
- stopped early: no — The Run used all 24 of 24 Tool Rounds and ended on budget exhaustion. The case record (S2) had never been found on any page it held, so it did not stop early.
- Search Loop over rounds 8, 9, 10, 13, 15: Every one of these rewords a single intent: find the Harrison watch record in the RMG collection. Round 8 is a Bing site search; rounds 9 and 10 run the same query on two RMG search paths. Round 13 types a reworded query into the listing's search box and round 15 narrows it to one name. The scrolls in rounds 11 and 14 are reads of the results and do not break the loop. The app counted rounds 9 and 15 as fresh streaks only because the engine or path changed.
- Off-key round 1 (https://www.rmg.co.uk/collections/objects): A generic collection listing page, not an object record, so it cannot carry any required fact.
- Off-key round 4 (https://www.rmg.co.uk/collections/objects): The same generic listing. The click changed the page state but stayed on a listing that cannot carry any required fact.
- Off-key round 8 (https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+longitude+watch): A search engine results page. It can point to a record but cannot itself carry a catalogue field.
- Off-key round 9 (https://www.rmg.co.uk/collections/search?q=Harrison+longitude+watch): An on-site search results page, not the watch or case record.
- Off-key round 11 (https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch): A scroll on a results listing. The new material was unrelated objects (hull models, house flags), so it is the right site but the wrong subject.
- Off-key round 13 (https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch): Text typed into a results listing. The page stayed a listing, not a record.
- Off-key round 14 (https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch): A scroll on the same listing that again showed unrelated objects.
- Off-key round 15 (https://www.rmg.co.uk/collections/object?q=%22Harrison%22&filter=date): A filtered results listing, which cannot carry the record fields.
- Off-key round 16 (https://duckduckgo.com/?q=rmg.co.uk+collections+Harrison+H4+longitude+timekeeper+rmgc-object&ia=web): A search engine results page. It surfaced the record URL, but a results page cannot carry the required record fields.
- overrule round 9 → Acquisition without Progress: It rewords the round 8 search on a different engine, so it is a member of the rounds 8 to 15 Search Loop.
- overrule round 13 → Acquisition without Progress: It types a reworded query into the same results listing. That is a loop member, not progress, even though the page signature changed.
- overrule round 15 → Acquisition without Progress: It narrows the same search intent again on the RMG listing, so it is a loop member.
- overrule round 24 → Acquisition without Progress: It navigates to the record already acquired in round 17 with only a meaningless page parameter added. The title and page are unchanged, so this repeats an acquired page.
- flag (round 16): Should round 16 join the rounds 8 to 15 Search Loop? It serves the same intent, but it was the search that surfaced the record URL, so I left it out.
- flag (round 16): Is round 16 really off-key? A search engine results page cannot carry record fields, yet this one was the step that led to S1.
- flag (round 24): Is round 24 a repeat of the round 17 page or new material? A different URL parameter might return a different page state.
- flag (round 18): Should round 18 count as without progress? The scroll on S1 brought only a cookie settings button into view.
- flag (round 4): Is round 4 off-key? It may have dismissed an overlay needed to use the search box rather than acquiring anything.
- flag: Is failed_rounds the right secondary? At 25% of the budget, including the refusals in rounds 2, 5 and 7 that blocked on-site search, a reviewer could weigh it close to rounds_wasted as the primary cause.
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:192e5ef4…, $0.31

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects | 41903 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects | 3128 | every call was refused (type) |
| 3 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects | 4115 | type: the app’s own no-progress Notice rode the result |
| 4 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects | 4134 | click: the settled page state moved [off-key] |
| 5 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects | 1366 | every call was refused (type) |
| 6 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects | 2619 | type: the app’s own no-progress Notice rode the result |
| 7 | Failed round | click ✗ | https://www.rmg.co.uk/collections/objects | 1360 | every call was refused (click) |
| 8 | Acquisition with Progress | navigate | https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+longitude+wa… | 6767 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 9 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/search?q=Harrison+longitude+watch | 6525 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 10 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 5623 | navigate: a search that rewords the one before it (streak 2) [search loop] |
| 11 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 6719 | scroll: the scroll brought new material into view [off-key] |
| 12 | Failed round | type ✗ | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 9389 | every call was refused (type) |
| 13 | Acquisition with Progress → Acquisition without Progress | type | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 1961 | type: a requested state change (text entered or an option selected) [off-key, search loop] |
| 14 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 3584 | scroll: the scroll brought new material into view [off-key] |
| 15 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/object?q=%22Harrison%22&filter=date | 1478 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 16 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=rmg.co.uk+collections+Harrison+H4+longitude+timekeeper… | 7270 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 17 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 3265 | navigate: the settled page state moved to a page this Run had not acquired |
| 18 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 3191 | scroll: the scroll brought new material into view |
| 19 | Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2153 | look: the Look returned nothing legible |
| 20 | Failed round | look ✗ | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2014 | every call was refused (look) |
| 21 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 6341 | scroll: a scroll that answered End of Page |
| 22 | Failed round | look ✗ | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 3403 | every call was refused (look) |
| 23 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1344 | read_page: the first read of this page state |
| 24 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142?page=2 | 1599 | navigate: the settled page state moved to a page this Run had not acquired |
| 25 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 16079 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier investigation (1 Tier Escalation(s) at the deadline); 15 of 24 Tool Rounds used; 16 orchestrator rounds, 1 in Finalization; Run duration 310484 ms; LLM stage 294145 ms over 16 joined round(s)
- grade useful_partial; checks not reached: fact-07 (1 of 14)
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 11 (73%) · Acquisition without Progress 1 (7%) · Collection 0 (0%) · Bookkeeping 3 (20%) · Failed round 0 (0%) · Finalization 1 (6%)
- **verdict: stopped early** — 15 of 24 rounds were used (62.5%) and no budget or time pressure ended the Run. Both verified sources were acquired and recorded as evidence by round 7 (rounds 2, 4-5, 6-7), with a matching FAQ added in rounds 9-10 and 15. The one unreached check, fact-07, could be derived from material already in hand, yet the Run stopped and answered without it.
- stopped early: yes — The Run ended with objective_met after 15 of 24 budgeted rounds, so 9 rounds were left. The only unreached check, fact-07, needs no new page. It follows from the allowance count on https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage (round 2) and the guitar-slot rule on https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments (rounds 4-5), and both were already recorded as evidence in rounds 6-7. The check was within reach when the Run stopped.
- Off-key round 1 (https://duckduckgo.com/?q=Eurostar+luggage+allowance+musical+instruments+official+site+eurostar.com&ia=web): A search results page. It lists links and cannot state any required fact itself, though it led to the official luggage page in round 2.
- Off-key round 11 (https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-with-me): The guessed FAQ URL loaded the Help Centre home page (title 'Home | Eurostar Help Centre'). It is the right site but the wrong subject, a generic landing page with no allowance or instrument rules.
- Off-key round 12 (https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-with-me): Typing into the quick-search box on the Help Centre home page was blocked by an overlay. The page was still the generic home page and carried none of the required facts.
- Off-key round 13 (https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-with-me): A full read of the Help Centre home page from round 11. It is a search box and navigation hub, not a page carrying allowance counts or the guitar exception.
- Off-key round 14 (https://duckduckgo.com/?q=site%3Ahelp.eurostar.com+musical+instrument+Eurostar+luggage+allowance+guitar&ia=web): A search results page. It can only point to sources, not state a required fact, and it served only to find the FAQ URL used in round 15.
- flag: fact-07 is a conclusion to draw from pages already read, not something to fetch. Is stopped_early the right verdict, or is this an Answer-writing omission that no amount of extra rounds would have fixed?
- flag: 5 of 12 acquisition rounds were off-key (1, 11, 12, 13, 14), about 42%. The budget never ran out, so this waste did not cost the result. Should rounds_wasted still be recorded as a secondary verdict?
- flag (round 1): Should a search results page that leads straight to a verified source (round 2) count as off-key, or as a necessary on-key step toward the key's sources?
- flag (round 8): https://help.eurostar.com/faq/uk-en/category/luggage is a category index of FAQ titles. Could it carry allowance facts in expanded answers, or should it be marked off-key like the search pages?
- flag (round 12): The type call returned 'not typed — blocked by overlay'. Is that a refused call, making round 12 a failed round rather than acquisition without progress?
- flag (round 13): read_page of the Help Centre home page, already in view since round 11, is labelled a first read with progress. Should it be overruled to acquisition without progress as a repeat observation of an already-observed state?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:15c5f7fe…, $0.17

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=Eurostar+luggage+allowance+musical+instruments+officia… | 136152 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5343 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | click | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 11883 | click: the settled page state moved |
| 4 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 1555 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 27050 | scroll: the scroll brought new material into view |
| 6 | Bookkeeping | record_evidence, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5743 | record_evidence, record_evidence |
| 7 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 2809 | record_evidence |
| 8 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/category/luggage | 7628 | navigate: the settled page state moved to a page this Run had not acquired |
| 9 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 6755 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Bookkeeping | record_evidence | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 3251 | record_evidence |
| 11 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-wit… | 10670 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 12 | Acquisition without Progress | type | https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-wit… | 2985 | type: the result reports no page movement [off-key] |
| 13 | Acquisition with Progress | read_page | https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-wit… | 1895 | read_page: the first read of this page state [off-key] |
| 14 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=site%3Ahelp.eurostar.com+musical+instrument+Eurostar+l… | 3062 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 15 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on… | 2227 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Finalization | — | — | 65137 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / partial (budget_exhausted); tier lookup; 12 of 12 Tool Rounds used; 14 orchestrator rounds, 2 in Finalization; Run duration 119619 ms; LLM stage 116385 ms over 14 joined round(s)
- grade useful_partial; checks not reached: fact-01, fact-02, fact-03 (3 of 6)
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 9 (75%) · Acquisition without Progress 1 (8%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 2 (17%) · Finalization 2 (14%)
- **verdict: rounds wasted** — All the work stayed on one on-key page, https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, but the budget went on slow reading of it. Round 1 re-opened a page the initial attempt already had. Rounds 2-7 were six one-screen scrolls of about 277 px each, when a single read_page would have returned the table. Round 9 scrolled past the table, and round 11 scrolled back to a position already seen. The page text was only read in round 12, the last budgeted round. Counting rounds 1, 8, 10 and 11, 4 of 12 rounds (33%) made no progress. The six scrolls also spread one page's text over half the budget, so the class labels needed for fact-01, fact-02 and fact-03 were never tied down.
- secondary: failed rounds — Rounds 8 and 10 (2 of 12, 17%) were refused look calls. Round 10 retried the check refused in round 8 instead of switching to read_page, which was only used in round 12. Without these two rounds, the page read would have come early enough to confirm which class gets which allowance.
- stopped early: no — The Run used all 12 of its 12 Tool Rounds and ended on budget_exhausted, so it did not stop with budget left.
- overrule round 11 → Acquisition without Progress: The scroll up went back to y=1662, the same position already seen in round 7, and it showed the class table text round 6 had already shown. It revisited a state the Run had already seen; nothing new came in.
- flag (round 1): Should the inherited navigate count as without progress? This Run had not yet observed the page, and it could not read the page without loading it.
- flag (round 11): Is the overrule to without progress right? The mechanical label counted new text in view, but the scroll went back to the y=1662 position seen in round 7.
- flag: Should the primary verdict be tier_too_small_or_never_escalated instead of rounds_wasted? Rounds 2-7 were mechanically labelled with progress and all stayed on key, and the lookup tier's 12 rounds were never escalated.
- flag (round 9): Was round 9 wasted overshoot, or a fair progress round? It scrolled past the table but did bring new page text into view.
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:b7527ab6…, $0.13

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 17348 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 11444 | scroll: the scroll brought new material into view |
| 3 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 3428 | scroll: the scroll brought new material into view |
| 4 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1233 | scroll: the scroll brought new material into view |
| 5 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4323 | scroll: the scroll brought new material into view |
| 6 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1331 | scroll: the scroll brought new material into view |
| 7 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2438 | scroll: the scroll brought new material into view |
| 8 | Failed round | look ✗ | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9810 | every call was refused (look) |
| 9 | Acquisition with Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 8843 | scroll: the scroll brought new material into view |
| 10 | Failed round | look ✗ | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 16966 | every call was refused (look) |
| 11 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9204 | scroll: the scroll brought new material into view |
| 12 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4011 | read_page: the first read of this page state |
| 13 | Finalization | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 9739 | the bookkeeping round (record_evidence) |
| 14 | Finalization | — | — | 16267 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / partial (deadline_reached); tier investigation (1 Tier Escalation(s) at the deadline); 0 of 24 Tool Rounds used; 3 orchestrator rounds, 2 in Finalization; Run duration 368440 ms; LLM stage 368430 ms over 3 joined round(s)
- grade useful_partial; checks not reached: fact-06, pitfall-01 (2 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 0 (0%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 1 (100%) · Finalization 2 (67%)
- **verdict: failed rounds** — The only budgeted round, round 1, failed on a timeout (1 of 1 budgeted rounds, 100%). It took about 90% of the Run's time (330002 of 368440 ms) and made no tool calls. 0 of the 24 Tool Rounds were used, so no official account was ever fetched. The Answer came from the reserved Finalization rounds 2-3, and round 2 was itself cut by the Finalization Allowance. That is why the checks tied to the sources, fact-06 and pitfall-01, went unreached.
- stopped early: no — The Run did not stop with time left. Round 1 hit the client timeout after 330002 ms of the 368440 ms Run, the deadline was reached, and rounds 2-3 were Finalization. No pages were ever acquired, so the unreached checks (fact-06, pitfall-01) were not within reach of anything the Run held.
- flag (round 1): Round 1 timed out after producing 62793 chars of reasoning with no tool call, under a deadline plan. Should this count as a failed round (a client timeout), or as a planning failure where the model spent its time thinking instead of acquiring pages? The second reading could point to a different verdict.
- flag (round 2): Round 2 was a Finalization round cut by the Finalization Allowance after 10001 ms. Did losing it add to the partial grade, beyond the round 1 timeout?
- flag: The grade is useful_partial, and most checks were met with zero acquisition. Is failed_rounds still the right primary verdict? Or does the result say the task was mostly answerable from memory, which would make the unreached pitfall-01 the real cost?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:d9aeea60…, $0.07

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Failed round | — | — | 330002 | the client’s request timeout ended the round |
| 2 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 3 | Finalization | — | — | 28427 | the reserved Answer |

