# Round Audit — bingbong.live-web.information-hunts (fix-235-3)

Generated 2026-09-13T14:09:35.241Z from a capture set created 2026-09-13T13:51:29.248Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 7b6e2727; mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p1; audit run at commit 7b6e2727 (dirty tree)

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 84 | 78 | 78 | 2 | 44 (56%) → 46 | 17 (22%) → 15 | 0 (0%) | 13 (17%) | 4 (5%) | 6 (7%) |
| follow_up | 2 | 2 | 24 | 22 | 22 | 0 | 5 (23%) → 7 | 5 (23%) → 3 | 1 (5%) | 11 (50%) | 0 (0%) | 2 (8%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 4 | 0 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 25 Off-key round(s), 5 Search Loop round(s) by the reviewer (1 by the streak rule), 0 inherited, 4 rejected Evidence Checkpoint(s), 0 walled round(s), 0 Subagent round(s), 0 stopped early, 8 overrule(s), 22 flag(s); Finalization Causes: budget_exhausted 2, objective_met 2
- follow_up: 1 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule), 3 inherited, 5 rejected Evidence Checkpoint(s), 0 walled round(s), 18 Subagent round(s), 0 stopped early, 2 overrule(s), 9 flag(s); Finalization Causes: objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 32 (41%) | 5 (23%) |
| read_page | 18 (23%) | 5 (23%) |
| record_evidence | 11 (14%) | 7 (32%) |
| record_candidate | 3 (4%) | 4 (18%) |
| report_run_plan | 4 (5%) | 2 (9%) |
| type | 6 (8%) | 0 |
| click | 4 (5%) | 0 |
| look | 4 (5%) | 0 |
| scroll | 2 (3%) | 0 |
| agent_results | 0 | 1 (5%) |
| spawn_agent | 0 | 1 (5%) |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 283090 ms; LLM stage 277220 ms over 26 joined round(s)
- grade pass; checks not reached: none
- 0 Subagent round(s) over 0 Subagent(s); 8 accepted and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 10 (42%) · Acquisition without Progress 7 (29%) · Collection 0 (0%) · Bookkeeping 6 (25%) · Failed round 1 (4%) · Finalization 2 (8%)
- **verdict: rounds wasted** — The attempt passed and reached every check, but spent budget on rounds that added nothing. Rounds 1 and 17 hit the same 404, and round 17 was a deliberate return to it. Round 2 was a refused navigate to an unresolvable host. Rounds 3–4 were index hops. Round 11 re-navigated to an S3 anchor the Run already had. Round 22 was a rejected checkpoint. That is 7 of 24 rounds (29%) with no on-key progress. Mechanically, 7 of 24 were counted without progress, but after the overrules of rounds 7, 13–15 and 20 the real waste sits in rounds 1–4, 11, 17 and 22. With 6 of 24 more rounds on bookkeeping, the budget ran out just as the candidate was accepted, which left no slack.
- stopped early: no — The Run used all 24 of its 24 budgeted Tool Rounds and ended with budget_exhausted. It also accepted its candidate in round 24 with no checks left unreached.
- Off-key round 1 (https://www.raspberrypi.com/documentation/computers/camera.html): The page title is 'Page not found'. A 404 cannot carry any required fact, even though it is on the right site.
- Off-key round 3 (https://www.raspberrypi.com/documentation/): This is the documentation index, a page of links. It holds none of the camera, cable or software content that fact-01 to fact-06 need. It only helped find S3.
- Off-key round 4 (https://www.raspberrypi.com/documentation/): Round 4 read the same index page as round 3. The text is a link hub with no required-fact content.
- Off-key round 17 (https://www.raspberrypi.com/documentation/computers/camera.html): Round 17 went back to the same 404 that round 1 had already hit. The 'Page not found' page cannot carry any required fact.
- overrule round 7 → Acquisition with Progress: Round 6 read part 2 of S3 (camera_software.html) and round 7 read part 1, so the text was different even though the page signature was the same. The very next round, 8, recorded the legacy-stack and rpicam evidence from this S3 content, which supports fact-05 and fact-06. That is new material, not a repeat.
- overrule round 13 → Acquisition with Progress: Round 13 read part 3 of S3 after round 12 had read part 4. It is a text segment the Run had not read before. The label counted it as a repeat only because the page signature was the same.
- overrule round 14 → Acquisition with Progress: Round 14 read part 6 of S3, which no earlier round had read. A different text part of a long page is new material, not a repeat observation.
- overrule round 15 → Acquisition with Progress: Round 15 read part 7 of S3, a segment not read before. Round 16 then immediately recorded the autofocus-control evidence (memory-4, obs-20) for fact-06, so the read produced new material.
- overrule round 20 → Acquisition with Progress: Round 19 read part 2 of S2 (accessories/camera.html) and round 20 read part 1. Round 21 then recorded evidence from S2 (memory-5 and memory-6, obs-24 and obs-25) for fact-01 and fact-04, so this read supplied new text.
- flag (round 3): Is the documentation index page https://www.raspberrypi.com/documentation/ off-key, or legitimate on-key navigation toward S2 and S3?
- flag (round 4): Should reading the documentation index count as off-key when its only use was to find the S3 link?
- flag (round 7): Should reading a different part of an already-loaded page count as progress (overruled here), or as a repeat observation because the page signature did not change?
- flag (round 13): Rounds 13 and 14 read new parts of S3, but no evidence was recorded directly from them. Are they progress or reading that went nowhere?
- flag: Is rounds_wasted the right primary for an attempt that passed and completed its candidate in the last budgeted round, given the waste is only about 29% of rounds? Or should there be no adverse finding, with tier_too_small_or_never_escalated as an alternative?
- flag (round 22): Should the malformed record_candidate in round 22 count as a wasted round, or as ordinary bookkeeping cost?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:0aac614c…, $0.29

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 35341 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Failed round | navigate ✗ | — | 3984 | every call was refused (navigate) |
| 3 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/ | 15684 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 4 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/ | 3810 | read_page: the first read of this page state [off-key] |
| 5 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 4197 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 15708 | read_page: the first read of this page state |
| 7 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6444 | read_page: a repeat read of a page state already read |
| 8 | Acquisition with Progress | record_evidence, record_evidence, navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 11115 | navigate: the settled page state moved to a page this Run had not acquired |
| 9 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 4049 | read_page: the first read of this page state |
| 10 | Bookkeeping | record_evidence, read_page ✗ | https://www.raspberrypi.com/products/camera-module-3 | 34563 | record_evidence, read_page |
| 11 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 9161 | navigate: a navigate to a URL this Run already acquired |
| 12 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 2710 | read_page: the first read of this page state |
| 13 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 3397 | read_page: a repeat read of a page state already read |
| 14 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 1832 | read_page: a repeat read of a page state already read |
| 15 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 2174 | read_page: a repeat read of a page state already read |
| 16 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3681 | record_evidence |
| 17 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 2748 | navigate: a navigate to a URL this Run already acquired [off-key] |
| 18 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 1792 | navigate: the settled page state moved to a page this Run had not acquired |
| 19 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 10456 | read_page: the first read of this page state |
| 20 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 1575 | read_page: a repeat read of a page state already read |
| 21 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 40826 | record_evidence, record_evidence |
| 22 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 25735 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 23 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 2814 | record_candidate |
| 24 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 6123 | record_candidate |
| 25 | Finalization | — | — | 10002 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 17299 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation; 16 of 24 Tool Rounds used; 17 orchestrator rounds, 1 in Finalization; Run duration 272611 ms; LLM stage 238109 ms over 17 joined round(s)
- grade pass; checks not reached: none
- 18 Subagent round(s) over 2 Subagent(s), stopped by model_answered 1, budget_exhausted 1; 7 accepted and 3 rejected Evidence Checkpoint(s); 2 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 4 (25%) · Acquisition without Progress 4 (25%) · Collection 1 (6%) · Bookkeeping 7 (44%) · Failed round 0 (0%) · Finalization 1 (6%)
- **verdict: rounds wasted** — The attempt passed. The only cost visible is rounds spent without progress. Round 3 was an Off-key 404. Rounds 1 and 4 re-navigated to inherited pages. Rounds 10 and 11 were bookkeeping retries whose every checkpoint was rejected as malformed, with a third rejection in round 8. Bookkeeping took 7 of 16 budgeted rounds (44%), and about 5 of 16 rounds did no useful work. The on-key content came from rounds 2, 5–7 and 15.
- stopped early: no — The Run ended with objective_met after 16 of 24 rounds, with every check reached and a pass grade. No check was left unreached, so the unused budget was not a missed opportunity.
- Off-key round 3 (https://www.raspberrypi.com/products/camera-module-2/): The navigate landed on a 'Page not found' 404, so the page could carry none of fact-01, fact-02 or fact-03.
- overrule round 7 → Acquisition with Progress: read_page part 3 of https://www.raspberrypi.com/documentation/accessories/camera.html brought in a section of a 27163-px page the Run had not read yet. The signature matches only because a partial read does not move the page. The evidence recorded right after it in round 8 is grounded in that page's content, so this read brought in new material rather than repeating an observation.
- overrule round 6 → Acquisition with Progress: read_page part 2 of the same documentation page is a different section from the part 4 read in round 5. It is new material, not a repeat of a page state already read.
- flag: The attempt passed with budget to spare. Is rounds_wasted too harsh a primary for a successful run whose waste was only a few rounds?
- flag (round 6): Should reading a different part of an already-loaded page count as progress, overruling the mechanical 'repeat read' label?
- flag (round 7): Same question as round 6: is the part-3 read new material, given that the page signature was unchanged?
- flag (round 2): Is the read of https://www.raspberrypi.com/products/camera-module-3/ on-key for this follow-up? It is not a follow-up verified source, but it could support fact-03's point that the cable and software conclusions still hold.
- flag (round 15): https://www.raspberrypi.com/products/raspberry-pi-zero-case/ is not the follow-up's verified source, yet it carries the lid-compatibility statement behind fact-01. Is it correct to treat it as on-key?
- flag (round 1): Should the inherited re-navigation stay acquisition_without_progress, given that the round also filed the Run Plan and set up the Subagent work in round 2?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:ab77de4b…, $0.16

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.raspberrypi.com/products/camera-module-3/ | 70796 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page, spawn_agent, spawn_agent | https://www.raspberrypi.com/products/camera-module-3/ | 13537 | read_page: the first read of this page state |
| 3 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/camera-module-2/ | 3589 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 4 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 2718 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 5 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 3659 | read_page: the first read of this page state |
| 6 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 5000 | read_page: a repeat read of a page state already read |
| 7 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 2318 | read_page: a repeat read of a page state already read |
| 8 | Bookkeeping | record_evidence, record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 27177 | record_evidence, record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 9 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 4256 | record_evidence |
| 10 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 2728 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 11 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 2203 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 12 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 9098 | record_evidence |
| 13 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 11917 | record_candidate |
| 14 | Collection | agent_results | https://www.raspberrypi.com/documentation/accessories/camera.html | 4714 | read a finished Subagent Report |
| 15 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 16356 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 17979 | record_evidence, record_evidence |
| 17 | Finalization | — | — | 40064 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 226251 ms; LLM stage 192518 ms over 26 joined round(s)
- grade useful_partial; checks not reached: fact-04, fact-08, fact-09, fact-10, fact-11 (5 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 14 (58%) · Acquisition without Progress 7 (29%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 3 (13%) · Finalization 2 (8%)
- **verdict: rounds wasted** — Only round 24 of 24 landed on a key source (S1, rmgc-object-79142). Rounds 4, 7, 8, 11, 15, 20 and 23 were without progress (7 of 24). Rounds 6, 9 and 19 are overruled to the same (10 of 24 in all). Thirteen rounds labelled progress were Off-key listings, search pages or wrong-subject records (1, 3, 5, 12, 13, 14, 16, 18, 21, 22, plus the overruled 6, 9, 19). Most of the budget went on on-site searches that never filtered and on unrelated records, rounds 14 and 21. That left no round to open the case record S2, where fact-08 to fact-11 sit.
- secondary: failed rounds — Rounds 2, 10 and 17 (3 of 24) were refused outright when typing into or clicking the site search. Rounds 4, 11 and 20 were blocked by an overlay. Together these 6 of 24 rounds kept the site's own search unusable and pushed the Run into guessed URLs and web search.
- stopped early: no — The Run used all 24 of its 24 budgeted Tool Rounds (budget_exhausted). Round 24 reached S1 on the very last budgeted round, so the case record S2 behind fact-08 to fact-11 was never opened for lack of budget, not by choice.
- Search Loop over rounds 3, 6, 9: Rounds 3, 6 and 9 are the same on-site search for a Harrison longitude watch, reworded and moved between URL forms (/collections/search?Query=, /collections/objects?Query=, ?Search=). The rounds between them (4 blocked type, 5 read, 7 End of Page scroll, 8 illegible look) are reads that don't break the loop. None of the three result pages led to an object record.
- Search Loop over rounds 22, 23: The app marked this streak and it holds. Both are site-restricted web searches for the same watch-and-case records, one on Bing and one on DuckDuckGo, differing only in wording.
- Off-key round 1 (https://www.rmg.co.uk/collections/objects): Unfiltered collection landing page. It lists no object record, so it can carry none of the watch or case facts.
- Off-key round 3 (https://www.rmg.co.uk/collections/search?Query=Harrison%20H4%20longitude%20watch): Search results page. At most it points to records; it can't carry fact-02 to fact-11 itself.
- Off-key round 5 (https://www.rmg.co.uk/collections/search?Query=Harrison%20H4%20longitude%20watch): A read of the same search results page as round 3. It is a listing, not the watch record or the case record.
- Off-key round 6 (https://www.rmg.co.uk/collections/objects?Query=Harrison+longitude+watch): Collection results listing. Round 8's look found nothing legible and the scroll ended at once, so no record was reached.
- Off-key round 9 (https://www.rmg.co.uk/collections/objects?Search=Harrison%20H4): Results listing. Rounds 12 and 13 show it held unrelated objects (hull model, house flag), so the parameter did not filter to the watch.
- Off-key round 12 (https://www.rmg.co.uk/collections/objects?Search=Harrison%20H4): The click only changed the state of an unfiltered listing. It is not a watch or case record.
- Off-key round 13 (https://www.rmg.co.uk/collections/objects?Search=Harrison+H4): The scroll showed unrelated objects (rmgc-object-548960 and a house flag). This is the wrong subject.
- Off-key round 14 (https://www.rmg.co.uk/collections/objects/rmgc-object-534260): A catalogue record on the right site but the wrong subject: a shipping house flag, reached by accident when the type landed on a link. It can carry none of the required facts.
- Off-key round 16 (https://www.rmg.co.uk/collections/objects): Collection root with text typed into the search field. The search was never submitted (round 17 was refused), so no relevant record appeared.
- Off-key round 18 (https://www.rmg.co.uk/collections/objects): A read of the unfiltered collection root. It holds no watch or case record.
- Off-key round 19 (https://www.rmg.co.uk/collections/objects): The look on the collection root returned only repeated generic card labels. There was no object content.
- Off-key round 21 (https://www.rmg.co.uk/collections/objects/rmgc-object-542898): A record on the right site but the wrong subject: an early map of the British Isles. It can carry none of the watch or case facts.
- Off-key round 22 (https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+H4+ZAA0034+case+K1): Web search results page. Snippets can point to S1 or S2 but can't carry the catalogue fields.
- overrule round 6 → Acquisition without Progress: This is the second search in the loop of rounds 3, 6 and 9. It rewords round 3's query on a different results endpoint and brought nothing new.
- overrule round 9 → Acquisition without Progress: This is the third search in the loop of rounds 3, 6 and 9. It swaps the query parameter for the same intent, and rounds 12 and 13 show the listing stayed unfiltered.
- overrule round 19 → Acquisition without Progress: The look returned only a repeated generic label and no titles or IDs. It is effectively illegible, like round 8, which was labelled without progress.
- flag (round 3): Are rounds 3, 6 and 9 one Search Loop, or rounds 6 and 9 legitimate attempts to find a working search endpoint or parameter after round 3's page gave nothing usable?
- flag (round 22): Should round 22 also be counted without progress as the first member of the loop with round 23, or does the first search of a streak rightly keep its progress label?
- flag (round 5): Should search results and listing pages (rounds 3, 5, 6, 9, 12, 22) be Off-key when they can only point toward records, or are they a necessary step toward on-key pages?
- flag (round 14): Round 14 reached a wrong-subject record by accident through a type action. Should it be without progress rather than an Off-key progress round?
- flag (round 19): Is the overrule of round 19 right, or does a look returning repeated generic labels still count as a first observation with progress?
- flag: Should the secondary verdict be failed_rounds, given the three refusals plus three overlay blocks, or are those just part of the wasted-rounds pattern with no separate secondary?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:d13bc6cf…, $0.22

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects | 17973 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects | 9735 | every call was refused (type) |
| 3 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/search?Query=Harrison%20H4%20longitude%20watch | 2633 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 4 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/search?Query=Harrison+H4+longitude+watch | 2876 | type: the result reports no page movement |
| 5 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/search?Query=Harrison%20H4%20longitude%20watch | 6237 | read_page: the first read of this page state [off-key] |
| 6 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects?Query=Harrison+longitude+watch | 2470 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 7 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects?Query=Harrison+longitude+watch | 4581 | scroll: a scroll that answered End of Page |
| 8 | Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects?Query=Harrison+longitude+watch | 5982 | look: the Look returned nothing legible |
| 9 | Acquisition with Progress → Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects?Search=Harrison%20H4 | 5881 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 10 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects?Search=Harrison+H4 | 6682 | every call was refused (type) |
| 11 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects?Search=Harrison+H4 | 4528 | type: the app’s own no-progress Notice rode the result |
| 12 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects?Search=Harrison%20H4 | 4590 | click: the settled page state moved [off-key] |
| 13 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects?Search=Harrison+H4 | 7246 | scroll: the scroll brought new material into view [off-key] |
| 14 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/objects/rmgc-object-534260?_gl=1*1x73f9*_up*MQ… | 5529 | type: the settled page state moved [off-key] |
| 15 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects | 9150 | navigate: a navigate to a URL this Run already acquired |
| 16 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/objects | 1933 | type: a requested state change (text entered or an option selected) [off-key] |
| 17 | Failed round | click ✗ | https://www.rmg.co.uk/collections/objects | 1298 | every call was refused (click) |
| 18 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects | 6957 | read_page: the first read of this page state [off-key] |
| 19 | Acquisition with Progress → Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects | 5773 | look: the first Look at this page state with this question [off-key] |
| 20 | Acquisition without Progress | click | https://www.rmg.co.uk/collections/objects | 10017 | click: the result reports no page movement |
| 21 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-542898 | 4630 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 22 | Acquisition with Progress | navigate | https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+H4+ZAA0034+c… | 20033 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
| 23 | Acquisition without Progress | navigate | https://html.duckduckgo.com/html/?q=site%3Armg.co.uk+Harrison+%22H4%22+longitude… | 15710 | navigate: a search that rewords the one before it (streak 2) [search loop] |
| 24 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 5301 | navigate: the settled page state moved to a page this Run had not acquired |
| 25 | Finalization | — | — | 10002 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 14771 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier lookup; 11 of 12 Tool Rounds used; 12 orchestrator rounds, 1 in Finalization; Run duration 157870 ms; LLM stage 151440 ms over 12 joined round(s)
- grade useful_partial; checks not reached: fact-07 (1 of 14)
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted and 2 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 7 (64%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 4 (36%) · Failed round 0 (0%) · Finalization 1 (8%)
- **verdict: rounds wasted** — 4 of 11 budgeted rounds (36%, rounds 1–4) were Off-key: three 404 hits from guessed URLs and a search results page. Round 8 was a bookkeeping round whose two checkpoints were both rejected and had to be redone in rounds 9 and 11. Together that is 5 of 11 rounds (45%) that moved nothing forward. Only rounds 5–7 (27%) acquired the two sources the key relies on. The late start left the Run at the budget warning (3/12) by round 9. That pushed it straight into recording evidence and the Answer, with no room to work through the other removal option that fact-07 covers.
- stopped early: no — The Run used 11 of 12 Tool Rounds, so almost no budget was left. The one unreached check, fact-07, needed no more pages: it follows from the allowance on https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage (rounds 5–6) and the guitar rule on https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments (round 7), both already in hand. The gap is in how the Answer was written, not in a Run that quit acquiring with budget left.
- Off-key round 1 (https://www.eurostar.com/uk-en/travel-info/luggage): A 404 page ('Sorry, we can't find the page') on the right site. It can carry none of the required facts.
- Off-key round 2 (https://www.eurostar.com/uk-en/travel-info/luggage): A click on the same 404 page. The URL did not change and the title is still the not-found title, so the page has no allowance or instrument content.
- Off-key round 3 (https://www.eurostar.com/uk-en/travel-info/baggage-allowances): A second guessed URL that also returned the 404 title. It can carry no required fact.
- Off-key round 4 (https://duckduckgo.com/?q=Eurostar+luggage+allowance+musical+instruments+guitar+site%3Aeurostar.com&ia=web): A search results page. It is useful for finding a route to the sources, but it cannot itself carry the allowance or guitar rules that fact-02, fact-04 and fact-05 need.
- flag (round 2): The click in round 2 changed the page signature but not the URL or the 404 title, perhaps by dismissing a banner. Should it be relabelled acquisition_without_progress rather than left as progress?
- flag (round 4): The DuckDuckGo results page in round 4 is marked Off-key, yet it seems to be how the correct luggage URL used in round 5 was found. Should an enabling search page count as on-key?
- flag (round 8): Every call in round 8 was a rejected Evidence Checkpoint. Should it count as a failed round (every call refused) rather than bookkeeping with rejections counted beside it?
- flag: Is rounds_wasted the right primary verdict when the only missed check, fact-07, needed no extra acquisition? Would stopped_early fit, given that 1 round was left and the pages were already in hand, or is this purely an Answer-composition miss that no round verdict captures?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:b15d3a4e…, $0.15

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/luggage | 65642 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | click | https://www.eurostar.com/uk-en/travel-info/luggage | 5238 | click: the settled page state moved [off-key] |
| 3 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/baggage-allowances | 3295 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 4 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=Eurostar+luggage+allowance+musical+instruments+guitar+… | 3057 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 5 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7080 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4397 | read_page: the first read of this page state |
| 7 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 7180 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Bookkeeping | record_evidence, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 8281 | record_evidence, record_evidence — 2 rejected Evidence Checkpoint(s) [2 rejected checkpoint] |
| 9 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 7605 | record_evidence |
| 10 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4540 | record_evidence |
| 11 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 6111 | record_evidence |
| 12 | Finalization | — | — | 29014 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 6 of 12 Tool Rounds used; 7 orchestrator rounds, 1 in Finalization; Run duration 85663 ms; LLM stage 84389 ms over 7 joined round(s)
- grade pass; checks not reached: none
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted and 2 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 1 (17%) · Acquisition without Progress 1 (17%) · Collection 0 (0%) · Bookkeeping 4 (67%) · Failed round 0 (0%) · Finalization 1 (14%)
- **verdict: rounds wasted** — No verdict in the closed set fits a passing attempt well, and this is the closest. Only 1 of 6 budgeted rounds (1/6) made progress: round 2, the read of S1 https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage. Round 1 re-navigated to a page the initial attempt had already checkpointed. Of the 4 bookkeeping rounds (3-6), round 4's only call was a malformed record_candidate that was rejected, and round 5 had to redo it. Round 3 also had a rejected user-text checkpoint. The waste is small, cost no result (every check was reached), and left 6 of 12 rounds unspent.
- stopped early: no — The Run used 6 of 12 Tool Rounds and ended on objective_met with a pass grade and no checks unreached. With nothing left unreached, it did not stop early. It stopped because it was done.
- flag (round 1): Should round 1 stay acquisition_without_progress? The URL was inherited, but this Run needed the navigate to put S1 in front of the assistant before the round-2 read, so it could be called a necessary acquisition.
- flag (round 4): Round 4's only call (record_candidate) was rejected as malformed. Should it count as a failed round (every call refused) rather than bookkeeping with a rejected checkpoint counted beside it?
- flag: Is any verdict from the closed set right for an attempt that passed with half its budget unused? rounds_wasted is picked only as the least-bad fit, based on the modest share of rounds without progress or with rejected calls (1, 4).
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:18f86188…, $0.10

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 16607 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 8286 | read_page: the first read of this page state |
| 3 | Bookkeeping | record_evidence, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 16841 | record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 4 | Bookkeeping | record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 14634 | record_candidate — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 5 | Bookkeeping | record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 6589 | record_candidate |
| 6 | Bookkeeping | record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5600 | record_candidate |
| 7 | Finalization | — | — | 15832 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 19 of 24 Tool Rounds used; 20 orchestrator rounds, 1 in Finalization; Run duration 305283 ms; LLM stage 286996 ms over 20 joined round(s)
- grade pass; checks not reached: none
- 0 Subagent round(s) over 0 Subagent(s); 6 accepted and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 walled round(s)
- kinds: Acquisition with Progress 13 (68%) · Acquisition without Progress 3 (16%) · Collection 0 (0%) · Bookkeeping 3 (16%) · Failed round 0 (0%) · Finalization 1 (5%)
- **verdict: rounds wasted** — The attempt passed, so the waste cost no result; this is the closest verdict in the set. Of 19 budgeted rounds, 3 made no progress (16%): rounds 12 and 14 went back to URLs already acquired, and round 18 re-read a page already read. Another 4 were Off-key (21%): search pages in rounds 1 and 7, and 404s in rounds 5 and 6 from guessed URLs. That is about 37% of the budget, 7 of 19 rounds, spent on work that could carry no check. The productive on-key work (rounds 2-4, 8-11, 13, 15) plus bookkeeping in rounds 16, 17 and 19 was enough to cover every check.
- stopped early: no — The Run ended with objective_met, 19 of 24 rounds used and no checks left unreached. Every check was covered from S1 (rounds 3-4, 12-13) and S2 (rounds 10-11) plus the JPL copy of the September release (rounds 8-9, 14-15), so nothing reachable was left undone.
- Off-key round 1 (https://duckduckgo.com/?q=NASA+JPL+press+release+June+2013+Voyager+1+has+not+yet+left+the+heliosphere+magnetic+field+direction&ia=web): Search results page. It can point to sources but cannot itself carry any fact-NN check.
- Off-key round 5 (https://www.nasa.gov/mission_pages/voyager/voyager20130912.html): The title says Page Not Found. A 404 page carries none of the required facts.
- Off-key round 6 (https://www.jpl.nasa.gov/news/nasas-voyager-1-officially-enters-interstellar-space/): JPL 404 page for a guessed slug. It carries none of the required facts.
- Off-key round 7 (https://duckduckgo.com/?q=NASA+Voyager+1+officially+enters+interstellar+space+September+12+2013+press+release+jpl.nasa.gov&ia=web): Search results page. It can point to the September release but cannot itself carry fact-02, fact-05 through fact-08, or any other check.
- flag: The attempt passed with 5 rounds to spare and nothing unreached. Should it get a 'no shortfall' reading rather than rounds_wasted, given that none of the five verdicts describes a clean pass?
- flag (round 12): Round 12 returned to S1 so that round 13 could look for the displayed release date, which fact-01 needs. Should it count as a necessary step rather than Acquisition without Progress?
- flag (round 14): Round 14 returned to the JPL September release so that round 15 could read its displayed date (fact-02). Is it wasted, or a needed setup step?
- flag (round 2): Round 2 landed on a ScienceDaily copy of the June JPL release rather than the official page. It can carry the June facts, so it is not called Off-key, but is a secondary copy on-key under pitfall-05?
- flag (round 1): Search pages in rounds 1 and 7 are called Off-key, yet each led straight to the official sources. Should search pages that find the sources count as on-key?
- flag (round 16): Round 16 had one checkpoint rejected (its excerpt was not found in the retained S2 text), and round 18 then re-read the JPL page. Was round 18 a direct result of that rejection, and should it be judged as recovery rather than a plain repeat?
- reviewer claude-opus-5 at high, prompt audit-p1, digest sha256:0e9b2eac…, $0.18

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=NASA+JPL+press+release+June+2013+Voyager+1+has+not+yet… | 38097 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.sciencedaily.com/releases/2013/06/130627140803.htm | 10462 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 2919 | navigate: the settled page state moved to a page this Run had not acquired |
| 4 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 4307 | read_page: the first read of this page state |
| 5 | Acquisition with Progress | navigate | https://www.nasa.gov/mission_pages/voyager/voyager20130912.html | 9528 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 6 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-officially-enters-interstellar-spa… | 2966 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=NASA+Voyager+1+officially+enters+interstellar+space+Se… | 1421 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 8 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 4788 | navigate: the settled page state moved to a page this Run had not acquired |
| 9 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 1537 | read_page: the first read of this page state |
| 10 | Acquisition with Progress | navigate | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 18717 | navigate: the settled page state moved to a page this Run had not acquired |
| 11 | Acquisition with Progress | read_page | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 2487 | read_page: the first read of this page state |
| 12 | Acquisition without Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 9006 | navigate: a navigate to a URL this Run already acquired |
| 13 | Acquisition with Progress | look | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 10150 | look: the first Look at this page state with this question |
| 14 | Acquisition without Progress | navigate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 3134 | navigate: a navigate to a URL this Run already acquired |
| 15 | Acquisition with Progress | look | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 1622 | look: the first Look at this page state with this question |
| 16 | Bookkeeping | record_evidence, record_evidence, record_evidence, record_evidence, record_evidence | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 30839 | record_evidence, record_evidence, record_evidence, record_evidence, record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 17 | Bookkeeping | record_evidence | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 9951 | record_evidence |
| 18 | Acquisition without Progress | read_page | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 27222 | read_page: a repeat read of a page state already read |
| 19 | Bookkeeping | record_evidence | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 30977 | record_evidence |
| 20 | Finalization | — | — | 66866 | the reserved Answer |

