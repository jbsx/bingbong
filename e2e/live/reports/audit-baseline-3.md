# Round Audit — bingbong.live-web.information-hunts (baseline-3)

Generated 2026-09-14T13:00:07.665Z from a capture set created 2026-09-12T18:57:29.347Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 59bdf48b (dirty tree); mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p2; audit run at commit be1e592a

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 71 | 64 | 63 | 2 | 38 (59%) → 31 | 10 (16%) → 17 | 1 (2%) | 8 (13%) | 7 (11%) | 7 (10%) |
| follow_up | 2 | 2 | 40 | 36 | 36 | 2 | 23 (64%) → 20 | 4 (11%) → 7 | 1 (3%) | 5 (14%) | 3 (8%) | 4 (10%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 1 | 1 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 1 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 1 | 1 | 0 |
| failed rounds | 1 | 0 | 0 | 0 |

- initial: 17 Off-key round(s), 5 Search Loop round(s) by the reviewer (3 by the streak rule; attempts by search source rail 0, replay 2, none 2), 0 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 0 stopped early, 3 answer omitted, 7 overrule(s), 18 flag(s); Finalization Causes: budget_exhausted 2, deadline_reached 1, objective_met 1
- follow_up: 1 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule; attempts by search source rail 0, replay 0, none 2), 2 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 0 stopped early, 1 answer omitted, 3 overrule(s), 10 flag(s); Finalization Causes: budget_exhausted 2

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
- grade useful_partial; checks unsatisfied: fact-05, fact-06 (2 of 10)
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 4 accepted (0 merged, a floor) and 3 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- kinds: Acquisition with Progress 15 (63%) · Acquisition without Progress 3 (13%) · Collection 1 (4%) · Bookkeeping 5 (21%) · Failed round 0 (0%) · Finalization 2 (8%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: answer omitted** — fact-05 and fact-06 both rest on camera_software.html. The Run read that page in rounds 4-11 and 16-18 and recorded Evidence from it in rounds 13, 14 and 19, yet the Answer (round 26) did not state either check. Eight of ten checks were satisfied, so what was lost was on material the Run already held.
- secondary: rounds wasted — 7 of 24 budgeted rounds (about 29%) made no progress: round 1 (404), rounds 7-10 (scrolling back and forth over positions already seen on camera_software.html) and re-navigations in rounds 16 and 20. Two more bookkeeping rounds were spent entirely on rejected checkpoints (rounds 12 and 24). Those rounds could have gone further down camera_software.html, and the budget ran out before they did.
- stopped early: no — The attempt ran to its budget (24 of 24 Tool Rounds, ended budget_exhausted), so it did not stop early.
- answer omitted: yes (fact-05, fact-06) — Both unsatisfied checks are carried by https://www.raspberrypi.com/documentation/computers/camera_software.html. The Run navigated to that page in round 4, scrolled it through round 18 and recorded Evidence from it in rounds 13, 14 and 19, including its legacy-stack passage and its rpicam naming. The Answer still left fact-05 and fact-06 unstated.
- Off-key round 1 (https://www.raspberrypi.com/documentation/computers/camera.html): Not-found Page: a 404 on the right site carries no content, so it can carry no required fact.
- overrule round 7 → Acquisition without Progress: Scroll back up to y=277 on camera_software.html, a position already seen in round 5. It re-observes a state the Run already had.
- overrule round 8 → Acquisition without Progress: Scroll up to y=0 on camera_software.html shows the page top already acquired by the navigate in round 4.
- overrule round 9 → Acquisition without Progress: Scroll down to y=277 with the same new-in-view links (High Quality Camera, Global Shutter Camera) as round 5. It is a repeat observation.
- overrule round 10 → Acquisition without Progress: Scroll down to y=554 with the same new-in-view material (on GitHub link, rpicam-apps Bookworm text) as round 6. It is a repeat observation.
- flag (round 16): The navigate to the #autofocus anchor was followed by a scroll to y=1108, which suggests the autofocus-on-capture part of camera_software.html may never have been in view. Should fact-06 count as needing unread material rather than as omitted from a page the Run had read?
- flag (round 7): Rounds 7-10 are overruled to without-progress because they revisit scroll offsets already observed. Did any of them expose text the earlier views had not shown?
- flag (round 21): The scroll to y=277 on accessories/camera.html after the anchored navigate in round 20 showed different new-in-view links than round 3 at the same offset. Is it truly new progress, or a repeat of round 3's state?
- flag (round 12): Every call in round 12 was a rejected Evidence Checkpoint. Should the round count as a failed round (every call refused) rather than bookkeeping?
- flag: Is answer_omitted or rounds_wasted the more decisive primary, given the budget ran out partly because of repeat scrolling?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:b34785a2…, $0.20

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 82344 | navigate: landed on a Not-found Page [not found, off-key] |
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
- grade useful_partial; checks unsatisfied: fact-02 (1 of 6)
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 5 accepted (0 merged, a floor) and 3 rejected Evidence Checkpoint(s); 1 inherited round(s); 1 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 14 (58%) · Acquisition without Progress 3 (13%) · Collection 1 (4%) · Bookkeeping 5 (21%) · Failed round 1 (4%) · Finalization 2 (8%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: rounds wasted** — Of the 24 budgeted rounds, rounds 2–11 (10 rounds) went to the Camera Module 3 product page and two news posts. Rounds 3, 6 and 10 made no progress, and round 7 landed on an off-key photo showcase. The verified mechanical source was not reached until round 12, and rounds 13 (illegible Look) and 14 (refused call) produced nothing there. Two more rounds (21–22) were malformed record_candidate calls, and rounds 21–24 (4 rounds) all went to candidate bookkeeping. Without that spend, the scrolls of camera.html that stopped at round 18 could have reached the section that carries fact-02.
- secondary: tier too small or never escalated — The camera.html work in rounds 15–18 was on-key and bringing in new material when the investigation-tier budget of 24 ran out (the budget warning came at round 18). There was no Tier Escalation.
- stopped early: no — The attempt used all 24 of its 24 Tool Rounds and ended with budget_exhausted, so it did not stop early.
- answer omitted: no — fact-02 sits in the mechanical part of https://www.raspberrypi.com/documentation/accessories/camera.html. This Run got there in round 12, but its round-13 Look came back illegible, round 14 was refused, and the scrolls in rounds 15–18 only reached the installation text near y=1108. The digest shows no read of that section. The Zero Case product page read in round 1 gives the incompatibility but, from the recorded excerpts, not the reason fact-02 needs. So the missing check needed material the Run had not read, not material it read and left out.
- Off-key round 7 (https://www.raspberrypi.com/news/camera-module-3-show-off-your-shots/): The navigate to the news slug redirected to a community photo-showcase post. It is about sample shots, not the case lid or the module's mechanical layout, so it cannot carry fact-01, fact-02 or fact-03.
- overrule round 6 → Acquisition without Progress: The ground_visual only returned a vision ref on the Camera Module 3 page that rounds 4–5 had already read. The app's own notice in the same result says two consecutive actions made no progress, and nothing new came in.
- overrule round 10 → Acquisition without Progress: The Look on https://www.raspberrypi.com/news/new-autofocus-camera-modules returned only the article title, which the navigate in round 8 had already shown. It added no material.
- flag (round 12): Round 12 was an inherited re-acquisition of camera.html, which the initial attempt had already checkpointed. If that earlier read covered the mechanical section, should fact-02 count as material already read, making answerOmitted true?
- flag (round 8): Is the launch post https://www.raspberrypi.com/news/new-autofocus-camera-modules/ (rounds 8–11) off-key, or could a launch announcement plausibly carry the mechanical comparison with Module 2?
- flag (round 2): Should the Camera Module 3 product page (rounds 2–6) count as off-key for this follow-up? Its on-key value is only for fact-03, which the initial attempt had already established.
- flag (round 19): The Subagent a-2 report may have covered camera.html's mechanical section. Could that have been material the Run had read, even though the digest shows only a forum thread and the Zero Case page being recorded?
- flag: Should the primary verdict be tier_too_small_or_never_escalated instead of rounds_wasted, given that the on-key scrolls of the verified source were still progressing when the budget ended?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:ac85a22c…, $0.21

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
- grade useful_partial; checks unsatisfied: fact-03, fact-05, fact-08, fact-10, fact-11 (5 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 12 (50%) · Acquisition without Progress 6 (25%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 6 (25%) · Finalization 2 (8%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: rounds wasted** — Of the 24 budgeted rounds, 6 were failed rounds (2, 5, 7, 12, 20, 22), mostly misfired refusals and repeated look calls. Another 6 were without progress (3, 6, 9, 10, 19, 21), and my overrules add 13, 14 and 24. Rounds 1 to 16 went to generic listings, search pages and a search loop (8, 9, 10, 13, 15) before the record was reached in round 17. Only rounds 17 and 23 did productive on-key work. The case record was never reached because the budget was spent on this waste, not on on-key work.
- secondary: answer omitted — fact-03 and fact-05 are on the watch record the Run read in round 23, but the Answer did not state them.
- stopped early: no — The attempt used all 24 of its 24 Tool Rounds and ended on budget exhaustion, so it did not stop early. The case record, which was never read, is a matter of budget and wasted rounds, not an early stop.
- answer omitted: yes (fact-03, fact-05) — The Run read the watch record https://www.rmg.co.uk/collections/objects/rmgc-object-79142 in full with read_page in round 23, and the Answer took other fields from that same record. fact-03 and fact-05 are carried on that page but the Answer does not state them. fact-08, fact-10 and fact-11 belong to the case record, rmgc-object-256323, which the Run never opened, so they are not omissions.
- Search Loop over rounds 8, 9, 10, 13, 15: Every one of these rounds rewords the same aim: find the Harrison watch record by keyword, on Bing, in the RMG search box and on the RMG object listing. The app marked only 8 to 10 as a streak. I extended the loop to the timekeeper rewording typed in round 13 and the bare quoted-name query in round 15, because the only rounds between them were scrolls and a refusal, and the listing they returned was unchanged. Round 16 moved to a query that asked for an identifier and brought up the record's URL, so I left it outside the loop.
- Off-key round 1 (https://www.rmg.co.uk/collections/objects): This is the generic collection results listing, not an object record, so it could carry none of the required fields.
- Off-key round 3 (https://www.rmg.co.uk/collections/objects): Same generic listing, and the typing was blocked by an overlay.
- Off-key round 4 (https://www.rmg.co.uk/collections/objects): Same generic listing. Only the page signature changed; no object record opened.
- Off-key round 6 (https://www.rmg.co.uk/collections/objects): Same generic listing, and the typed query was not submitted.
- Off-key round 8 (https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+longitude+watch): A search engine results page. It can point to records but does not carry catalogue fields.
- Off-key round 9 (https://www.rmg.co.uk/collections/search?q=Harrison+longitude+watch): The site's own search results page, not an object record.
- Off-key round 10 (https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch): A listing page that ignored the query and showed unrelated objects.
- Off-key round 11 (https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch): The scroll showed unrelated objects on the listing (a hull model, a house flag).
- Off-key round 13 (https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch): Same listing of unrelated objects. The text was typed into the box but no record came up.
- Off-key round 14 (https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch): The scroll showed the same unrelated objects as round 11.
- Off-key round 15 (https://www.rmg.co.uk/collections/object?q=%22Harrison%22&filter=date): Another results listing, not an object record.
- Off-key round 16 (https://duckduckgo.com/?q=rmg.co.uk+collections+Harrison+H4+longitude+timekeeper+rmgc-object&ia=web): A search engine results page. It led to the record in round 17 but carries no catalogue fields itself.
- overrule round 13 → Acquisition without Progress: The URL stayed the same, and the scroll in round 14 showed the same unrelated listing items as round 11. Typing text that was never submitted brought in nothing new.
- overrule round 14 → Acquisition without Progress: The items that scrolled into view repeat what round 11 had already observed on the same listing.
- overrule round 24 → Acquisition without Progress: Adding ?page=2 to the record URL loads the same H4 record that rounds 17 to 23 had already read, so this navigate is effectively a repeat.
- flag (round 13): Should the timekeeper rewording in round 13 and the bare quoted-name query in round 15 count as members of the 8–10 search loop, or as separate searches?
- flag (round 16): Should the DuckDuckGo query in round 16 also join the search loop, given it still hunts the same record, even though it produced the lead that was followed?
- flag (round 1): Is the RMG collection landing listing in round 1 really off-key, given it is the right site and a reasonable entry point to the record?
- flag (round 24): Is the ?page=2 variant of the watch record in round 24 really a repeat of the page already read, or could it have shown additional content such as a linked-parts pagination?
- flag (round 14): Is round 14 correctly overruled to without progress, given the scroll offset differed slightly from round 11 even though the items shown were the same?
- flag: Should failed_rounds be the secondary verdict instead of answer_omitted, since the 6 refusals were a quarter of the budget?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:5c4676e8…, $0.21

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects | 41903 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects | 3128 | every call was refused (type) |
| 3 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects | 4115 | type: the app’s own no-progress Notice rode the result [off-key] |
| 4 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects | 4134 | click: the settled page state moved [off-key] |
| 5 | Failed round | type ✗ | https://www.rmg.co.uk/collections/objects | 1366 | every call was refused (type) |
| 6 | Acquisition without Progress | type | https://www.rmg.co.uk/collections/objects | 2619 | type: the app’s own no-progress Notice rode the result [off-key] |
| 7 | Failed round | click ✗ | https://www.rmg.co.uk/collections/objects | 1360 | every call was refused (click) |
| 8 | Acquisition with Progress | navigate | https://www.bing.com/search?q=site%3Armg.co.uk+collections+Harrison+longitude+wa… | 6767 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 9 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/search?q=Harrison+longitude+watch | 6525 | navigate: a search that rewords the one before it (streak 2) [off-key, search loop] |
| 10 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 5623 | navigate: a search that rewords the one before it (streak 3) [off-key, search loop] |
| 11 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 6719 | scroll: the scroll brought new material into view [off-key] |
| 12 | Failed round | type ✗ | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 9389 | every call was refused (type) |
| 13 | Acquisition with Progress → Acquisition without Progress | type | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 1961 | type: a requested state change (text entered or an option selected) [off-key, search loop] |
| 14 | Acquisition with Progress → Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/object?q=Harrison+longitude+watch | 3584 | scroll: the scroll brought new material into view [off-key] |
| 15 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/object?q=%22Harrison%22&filter=date | 1478 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop] |
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
- grade useful_partial; checks unsatisfied: fact-07 (1 of 14)
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 11 (73%) · Acquisition without Progress 1 (7%) · Collection 0 (0%) · Bookkeeping 3 (20%) · Failed round 0 (0%) · Finalization 1 (6%)
- search source replay: the streak rule re-run over navigate searches
- **verdict: answer omitted** — 13 of 14 checks passed. The one miss, fact-07, could have been worked out from the S1 and S2 pages the Run read in rounds 2 and 4 and recorded in rounds 6 and 7. Acquisition work was mostly on-key: 11 rounds with Progress against 1 without, and 4 off-key rounds (1, 11, 13, 14). The Run finished with 9 Tool Rounds left, so neither budget nor wasted rounds explains the gap. It came from what the Answer left out.
- stopped early: no — The Run stopped with budget left (15 of 24 Tool Rounds), but its only unsatisfied check did not need an unread page. Both pages the check depends on had already been read, in rounds 2 and 4.
- answer omitted: yes (fact-07) — fact-07 follows from two pages the Run read and recorded as Evidence in rounds 6, 7 and 10: the allowance count on https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage (round 2) and the guitar-counts-within-the-allowance rule on https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments (round 4). The Answer did not state the alternative removal.
- Off-key round 1 (https://duckduckgo.com/?q=Eurostar+luggage+allowance+musical+instruments+official+site+eurostar.com&ia=web): This is a search results page. It points to the official pages but does not itself carry any required fact.
- Off-key round 11 (https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-with-me): The guessed FAQ URL landed on the Help Centre home page (title 'Home | Eurostar Help Centre'). The site is right but the subject is wrong: it is a generic landing page with no instrument or allowance rule on it.
- Off-key round 13 (https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-with-me): This read the same Help Centre home page that round 11 had landed on. It is a generic landing page and cannot carry any of the key's facts.
- Off-key round 14 (https://duckduckgo.com/?q=site%3Ahelp.eurostar.com+musical+instrument+Eurostar+luggage+allowance+guitar&ia=web): This is a search results page used to find the right FAQ URL. It carries no required fact itself.
- flag (round 13): Should round 13 be Acquisition without Progress? It read the same Help Centre home page that round 11's navigate had already put in front of the assistant, so it may not count as a first read.
- flag (round 12): Should round 12 count as a Failed round rather than Acquisition without Progress? Its only call (type) was blocked by an overlay, which is close to a refused call.
- flag (round 1): Are search results pages (rounds 1 and 14) Off-key? They cannot carry facts themselves, but they led straight to the on-key official pages.
- flag (round 8): Is the Help Centre luggage category listing at https://help.eurostar.com/faq/uk-en/category/luggage on-key? It is an index page on an equivalent official source and may itself state no allowance rule.
- flag: Should fact-07 count as omitted rather than as a check that needed more research? It is a counting result, not a quoted rule, and depends on the Answer combining two rules the Run had read.
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:3d77a34f…, $0.16

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
| 12 | Acquisition without Progress | type | https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-wit… | 2985 | type: the result reports no page movement |
| 13 | Acquisition with Progress | read_page | https://help.eurostar.com/faq/uk-en/question/Can-I-take-a-musical-instrument-wit… | 1895 | read_page: the first read of this page state [off-key] |
| 14 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=site%3Ahelp.eurostar.com+musical+instrument+Eurostar+l… | 3062 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 15 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/Can-I-take-my-musical-instrument-on… | 2227 | navigate: the settled page state moved to a page this Run had not acquired |
| 16 | Finalization | — | — | 65137 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / partial (budget_exhausted); tier lookup; 12 of 12 Tool Rounds used; 14 orchestrator rounds, 2 in Finalization; Run duration 119619 ms; LLM stage 116385 ms over 14 joined round(s)
- grade useful_partial; checks unsatisfied: fact-01, fact-02, fact-03 (3 of 6)
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 9 (75%) · Acquisition without Progress 1 (8%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 2 (17%) · Finalization 2 (14%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: answer omitted** — The material for fact-01, fact-02 and fact-03 was on a page the Run had read: the S1 luggage page, read fully in round 12 and checkpointed in round 13. Even so, the Answer left all three unsatisfied (3 of 6 checks). This was not a problem of reaching the source: 12 of 12 rounds stayed on-key on that single page.
- secondary: rounds wasted — 4 of the 12 budgeted rounds made no progress: round 1 re-navigated to the inherited page, rounds 8 and 10 were refused look calls (round 10 repeated a check that had already failed), and round 11 scrolled back to a state already seen. The 7 progress rounds before the read (2–7 and 9) each moved one screen down a page that a single read_page call (finally made in round 12) would have covered. Only 1 round was left once the page was read, so the class labels in the table stayed unconfirmed.
- stopped early: no — The attempt used all 12 of its 12 Tool Rounds and ended on budget_exhausted, so it did not stop early. No unsatisfied check needed a page the Run had not read either.
- answer omitted: yes (fact-01, fact-02, fact-03) — Every acquisition round was on https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, the key's verified source for this follow-up. Rounds 6 and 11 put its class-by-class counts in view, round 12 read the full page text, and round 13 recorded that table as accepted Evidence. fact-01 and fact-02 follow from that page. fact-03 follows from the same material together with the guitar and route rules the initial attempt had already read and checkpointed. The Grade finds none of the three carried by the Answer.
- overrule round 11 → Acquisition without Progress: The upward scroll went back to y=1662, the scroll position round 7 had already shown, and its 'new in view' text is the class-table heading and counts that rounds 5–6 had already put in view. It repeated an observed state and brought nothing new.
- flag (round 11): Should round 11 stay acquisition_with_progress, since the tool reported new material in view? It returned to round 7's position, but earlier scrolls may not have shown every line.
- flag (round 1): Round 1 re-navigated to the inherited page, which the follow-up had to load before it could read anything. Is acquisition_without_progress too harsh for that round?
- flag (round 12): The round 13 Evidence says the table's class labels were missing from the text digest. Does S1 as read in round 12 carry fact-02 outright, or only by elimination? Would that change fact-01 and fact-02 from answer omission to a problem of reading?
- flag: fact-03 depends on the guitar exception, which lives on the musical-instruments page the initial attempt read, not on any page this follow-up opened. Does inherited reading count as a page the Run had read?
- flag: Is rounds_wasted the more decisive primary verdict? The page was never fully read until the last budgeted round (12) because of piecemeal scrolling and 2 refused rounds.
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:7a149f97…, $0.15

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
- grade useful_partial; checks unsatisfied: fact-06, pitfall-01 (2 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 walled round(s)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- kinds: Acquisition with Progress 0 (0%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 1 (100%) · Finalization 2 (67%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- **verdict: failed rounds** — The only budgeted round, round 1, timed out: 1 of 1 budgeted rounds (100%) failed. It took 330002 ms, about 90% of the Run's time, before any tool call returned. The deadline then forced Finalization: round 2 was cut by the allowance and round 3 was the reserved Answer. No page was acquired, so the Answer could not rest on the two official accounts. That lost fact-06 and pitfall-01.
- stopped early: no — The Run did not end with time left. It ended on deadline_reached after round 1 timed out at 330002 ms of a 368440 ms Run. It used 0 of its 24 Tool Rounds, but the deadline, not a choice to stop, ended acquisition. Both unsatisfied checks, fact-06 and pitfall-01, needed pages the Run never read, and with no time left that is not an early stop.
- answer omitted: no — The Run read no page at all: 0 Tool Rounds, 0 tool results in any request, and no Evidence. So neither fact-06 nor pitfall-01 can follow from material on a page the Run had read.
- flag (round 1): The Run had 24 Tool Rounds unused but no time left after the round 1 timeout. Is it right to treat this as a timeout failure rather than an early stop?
- flag: pitfall-01 depends on answering without the two accounts. Should it be counted as lost to the failed round, and not as something the Answer could have avoided by declining to give dates from memory?
- reviewer claude-opus-5 at high, prompt audit-p2, digest sha256:f12fde13…, $0.07

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Failed round | — | — | 330002 | the client’s request timeout ended the round |
| 2 | Finalization | — | — | 10001 | a Finalization round cut by the Finalization Allowance |
| 3 | Finalization | — | — | 28427 | the reserved Answer |

