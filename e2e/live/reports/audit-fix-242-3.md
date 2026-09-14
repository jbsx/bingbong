# Round Audit — bingbong.live-web.information-hunts (fix-242-3)

Generated 2026-09-14T15:42:04.590Z from a capture set created 2026-09-14T15:33:51.734Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 680fe06b; mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p2; audit run at commit 680fe06b

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 85 | 78 | 76 | 1 | 47 (60%) → 46 | 14 (18%) → 15 | 1 (1%) | 11 (14%) | 5 (6%) | 7 (8%) |
| follow_up | 2 | 2 | 27 | 25 | 25 | 0 | 6 (24%) → 8 | 3 (12%) → 1 | 1 (4%) | 15 (60%) | 0 (0%) | 2 (7%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 2 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 28 Off-key round(s), 5 Search Loop round(s) by the reviewer (2 by the streak rule; attempts by search source rail 4, replay 0, none 0), 0 inherited, 3 rejected Evidence Checkpoint(s), 1 walled round(s), 4 navigate(s) landed on a Not-found Page (2 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 stopped early, 2 answer omitted, 13 overrule(s), 19 flag(s); Finalization Causes: budget_exhausted 1, deadline_reached 2, objective_met 1
- follow_up: 1 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 0, replay 0, none 2), 2 inherited, 6 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (0 retried), 0 stopped early, 0 answer omitted, 2 overrule(s), 8 flag(s); Finalization Causes: objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 31 (41%) | 5 (20%) |
| read_page | 17 (22%) | 4 (16%) |
| record_evidence | 12 (16%) | 9 (36%) |
| scroll | 11 (14%) | 0 |
| record_candidate | 0 | 6 (24%) |
| report_run_plan | 4 (5%) | 2 (8%) |
| click | 3 (4%) | 0 |
| agent_results | 1 (1%) | 1 (4%) |
| spawn_agent | 1 (1%) | 1 (4%) |
| type | 2 (3%) | 0 |
| look | 1 (1%) | 0 |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (objective_met); tier investigation (1 Tier Escalation(s) at the deadline); 22 of 24 Tool Rounds used; 23 orchestrator rounds, 1 in Finalization; Run duration 333204 ms; LLM stage 326957 ms over 23 joined round(s)
- grade pass; checks unsatisfied: none
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 8 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- navigates that landed on a Not-found Page: 2 (round 1, 3)
- of those, judged Off-key by the reviewer: 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 7 (32%) · Acquisition without Progress 7 (32%) · Collection 1 (5%) · Bookkeeping 6 (27%) · Failed round 1 (5%) · Finalization 1 (4%)
- search source rail: the rail’s own Search Observations
- **verdict: rounds wasted** — The attempt passed. The only inefficiency is spend that could have been avoided. That covers one Failed round (round 2, a refused re-navigate to a known 404) and one 404 round (round 3). Two more rounds landed on search results pages (rounds 4 and 18), and round 1's navigate also hit a 404. On top of that, 6 of 22 budgeted rounds (27%) were bookkeeping, split into single record_evidence rounds (14, 15, 16, 22) that could have been batched. Together this pushed the Run to 22 of 24 rounds with budget warnings in rounds 18 and 21. None of it cost the result.
- stopped early: no — The attempt is graded pass and no check is unsatisfied, so no early stop is left to judge. It also used 22 of its 24 Tool Rounds and ended with the objective met.
- answer omitted: no — The attempt is graded pass and no check is unsatisfied, so the Answer left nothing out.
- Off-key round 1 (https://www.raspberrypi.com/documentation/computers/camera.html): The navigate in this round landed on a Not-found Page, which can carry no required fact. The round's progress came only from delegating the Subagent, and that delegation was on-key.
- Off-key round 3 (https://www.raspberrypi.com/search/?q=camera+zero+cable+bookworm+libcamera+raspistill): The site search address returned a Not-found Page, so there was no content that could carry any check.
- Off-key round 4 (https://duckduckgo.com/?q=raspberrypi.com+documentation+camera+libcamera+rpicam-still+bookworm&ia=web): This is a search results page. It works as a route to the documentation (round 5 followed it), but the page itself is not a source that can carry a required fact.
- Off-key round 18 (https://duckduckgo.com/?q=raspberrypi.com+camera+module+3+product+specs+ribbon+cable+included+15-pin&ia=web): This is a search results page that led to the product page in round 19. It is not itself a page that can carry the cable or hardware checks.
- overrule round 7 → Acquisition with Progress: read_page asked for part 12 of an 83957-pixel page, while round 6 had read part 2. The shared scroll signature hides the fact that a different section came in. Later rounds recorded evidence from several different observations of https://www.raspberrypi.com/documentation/computers/camera_software.html (obs-9, obs-12, obs-15, obs-16), so these part reads brought in new material.
- overrule round 8 → Acquisition with Progress: Parts 13 and 3 of the long camera_software.html page had not been read before. Each read brought in a new section, not a repeat of an observed state.
- overrule round 9 → Acquisition with Progress: Part 10 of camera_software.html was a section not read before, so this was new material despite the unchanged page signature.
- overrule round 10 → Acquisition with Progress: Part 8 of camera_software.html was a section not read before, so this was new material despite the unchanged page signature.
- overrule round 11 → Acquisition with Progress: Part 7 of camera_software.html was a section not read before, so this was new material despite the unchanged page signature.
- overrule round 12 → Acquisition with Progress: Part 1 of camera_software.html was a section not read before. Recorded evidence was later grounded in low-numbered observations of this page (obs-9, obs-12), which fits these part reads contributing content.
- flag (round 7): Should the part reads in rounds 7–12 of camera_software.html count as Acquisition with Progress because each requested a different part, or stay as repeat reads because the page signature was unchanged?
- flag (round 4): Do rounds 3 and 4 form a Search Loop? Both look for the camera documentation, but round 4 moved from a failed site search to an external search engine and led straight to the right page.
- flag (round 1): Should round 1 be off-key for its 404 navigate even though the same round delegated an on-key Subagent that did the hardware check?
- flag (round 18): Should search results pages that lead directly to a verified source (rounds 4 and 18) count as off-key, or as necessary routing?
- flag: Is rounds_wasted the right label for a passing attempt whose avoidable spend (one failed round, a 404, unbatched bookkeeping) did not affect the result?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:557484aa…, $0.43

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, spawn_agent, navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 145998 | spawn_agent: delegated a Subagent [not found, off-key] |
| 2 | Failed round | navigate ✗ | — | 2998 | every call was refused (navigate) |
| 3 | Acquisition without Progress | navigate | https://www.raspberrypi.com/search/?q=camera+zero+cable+bookworm+libcamera+raspi… | 4550 | navigate: landed on a Not-found Page [not found, off-key] |
| 4 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=raspberrypi.com+documentation+camera+libcamera+rpicam-… | 2806 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 5 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 11401 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 7016 | read_page: the first read of this page state |
| 7 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2689 | read_page: a repeat read of a page state already read |
| 8 | Acquisition without Progress → Acquisition with Progress | read_page, read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6011 | read_page: a repeat read of a page state already read |
| 9 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5089 | read_page: a repeat read of a page state already read |
| 10 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3033 | read_page: a repeat read of a page state already read |
| 11 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1456 | read_page: a repeat read of a page state already read |
| 12 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3471 | read_page: a repeat read of a page state already read |
| 13 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 12368 | record_evidence, record_evidence |
| 14 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 22111 | record_evidence |
| 15 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3618 | record_evidence |
| 16 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 4913 | record_evidence |
| 17 | Collection | agent_results | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2001 | read a finished Subagent Report |
| 18 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=raspberrypi.com+camera+module+3+product+specs+ribbon+c… | 11708 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 19 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/camera-module-3/ | 11216 | navigate: the settled page state moved to a page this Run had not acquired |
| 20 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 15664 | read_page: the first read of this page state |
| 21 | Bookkeeping | record_evidence, record_evidence, navigate ✗ | https://www.raspberrypi.com/products/camera-module-3 | 17877 | record_evidence, record_evidence, navigate |
| 22 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/camera-module-3 | 5112 | record_evidence |
| 23 | Finalization | — | — | 23851 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation; 20 of 24 Tool Rounds used; 21 orchestrator rounds, 1 in Finalization; Run duration 338643 ms; LLM stage 329681 ms over 21 joined round(s)
- grade pass; checks unsatisfied: none
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 8 accepted (0 merged, a floor) and 5 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 6 (30%) · Acquisition without Progress 2 (10%) · Collection 1 (5%) · Bookkeeping 11 (55%) · Failed round 0 (0%) · Finalization 1 (5%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: rounds wasted** — The attempt passed, so no failure mode applies; this names where the budget went. 11 of the 20 budgeted rounds (55%) were bookkeeping (rounds 8-11 and 14-20), including 5 rejected checkpoints in rounds 8, 15, 16 and 19. By contrast, the decisive on-key pages were already acquired by round 13. Round 3 was off-key, and rounds 6-7 were labelled as repeats by code (overruled here). The Run still reached budget_warning 6/24 in round 18 with the objective settled.
- stopped early: no — The attempt was graded pass with no unsatisfied checks, so there is nothing to judge as an early stop.
- answer omitted: no — The attempt was graded pass with no unsatisfied checks, so there is no missing check to trace to a page the Run had read.
- Off-key round 3 (https://www.raspberrypi.com/products/camera-module-v2/): This is the product page for the older module. It is about the wrong subject for the follow-up's checks: it cannot carry the Module 3 lid incompatibility or its official mechanical reason (fact-01, fact-02), and it cannot carry the electrical and software compatibility of Module 3 on the Zero (fact-03). The Run used it only for a size comparison.
- overrule round 6 → Acquisition with Progress: read_page asked for part 4 of https://www.raspberrypi.com/documentation/accessories/camera.html, a part not read in round 5 (part 2). The same page signature made code call it a repeat. The request grew from 26319 to 39220 chars, which points to new page text coming in.
- overrule round 7 → Acquisition with Progress: read_page asked for part 3 of the same documentation page, which had not been read before. The request grew to 45774 chars. Round 9 then recorded evidence citing this page's mechanical note, which fits this part bringing in new material.
- flag: The attempt passed with no unsatisfied checks, and no verdict in the closed set describes a success. Is rounds_wasted, based on the 55% bookkeeping share, the right label, or should the verdict be read as purely descriptive?
- flag (round 3): Is the Camera Module 2 product page really off-key? It was used to compare size against the lid's reference module, which can be seen as context for fact-02, even though it cannot carry the check itself.
- flag (round 6): Should rounds 6 and 7 (read_page parts 4 and 3 with an unchanged page signature) count as new progress, or stand as code's repeat reads?
- flag (round 13): The Zero Case product page is not a verified source for the follow-up, but it states the lid incompatibility. Is it on-key? It was treated as on-key here.
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:1e3ef903…, $0.17

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, spawn_agent, navigate | https://www.raspberrypi.com/products/camera-module-3/ | 108796 | spawn_agent: delegated a Subagent [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 4293 | read_page: the first read of this page state |
| 3 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/camera-module-v2/ | 7407 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 4 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 5601 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 4152 | read_page: the first read of this page state |
| 6 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 4341 | read_page: a repeat read of a page state already read |
| 7 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 3102 | read_page: a repeat read of a page state already read |
| 8 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 22832 | record_evidence, record_evidence — 2 rejected Evidence Checkpoint(s) [2 rejected checkpoint] |
| 9 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 30610 | record_evidence, record_evidence |
| 10 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 5027 | record_evidence |
| 11 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 5575 | record_candidate |
| 12 | Collection | agent_results | https://www.raspberrypi.com/documentation/accessories/camera.html | 6368 | read a finished Subagent Report |
| 13 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 10735 | navigate: the settled page state moved to a page this Run had not acquired |
| 14 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 4286 | record_evidence |
| 15 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 4671 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 16 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 3609 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 17 | Bookkeeping | record_candidate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 6801 | record_candidate |
| 18 | Bookkeeping | record_candidate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 5364 | record_candidate |
| 19 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 20830 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 20 | Bookkeeping | record_evidence | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 23220 | record_evidence |
| 21 | Finalization | — | — | 42061 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 174785 ms; LLM stage 153250 ms over 26 joined round(s)
- grade useful_partial; checks unsatisfied: fact-08, fact-11 (2 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 2 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 19 (79%) · Acquisition without Progress 2 (8%) · Collection 0 (0%) · Bookkeeping 3 (13%) · Failed round 0 (0%) · Finalization 2 (8%)
- search source rail: the rail’s own Search Observations
- **verdict: answer omitted** — Only fact-08 and fact-11 (2 of 17) are unsatisfied, and both sit on S2. The Run reached S2 in round 22 and scrolled it in rounds 23 and 24, but the Answer did not state them.
- secondary: rounds wasted — S2 was reached only in round 22, with 2 rounds left. It was never read with read_page. Of the 24 budgeted rounds, 11 acquisitions were Off-key (rounds 1–8 and 19–21: a 401 wall, browse listings, search results). Round 12 hit End of Page. Rounds 13–14 repeated states already seen. Rounds 16–17 were rejected checkpoints. About 16 of 24 rounds (two-thirds) brought no on-key progress.
- stopped early: no — The Run used all 24 of its 24 Tool Rounds and ended on budget exhaustion. It did not stop early.
- answer omitted: yes (fact-08, fact-11) — Both unsatisfied checks are carried by the case record https://www.rmg.co.uk/collections/objects/rmgc-object-256323 (S2). The Run acquired that page in round 22 and scrolled through it in rounds 23 and 24. The Answer met other checks that depend on that record's fields but left these two unstated.
- Off-key round 1 (https://collections.rmg.co.uk/search/?query=Harrison+H4+marine+timekeeper): A 401 Authorization Required wall. It carried no catalogue content.
- Off-key round 2 (https://www.rmg.co.uk/collections/objects): A general collection browse page with no query. It is a listing, not a record, so it can carry none of the required facts.
- Off-key round 3 (https://www.rmg.co.uk/collections/objects): Same browse listing. The type was blocked by an overlay, so no record content was reached.
- Off-key round 4 (https://www.rmg.co.uk/collections/objects): The click cleared the overlay on the browse listing. Still a listing page with no record fields.
- Off-key round 5 (https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper): A search results page. It lists titles and links, not the fields of either record.
- Off-key round 6 (https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper): Reading the search results page. Its result titles lead to the records but carry none of the required fields.
- Off-key round 7 (https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper): Scrolling the search results. Only result links came into view.
- Off-key round 8 (https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper): Scrolling the search results. This surfaced the link to S1 but not its content.
- Off-key round 19 (https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20and%20K1): A search results page for the case. It has titles only, not the case record's fields or description.
- Off-key round 20 (https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20and%20K1): Scrolling the search results. Only result links came into view.
- Off-key round 21 (https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20and%20K1): Scrolling the search results. This surfaced the link to S2 but not its content.
- overrule round 13 → Acquisition without Progress: The scroll up went back to y=277 on rmgc-object-79142. That is the state already seen in round 10 and fully read in round 11, so it was a repeat observation.
- overrule round 14 → Acquisition without Progress: The scroll up went back to y=0 on rmgc-object-79142. That is the page top already acquired by the navigate in round 9, so it was a repeat observation.
- flag (round 22): S2 was acquired by navigate plus two scrolls, never by read_page. Did the side-by-side placement and the hedged description text actually appear in what the assistant received? If they did not, the omission might be better called a failure to read than an Answer omission.
- flag (round 13): Should the scroll up count as a repeat, or was it a legitimate re-view after the look in round 15 prompted checking for hidden sections?
- flag (round 5): Round 5 is the same search text as the blocked type in round 3, retried after the overlay was cleared in round 4. Should rounds 3 and 5 be treated as a Search Loop, or as one search that was blocked and then retried?
- flag (round 19): The search results pages in rounds 5–8 and 19–21 were the way to the on-key records. Is calling them Off-key too harsh when they were needed for navigation?
- flag: Primary verdict is on the line: is answer_omitted decisive, or rounds_wasted, since S2 was reached only at the budget edge?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:fd26a16c…, $0.22

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://collections.rmg.co.uk/search/?query=Harrison+H4+marine+timekeeper | 35666 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects | 3101 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 3 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects | 8357 | type: the result reports no page movement [off-key] |
| 4 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects | 3351 | click: the settled page state moved [off-key] |
| 5 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper | 1439 | type: the settled page state moved [off-key] |
| 6 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper | 1657 | read_page: the first read of this page state [off-key] |
| 7 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper | 2978 | scroll: the scroll brought new material into view [off-key] |
| 8 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/Harrison%20marine%20timekeeper | 2234 | scroll: the scroll brought new material into view [off-key] |
| 9 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 3276 | navigate: the settled page state moved to a page this Run had not acquired |
| 10 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2726 | scroll: the scroll brought new material into view |
| 11 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2246 | read_page: the first read of this page state |
| 12 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 3236 | scroll: a scroll that answered End of Page |
| 13 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 8810 | scroll: the scroll brought new material into view |
| 14 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 8569 | scroll: the scroll brought new material into view |
| 15 | Acquisition with Progress | look | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 13787 | look: the first Look at this page state with this question |
| 16 | Bookkeeping | record_evidence | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 4780 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 17 | Bookkeeping | record_evidence | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 4207 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 18 | Bookkeeping | record_evidence | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 7632 | record_evidence |
| 19 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20an… | 2191 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 20 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20an… | 1476 | scroll: the scroll brought new material into view [off-key] |
| 21 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/Carrying%20case%20for%20H4%20an… | 1748 | scroll: the scroll brought new material into view [off-key] |
| 22 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1588 | navigate: the settled page state moved to a page this Run had not acquired |
| 23 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1487 | scroll: the scroll brought new material into view |
| 24 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1460 | scroll: the scroll brought new material into view |
| 25 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 15247 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (deadline_reached); tier lookup; 7 of 12 Tool Rounds used; 10 orchestrator rounds, 2 in Finalization; Run duration 264691 ms; LLM stage 259696 ms over 10 joined round(s)
- grade useful_partial; checks unsatisfied: fact-07 (1 of 14)
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 5 (63%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 2 (25%) · Failed round 1 (13%) · Finalization 2 (20%)
- search source rail: the rail’s own Search Observations
- **verdict: answer omitted** — 13 of the 14 checks were satisfied. Every Acquisition round except the search in round 1 was on-key and productive: rounds 2–5 (4 of 8 budgeted rounds) read both official pages. The one missing check, fact-07, could be worked out from material read in rounds 3 and 5 and recorded in round 6, but the Answer in round 10 left it unstated.
- stopped early: no — The Run used 7 of its 12 Tool Rounds, but it ended because the active-work deadline was reached (round 8 was cut by it), so no time was left. The only unsatisfied check, fact-07, did not need a page the Run had not read.
- answer omitted: yes (fact-07) — fact-07 follows directly from two pages the Run read: the allowance count on https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage (read in round 3) and the rule that the guitar uses an allowance slot on https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage/musical-instruments (read in round 5). Both were recorded as Evidence in round 6. The Answer did not state it.
- Off-key round 1 (https://duckduckgo.com/?q=Eurostar+luggage+allowance+official&ia=web): This is a search results page. It can point to the official source, but it cannot itself carry any required fact.
- flag (round 1): Should the DuckDuckGo results page in round 1 count as Off-key, given that it led straight to the on-key official page in round 2?
- flag (round 8): Round 8 was cut by the active-work deadline and the Finalization round 9 was cut by its allowance. Should failed_rounds be a secondary verdict, on the grounds that the lost time may have squeezed the Answer that omitted fact-07?
- flag: Does fact-07 really follow from material the Run read, or is it a counterfactual the pages never state, in which case omitting it is a reasoning gap rather than an omission of page material?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:2287cd12…, $0.12

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=Eurostar+luggage+allowance+official&ia=web | 108635 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage | 3292 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | read_page | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage | 3440 | read_page: the first read of this page state |
| 4 | Acquisition with Progress | navigate | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage/musical-instr… | 1855 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | read_page | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage/musical-instr… | 1443 | read_page: the first read of this page state |
| 6 | Bookkeeping | record_evidence, record_evidence, record_evidence | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage/musical-instr… | 69230 | record_evidence, record_evidence, record_evidence |
| 7 | Bookkeeping | record_evidence | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage/musical-instr… | 19101 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 8 | Failed round | — | — | 16654 | cut by the active-work deadline |
| 9 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 10 | Finalization | — | — | 26045 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 5 of 12 Tool Rounds used; 6 orchestrator rounds, 1 in Finalization; Run duration 68396 ms; LLM stage 67094 ms over 6 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 0 (0%) · Acquisition without Progress 1 (20%) · Collection 0 (0%) · Bookkeeping 4 (80%) · Failed round 0 (0%) · Finalization 1 (17%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: rounds wasted** — The attempt passed, so nothing cost it its result. This is the closest fit from the closed set for the small overhead it did have. Round 1 (1 of 5 budgeted rounds, 20%) re-read https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage, a page the initial attempt had already checkpointed. Round 3 was a record_candidate call rejected with unknown_candidate and repeated as rounds 4 and 5. That leaves 2 of 5 rounds (40%) as repeats or corrections. The Run still used only 5 of its 12 Tool Rounds.
- stopped early: no — The attempt was graded pass with no unsatisfied checks, so no check needed a page the Run had not read. It ended on objective_met after 5 of 12 Tool Rounds.
- answer omitted: no — No check is unsatisfied, so the Answer left nothing out that a page the Run had read would have supported.
- flag: The attempt passed with no unsatisfied checks and used 5 of 12 rounds. Should any failure verdict apply at all, or is rounds_wasted only a nominal choice forced by the closed set?
- flag (round 1): Round 1 re-navigated to an inherited page, but that visit produced the Premier allowance excerpt recorded in round 2, and the tool reported it as contradicting earlier observations from the same source. Should round 1 be overruled to acquisition_with_progress because it brought in material the initial attempt had not recorded?
- flag (round 1): The page read was the rw-en locale of the Eurostar luggage page, not the uk-en URL the key verifies. Is it right to treat it as an equivalent official page and so on-key?
- flag (round 3): Round 3 cited an evidence id where a candidate id was needed and was rejected, which led to rounds 4 and 5. Should it count as a wasted round, or as ordinary bookkeeping?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:eacdff04…, $0.09

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage | 13131 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Bookkeeping | record_evidence | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage | 18056 | record_evidence |
| 3 | Bookkeeping | record_candidate | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage | 10985 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 4 | Bookkeeping | record_candidate | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage | 8823 | record_candidate |
| 5 | Bookkeeping | record_candidate | https://www.eurostar.com/rw-en/travel-info/travel-planning/luggage | 2838 | record_candidate |
| 6 | Finalization | — | — | 13261 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / partial (deadline_reached); tier investigation; 23 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 413355 ms; LLM stage 333906 ms over 26 joined round(s)
- grade useful_partial; checks unsatisfied: fact-01 (1 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 walled round(s)
- Malformed Answers: 0 (0 retried)
- navigates that landed on a Not-found Page: 2 (round 2, 3)
- of those, judged Off-key by the reviewer: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 16 (67%) · Acquisition without Progress 5 (21%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 3 (13%) · Finalization 2 (8%)
- search source rail: the rail’s own Search Observations
- **verdict: rounds wasted** — Of 24 budgeted rounds, only rounds 17, 18, 21 and 23 were on-key. That is 4 of 24. After the overrules, 12 rounds landed on Off-key pages: error pages, walled or plain search results, a cache lookup, an archive index and a wrong-subject release (rounds 1, 4, 6, 8, 9, 11, 12, 13, 15, 16, 19, 20). Rounds 4-12 formed one Search Loop, and rounds 2, 3, 7, 10 made no progress. Most of this chased a guessed JPL statement slug and never reached the June account the task needed, which left fact-01 unsatisfied.
- secondary: failed rounds — 3 of 24 rounds failed. Rounds 14 and 22 were refused. Round 24 was cut by the active-work deadline right after the September announcement was read in round 23, so the Run lost its last chance to go looking for the June account.
- stopped early: no — The Run did not end with time left. It ended on deadline_reached, with round 24 cut by the active-work deadline after 23 of 24 Tool Rounds. fact-01 did need a page the Run never read, but the stop was the deadline, not a choice made with budget and time remaining.
- answer omitted: no — No page the Run read carries fact-01. The June account itself was never opened. Round 18 read a later JPL statement at https://web.archive.org/web/20210323210432/https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-solar-wind-models. Round 23 read the September announcement. Rounds 16 and 20 were a wrong-subject release. Nothing in the digest shows any of these carries the check.
- Search Loop over rounds 4, 5, 8, 11, 12: Five consecutive searches with one intent: find the June JPL statement page by title, slug, quoted phrase and then release number. The reads and click in rounds 6, 7, 9, 10 and 13 do not break the loop. The app marked only rounds 4-5 as a streak. Rounds 8, 11 and 12 reword the same hunt even where they share few tokens.
- Off-key round 1 (https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-solar-wind-and-a-journey-to-interstellar-space/): 502 Bad Gateway error page with no content. It was also a guessed address, not either of the official accounts.
- Off-key round 4 (https://www.google.com/search?q=NASA+JPL+%22Voyager+Statement+About+Solar+Windy+and+a+Journey+to+Interstellar+Space%22+June+2013): Search results page behind a challenge wall. It can carry no facts.
- Off-key round 6 (https://www.bing.com/search?q=jpl.nasa.gov+%22voyager+statement+about+solar+wind+and+a+journey+to+interstellar+space%22): Read of a search results page. Result snippets are not the official accounts.
- Off-key round 8 (https://www.bing.com/search?q=%22nasa-voyager-statement-about-solar-wind%22+site%3Ajpl.nasa.gov): Search results page for a slug of a different, later statement.
- Off-key round 9 (https://www.bing.com/search?q=%22nasa-voyager-statement-about-solar-wind%22+site%3Ajpl.nasa.gov): Read of a search results page, which was short and ended in round 10.
- Off-key round 11 (https://www.bing.com/search?q=%22Voyager+1+has+not+yet+left+the+solar+system%22+June+2013+JPL+statement): Search results page.
- Off-key round 12 (https://www.bing.com/search?q=jpl.nasa.gov+news.php%3Frelease%3D2013-207+voyager): Search results page for a release number that turned out to be the wrong subject.
- Off-key round 13 (https://www.bing.com/search?q=jpl.nasa.gov+news.php%3Frelease%3D2013-207+voyager): Click inside the same search results page.
- Off-key round 15 (https://webcache.googleusercontent.com/search?q=cache:jpl.nasa.gov/news/nasa-voyager-statement-about-solar-wind-models/): Google cache lookup titled as a Google Search page, not an article. It was also aimed at the later solar-wind-models statement, not the June account.
- Off-key round 16 (https://web.archive.org/web/20140106061309/http://www.jpl.nasa.gov/news/news.php?release=2013-207): Right site, wrong subject: an archived JPL release about near-Earth objects.
- Off-key round 19 (https://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=prefix&from=20130601&to=20131001&filter=original:.*oyager.*&collapse=urlkey&fl=timestamp,original&limit=80): Archive index listing of capture timestamps and URLs. It holds no article text.
- Off-key round 20 (https://web.archive.org/web/20130627164147/http://www.jpl.nasa.gov/news/news.php?release=2013-207): Same wrong-subject near-Earth-object release as round 16, in a different capture.
- overrule round 1 → Acquisition without Progress: The page was a 502 error with no content, so nothing new came in even though the URL was new.
- overrule round 8 → Acquisition without Progress: A member of the Search Loop in rounds 4-12. It rewords the hunt for the same JPL statement.
- overrule round 11 → Acquisition without Progress: A member of the Search Loop in rounds 4-12. It is the same intent in a new wording.
- overrule round 12 → Acquisition without Progress: A member of the Search Loop in rounds 4-12. It is the same intent, now searched by release number.
- overrule round 20 → Acquisition without Progress: Different capture of the same wrong-subject release 2013-207 that round 16 already acquired, so no new material.
- flag (round 8): Rounds 8, 11 and 12 use quite different queries (a slug, a quoted phrase, a release number). Are they rewordings of one intent, or should the loop end at round 5?
- flag (round 15): Is the Google cache lookup Off-key as a search page, or should it count as an attempt at an article copy, and is its progress label right?
- flag (round 17): The later JPL solar-wind-models statement (rounds 17-18) is judged on-key because it held plasma-density material. Should it count as Off-key, since it is neither of the two official accounts?
- flag (round 19): The CDX archive index carries no article text. Should it count as a productive navigation step rather than Off-key?
- flag (round 20): Is round 20 a repeat of round 16 (the same release in a different capture), or new acquisition as the app labelled it?
- flag (round 24): Is failed_rounds a fair secondary verdict, given that the deadline cut in round 24 followed from time spent on wasted rounds rather than causing the loss on its own?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:019590e1…, $0.25

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress → Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-solar-wind-and-a-jour… | 85964 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition without Progress | navigate | https://www.nasa.gov/mission_pages/voyager/voyager20130912.html | 1861 | navigate: landed on a Not-found Page [not found] |
| 3 | Acquisition without Progress | navigate | https://www.jpl.nasa.gov/news/nasa-voyager-statement-about-solar-wind-and-a-jour… | 2043 | navigate: landed on a Not-found Page [not found] |
| 4 | Acquisition with Progress | navigate | https://www.google.com/search?q=NASA+JPL+%22Voyager+Statement+About+Solar+Windy+… | 3037 | navigate: the settled page state moved to a page this Run had not acquired [walled, off-key, search loop, loop head by the streak rule] |
| 5 | Acquisition without Progress | navigate | https://www.bing.com/search?q=jpl.nasa.gov+%22voyager+statement+about+solar+wind… | 1902 | navigate: a search that rewords the one before it (streak 2) [search loop] |
| 6 | Acquisition with Progress | read_page | https://www.bing.com/search?q=jpl.nasa.gov+%22voyager+statement+about+solar+wind… | 1497 | read_page: the first read of this page state [off-key] |
| 7 | Acquisition without Progress | click | https://www.bing.com/search?q=jpl.nasa.gov+%22voyager+statement+about+solar+wind… | 7784 | click: the action changed neither the URL nor the page signature |
| 8 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.bing.com/search?q=%22nasa-voyager-statement-about-solar-wind%22+site… | 14741 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 9 | Acquisition with Progress | read_page | https://www.bing.com/search?q=%22nasa-voyager-statement-about-solar-wind%22+site… | 1455 | read_page: the first read of this page state [off-key] |
| 10 | Acquisition without Progress | scroll | https://www.bing.com/search?q=%22nasa-voyager-statement-about-solar-wind%22+site… | 1445 | scroll: a scroll that answered End of Page |
| 11 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.bing.com/search?q=%22Voyager+1+has+not+yet+left+the+solar+system%22+… | 4992 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 12 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.bing.com/search?q=jpl.nasa.gov+news.php%3Frelease%3D2013-207+voyager | 41744 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 13 | Acquisition with Progress | click | https://www.bing.com/search?q=jpl.nasa.gov+news.php%3Frelease%3D2013-207+voyager | 3147 | click: the settled page state moved [off-key] |
| 14 | Failed round | navigate ✗ | — | 2151 | every call was refused (navigate) |
| 15 | Acquisition with Progress | navigate | https://webcache.googleusercontent.com/search?q=cache:jpl.nasa.gov/news/nasa-voy… | 1683 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 16 | Acquisition with Progress | navigate | https://web.archive.org/web/20140106061309/http://www.jpl.nasa.gov/news/news.php… | 46977 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 17 | Acquisition with Progress | navigate | https://web.archive.org/web/20210323210432/https://www.jpl.nasa.gov/news/nasa-vo… | 5427 | navigate: the settled page state moved to a page this Run had not acquired |
| 18 | Acquisition with Progress | read_page | https://web.archive.org/web/20210323210432/https://www.jpl.nasa.gov/news/nasa-vo… | 2759 | read_page: the first read of this page state |
| 19 | Acquisition with Progress | navigate | https://web.archive.org/cdx/search/cdx?url=jpl.nasa.gov/news/news.php&matchType=… | 41728 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 20 | Acquisition with Progress → Acquisition without Progress | navigate, record_evidence | https://web.archive.org/web/20130627164147/http://www.jpl.nasa.gov/news/news.php… | 7072 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 21 | Acquisition with Progress | navigate | https://web.archive.org/web/20130913155933/http://www.nasa.gov/mission_pages/voy… | 2312 | navigate: the settled page state moved to a page this Run had not acquired |
| 22 | Failed round | read_page ✗ | https://web.archive.org/web/20130913155933/http://www.nasa.gov/mission_pages/voy… | 1983 | every call was refused (read_page) |
| 23 | Acquisition with Progress | read_page | https://web.archive.org/web/20130913155933/http://www.nasa.gov/mission_pages/voy… | 2664 | read_page: the first read of this page state |
| 24 | Failed round | — | — | 20158 | cut by the active-work deadline |
| 25 | Finalization | — | — | 10000 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 17380 | the reserved Answer |

