# Round Audit — bingbong.live-web.information-hunts (baseline3-3)

Generated 2026-09-21T23:29:39.564Z from a capture set created 2026-09-21T23:15:05.370Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 4096bddb; mode measured; protocol 1; prompt version(s) 1
- routing: orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | effort overrides: none | adblock: production_default | browser sub-spans: on
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p3; audit run at commit 61a553d8

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 86 | 80 | 79 | 3 | 50 (63%) → 48 | 12 (15%) → 14 | 1 (1%) | 10 (13%) | 7 (9%) | 6 (7%) |
| follow_up | 2 | 2 | 15 | 13 | 12 | 0 | 2 (15%) → 3 | 4 (31%) → 3 | 0 (0%) | 5 (39%) | 2 (15%) | 2 (13%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 2 | 1 | 2 | 0 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 0 | 0 |
| answer omitted | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 1 | 0 | 0 |

- initial: 31 Off-key round(s), 3 Search Loop round(s) by the reviewer (3 by the streak rule, heads included: 2 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 4, replay 0, none 0; navigate searches by Search URL form q 5, param 0, path 3; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 2 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 0 inherited, 3 rejected Evidence Checkpoint(s), 0 walled round(s), 1 navigate(s) landed on a Not-found Page (1 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 13 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 3 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 1 skipped bookkeeping round(s), 1 Finalization round(s) cut by the Allowance (1 after a first token, 0 silent); first-token latency p50 2400 ms, p90 5017 ms over 86 round(s), 4 declared Asked Items (3 with an unverified standing, 3 shape failure(s), 1 retried), 0 stopped early, 3 answer omitted, 2 overrule(s), 14 flag(s); Finalization Causes: budget_exhausted 3, objective_met 1
- follow_up: 0 Off-key round(s), 0 Search Loop round(s) by the reviewer (0 by the streak rule, heads included: 0 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 0, replay 0, none 2; navigate searches by Search URL form q 0, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent), 3 inherited, 0 rejected Evidence Checkpoint(s), 0 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 1 Held Page round(s) without Progress, 1 bundled checkpoint round(s), 0 same-source unsupported round(s), 0 Answer(s) with an Identity Slip, 0 id(s) slipped, 0 Malformed Answer(s) (1 retried), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4716 ms, p90 5199 ms over 15 round(s), 2 declared Asked Items (0 with an unverified standing, 1 shape failure(s), 1 retried), 0 stopped early, 0 answer omitted, 1 overrule(s), 6 flag(s); Finalization Causes: objective_met 2

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 26 (33%) | 3 (25%) |
| read_page | 19 (24%) | 4 (33%) |
| scroll | 17 (22%) | 0 |
| record_evidence | 10 (13%) | 4 (33%) |
| record_candidate | 4 (5%) | 3 (25%) |
| report_run_plan | 4 (5%) | 2 (17%) |
| look | 4 (5%) | 0 |
| agent_results | 1 (1%) | 0 |
| spawn_agent | 1 (1%) | 0 |
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

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 25 orchestrator rounds, 1 in Finalization; Run duration 189475 ms; LLM stage 145954 ms over 25 joined round(s)
- grade pass; checks unsatisfied: none
- 13 Subagent round(s) over 1 Subagent(s), stopped by budget_exhausted 1; 7 accepted (0 merged, a floor) and 3 rejected Evidence Checkpoint(s); 0 inherited round(s); 3 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 1 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 4 declared; Answer standings 0 stated, 4 unverified; 1 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 8 (33%) · Acquisition without Progress 7 (29%) · Collection 1 (4%) · Bookkeeping 8 (33%) · Failed round 0 (0%) · Finalization 1 (4%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — The attempt passed but used all 24 of its 24 rounds. 7 of 24 were Acquisition without Progress: round 1 (a 404), rounds 10 and 12 (anchor navigates on camera_software.html, a page already acquired), and repeat reads in rounds 6, 14, 15 and 16. 8 of 24 were Bookkeeping, and rounds 20, 21 and 22 resubmitted the same subagent excerpt and were rejected three times before round 23 was accepted. Round 2 was an Off-key search results page. Only 8 of 24 rounds made progress. The key sources S2 and S3 were reached by round 7, so most of the remaining budget went to repeats and rejected checkpoints rather than new material.
- stopped early: no — The Grade is a pass with no unsatisfied checks, and the attempt ran its full 24-round budget.
- answer omitted: no — The Grade is a pass with no unsatisfied checks, so no check was left out of the Answer.
- Off-key round 1 (https://www.raspberrypi.com/documentation/computers/camera.html): The navigate landed on a Not-found Page, so there was no content that could carry any required fact.
- Off-key round 2 (https://duckduckgo.com/?q=raspberry+pi+documentation+camera+rpicam-apps+camera+module+3&ia=web): This is a search results page. It lists links but carries none of the required facts itself, and no result was opened from it: the Run went straight to a guessed documentation URL in round 3.
- flag (round 14): Rounds 14, 15 and 16 read parts 5, 6 and 7 of camera_software.html#autofocus-mode. The page signature did not change, but the request grew by about 13k characters each round, and round 17 then recorded autofocus evidence. Were these rounds really bringing in new chunks of text, and so Acquisition with Progress rather than repeat reads?
- flag (round 6): Round 6 read part 2 of accessories/camera.html and was labelled a repeat because the signature matched round 5. If part 2 returned text not seen before, should this round count as progress?
- flag (round 10): Round 10 navigated to the #rpicam-still anchor, which moved the viewport to a new scroll position on a page already acquired. Is Acquisition without Progress the right label, or did the move open new ground for the read in round 11?
- flag: The attempt passed and every check was satisfied. Is rounds_wasted a fair primary verdict for an attempt whose only cost was an exhausted budget and no lost result?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:4a7c0dc9…, $0.18

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/computers/camera.html | 15400 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=raspberry+pi+documentation+camera+rpicam-apps+camera+m… | 5000 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 3 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 7069 | navigate: the settled page state moved to a page this Run had not acquired |
| 4 | Acquisition with Progress | spawn_agent | https://www.raspberrypi.com/documentation/accessories/camera.html | 9606 | spawn_agent: delegated a Subagent |
| 5 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 4568 | read_page: the first read of this page state |
| 6 | Acquisition without Progress | record_evidence, read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 6419 | read_page: a repeat read of a page state already read |
| 7 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 9958 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3842 | read_page: the first read of this page state |
| 9 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5316 | record_evidence |
| 10 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html#rpicam-… | 2089 | navigate: a navigate to a URL this Run already acquired |
| 11 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#rpicam-… | 4086 | read_page: the first read of this page state |
| 12 | Acquisition without Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 4989 | navigate: a navigate to a URL this Run already acquired |
| 13 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 4043 | read_page: the first read of this page state |
| 14 | Acquisition without Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 7319 | read_page: a repeat read of a page state already read |
| 15 | Acquisition without Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 3244 | read_page: a repeat read of a page state already read |
| 16 | Acquisition without Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html#autofoc… | 1573 | read_page: a repeat read of a page state already read |
| 17 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5324 | record_evidence |
| 18 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 2851 | record_candidate |
| 19 | Collection | agent_results | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1454 | read a finished Subagent Report |
| 20 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3812 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 21 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 6290 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 22 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3862 | record_evidence — 1 rejected Evidence Checkpoint(s) [1 rejected checkpoint] |
| 23 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 10317 | record_evidence |
| 24 | Bookkeeping | record_candidate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 3028 | record_candidate |
| 25 | Finalization | — | — | 14495 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 5 of 12 Tool Rounds used; 6 orchestrator rounds, 1 in Finalization; Run duration 162950 ms; LLM stage 161988 ms over 6 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 1 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; Answer standings 3 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (20%) · Acquisition without Progress 2 (40%) · Collection 0 (0%) · Bookkeeping 2 (40%) · Failed round 0 (0%) · Finalization 1 (17%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — This is the closest label in the closed set, and the loss was small. The attempt passed using 5 of 12 Tool Rounds. Code marked 2 of the 5 as without Progress: round 1 re-navigated to the inherited page, and round 3 is overruled here. That leaves at most 1 of 5 rounds (20%) that brought in nothing new. There were no loops, no Off-key pages and no failed rounds. Every acquisition was on the verified source https://www.raspberrypi.com/documentation/accessories/camera.html, and the rest was bookkeeping (rounds 4–5). Nothing cost the result.
- stopped early: no — The attempt was graded pass with no unsatisfied checks, so no check needed a page the Run had not read.
- answer omitted: no — No checks are unsatisfied, so the Answer left nothing out that a page the Run had read would carry.
- overrule round 3 → Acquisition with Progress: read_page with part 3 read a different part of https://www.raspberrypi.com/documentation/accessories/camera.html than round 2's part 2. The page signature is unchanged, but the request grew from 12570 to 25471 chars, which shows new material came in. That material plausibly holds the mechanical note checkpointed in round 4.
- flag (round 3): Should round 3 (read_page part 3 with the same page signature as round 2) count as a repeat read, as code labelled it? Or should it count as new material, as this review overrules?
- flag (round 1): Round 1 re-navigated to a page the initial attempt had already checkpointed. Was that a necessary step to reach the mechanical section, and therefore not waste?
- flag: The attempt passed efficiently and no verdict in the closed set fits it well. Is rounds_wasted, resting on at most one non-progress round, an appropriate primary?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:ea5d6292…, $0.10

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 9459 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 6093 | read_page: the first read of this page state |
| 3 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 4562 | read_page: a repeat read of a page state already read |
| 4 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 45498 | record_evidence, record_evidence |
| 5 | Bookkeeping | record_candidate, record_candidate | https://www.raspberrypi.com/documentation/accessories/camera.html | 59128 | record_candidate, record_candidate |
| 6 | Finalization | — | — | 37248 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / partial (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 132158 ms; LLM stage 109245 ms over 26 joined round(s)
- grade useful_partial; checks unsatisfied: fact-08, fact-11 (2 of 17)
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 8 declared; Answer standings 0 stated, 8 unverified; 1 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 19 (79%) · Acquisition without Progress 4 (17%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 1 (4%) · Finalization 2 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 0, param 0, path 3
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- **verdict: answer omitted** — 15 of 17 checks were satisfied. The two that failed (fact-08, fact-11) are both carried on the case page the Run read in rounds 19–24 (https://www.rmg.co.uk/collections/objects/rmgc-object-256323). The Answer did not state them, so the decisive loss was omitting material the Run already had.
- secondary: rounds wasted — 12 of 24 budgeted rounds (1–12) went to search listings, the search loop in rounds 2–4 and the off-key minute-hand-washer record in round 9. Rounds 14 (refused read), 17 and 24 (End of Page) added nothing. That left only rounds 13–24 for the two pages that carried the key, and the case page came up with 6 rounds left, just after the warning in round 18.
- stopped early: no — The attempt used all 24 of its 24 Tool Rounds and ended because the budget ran out, so it did not stop early.
- answer omitted: yes (fact-08, fact-11) — Both unsatisfied checks come from the case record at https://www.rmg.co.uk/collections/objects/rmgc-object-256323. The Run opened that page in round 19, read it in round 20 and scrolled it to the end in rounds 21–24. The recorded Evidence kept only the structured fields, and the Answer left both matters unstated.
- Search Loop over rounds 2, 3, 4: Three searches in a row on the RMG collection search (typed 'Harrison', then URL searches for 'Harrison H5' and '"Harrison No. 2"') with no result opened between them. The read and scrolls in rounds 5–8 happened on the last results page and do not break the loop. Round 9 opens a result, which ends it.
- Off-key round 1 (https://www.rmg.co.uk/collections/objects): The collection's landing and results page. It is a general entry point, not an object record, so it can carry none of the required facts.
- Off-key round 2 (https://www.rmg.co.uk/collections/objects/search/Harrison): A search results page. It lists object titles only and carries no catalogue fields.
- Off-key round 3 (https://www.rmg.co.uk/collections/objects/search/Harrison%20H5): A search results page, and its query points at the wrong object.
- Off-key round 4 (https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22): A search results page, and its query points at the wrong object.
- Off-key round 5 (https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22): This reads the same off-target results listing. Its entries are unrelated objects (a workbook, a medal, and so on).
- Off-key round 6 (https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22): This scrolls through the same off-target results listing.
- Off-key round 7 (https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22): This scrolls through the same off-target results listing.
- Off-key round 8 (https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22): This scrolls through the same off-target results listing.
- Off-key round 9 (https://www.rmg.co.uk/collections/objects/rmgc-object-1100790): Right site, wrong subject: the record for a minute hand washer, not the watch or its case.
- Off-key round 10 (https://www.rmg.co.uk/collections/objects/search/H4%20Marine%20timekeeper): A search results page. It surfaced the right links, but a listing carries none of the record fields.
- Off-key round 11 (https://www.rmg.co.uk/collections/objects/search/H4%20Marine%20timekeeper): This scrolls a results listing. Only titles and links come into view.
- Off-key round 12 (https://www.rmg.co.uk/collections/objects/search/H4%20Marine%20timekeeper): This scrolls a results listing. It exposed the links to the watch and the case but none of their fields.
- flag (round 20): The round 20 read_page and the round 21 scroll show only the case title in the digest's result heads. Did the Run's read of https://www.rmg.co.uk/collections/objects/rmgc-object-256323 actually surface the description text? If it did not, fact-08 and fact-11 would lean toward an unread page rather than an omission.
- flag (round 1): Should the collection landing page in round 1 count as off-key? It was a necessary entry point to the search.
- flag (round 10): Should the results listing in rounds 10–12 count as off-key, given that it led straight to both records the key needed?
- flag (round 14): Should round 14's refused read_page (asking for a part past the end of the page) count as a failed round, or as a wasted acquisition without progress?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:cfff2711…, $0.18

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects | 15667 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/objects/search/Harrison | 1842 | type: the settled page state moved [off-key, search loop, loop head by the streak rule] |
| 3 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/search/Harrison%20H5 | 2911 | navigate: a search after a search with nothing opened between them (streak 2, rewording the one before it) [off-key, search loop] |
| 4 | Acquisition without Progress | navigate | https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22 | 1685 | navigate: a search after a search with nothing opened between them (streak 3) [off-key, search loop] |
| 5 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22 | 8833 | read_page: the first read of this page state [off-key] |
| 6 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22 | 1896 | scroll: the scroll brought new material into view [off-key] |
| 7 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22 | 1679 | scroll: the scroll brought new material into view [off-key] |
| 8 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/%22Harrison%20No.%202%22 | 1371 | scroll: the scroll brought new material into view [off-key] |
| 9 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-1100790 | 1546 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 10 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/search/H4%20Marine%20timekeeper | 15979 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 11 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/H4%20Marine%20timekeeper | 1487 | scroll: the scroll brought new material into view [off-key] |
| 12 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/H4%20Marine%20timekeeper | 1267 | scroll: the scroll brought new material into view [off-key] |
| 13 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2632 | navigate: the settled page state moved to a page this Run had not acquired |
| 14 | Failed round | read_page ✗ | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 3619 | every call was refused (read_page) |
| 15 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1512 | scroll: the scroll brought new material into view |
| 16 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2002 | read_page: the first read of this page state |
| 17 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2270 | scroll: a scroll that answered End of Page |
| 18 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 1458 | scroll: the scroll brought new material into view |
| 19 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 5829 | navigate: the settled page state moved to a page this Run had not acquired |
| 20 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1355 | read_page: the first read of this page state |
| 21 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 4132 | scroll: the scroll brought new material into view |
| 22 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 4421 | scroll: the scroll brought new material into view |
| 23 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 3744 | scroll: the scroll brought new material into view |
| 24 | Acquisition without Progress | scroll | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 7232 | scroll: a scroll that answered End of Page |
| 25 | Finalization | record_evidence, record_evidence | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 3793 | the bookkeeping round (record_evidence, record_evidence) |
| 26 | Finalization | — | — | 9083 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier lookup; 7 of 12 Tool Rounds used; 9 orchestrator rounds, 1 in Finalization; Run duration 130899 ms; LLM stage 125719 ms over 9 joined round(s)
- grade useful_partial; checks unsatisfied: fact-03 (1 of 14)
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (1 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 5 declared; Answer standings 5 stated, 0 unverified; 1 shape failure(s) (1 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 5 (63%) · Acquisition without Progress 0 (0%) · Collection 0 (0%) · Bookkeeping 2 (25%) · Failed round 1 (13%) · Finalization 1 (11%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 1, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 1 (round 2), hand consent clicks 0, blocked then hand consent 0
- **verdict: answer omitted** — 13 of 14 checks were satisfied. The one miss, fact-03, rests on the luggage page read in round 3 and recorded in round 6. The work was efficient: 5 of 8 budgeted rounds were Acquisition with Progress, 4 of them on-key (rounds 2 to 5), with 0 Acquisition without Progress and no Search Loop. The shortfall came from what the Answer left out, not from how the rounds were spent.
- stopped early: no — The only unsatisfied check is fact-03. It did not need a page the Run had not read: it follows from https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, which the Run read in round 3. Stopping at 7 of 12 Tool Rounds therefore does not count as an Early Stop.
- answer omitted: yes (fact-03) — Round 3 read https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage, and round 6 recorded the general length limit on London routes from it as Evidence (memory-1). Checking the suitcases' stated length against that limit only needed this material, yet the Answer did not state it, so fact-03 went unsatisfied.
- Off-key round 1 (https://duckduckgo.com/?q=eurostar+luggage+allowance+musical+instruments+official+site&ia=web): This is a search engine results page. It can point to the official sources, but it cannot itself carry any of the key's required facts. It was a single search, and the next round opened the result.
- flag (round 8): Round 8 took 25 s, used 2055 output tokens and made no tool call before the reserved Answer. Was it really a failed round, or a drafting step that belongs with Finalization? Either way it did not affect the result.
- flag (round 1): Should the single DuckDuckGo results page in round 1 count as Off-key, given that it led straight to the official luggage page opened in round 2?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:016a7c96…, $0.10

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=eurostar+luggage+allowance+musical+instruments+officia… | 13968 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2084 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 3304 | read_page: the first read of this page state |
| 4 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 2383 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 4215 | read_page: the first read of this page state |
| 6 | Bookkeeping | record_evidence, record_evidence, record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 56726 | record_evidence, record_evidence, record_candidate |
| 7 | Bookkeeping | record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 2933 | record_candidate |
| 8 | Failed round | — | — | 25136 | the round completed with no tool call and no Answer |
| 9 | Finalization | — | — | 14970 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 7 of 12 Tool Rounds used; 9 orchestrator rounds, 1 in Finalization; Run duration 88178 ms; LLM stage 85596 ms over 9 joined round(s)
- grade pass; checks unsatisfied: none
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 2 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (1 retried)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; Answer standings 3 stated, 0 unverified; 1 shape failure(s) (1 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 1 (13%) · Acquisition without Progress 2 (25%) · Collection 0 (0%) · Bookkeeping 3 (38%) · Failed round 2 (25%) · Finalization 1 (11%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — The attempt passed using 7 of its 12 Tool Rounds, so no failure mode applies. This label names the only inefficiency: of 8 budgeted rounds, 2 were acquisition without progress. Those were rounds 1 and 3, which navigated back to the inherited on-key pages https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage and .../luggage/musical-instruments. Another 2 were failed rounds: round 4 asked read_page for a part past the end of the page and was refused, and round 8 produced no call and no Answer. Only round 2 brought new material, and 3 rounds were bookkeeping. None of this cost the result.
- stopped early: no — The attempt was graded pass and has no unsatisfied checks, so no check needed a page the Run had not read.
- answer omitted: no — The attempt was graded pass and has no unsatisfied checks, so the Answer left nothing unstated that the Run had read.
- flag: The attempt passed with budget to spare, so none of the closed-set verdicts really describes a failure. Should rounds_wasted, which rests on 4 of 8 rounds being unproductive (rounds 1, 3, 4 and 8), be read only as a note on efficiency?
- flag (round 1): Round 1 re-navigated to an inherited page that it then had to re-read in round 2 to confirm the Premier row. On a follow-up that needs a fresh look, should this count as a necessary re-acquisition rather than a round without progress?
- flag (round 3): Round 3 re-opened the inherited musical-instruments page, and round 7 used it to re-verify the guitar rule. Was that re-verification needed, given that pitfall-01 warns against re-litigating the guitar exception?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:a68118bc…, $0.10

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 7218 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 2119 | read_page: the first read of this page state |
| 3 | Acquisition without Progress | record_evidence, navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 6649 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 4 | Failed round | read_page ✗ | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5890 | every call was refused (read_page) |
| 5 | Bookkeeping | record_evidence, record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 10956 | record_evidence, record_candidate |
| 6 | Bookkeeping | record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 5119 | record_candidate |
| 7 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 11774 | record_evidence |
| 8 | Failed round | — | — | 21222 | the round completed with no tool call and no Answer |
| 9 | Finalization | — | — | 14649 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended failed (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 289242 ms; LLM stage 188493 ms over 26 joined round(s)
- grade unsuccessful; checks unsatisfied: fact-01, fact-02, fact-03, fact-04, fact-05, fact-06, fact-07, fact-08, fact-09 (9 of 15)
- 0 Subagent round(s) over 0 Subagent(s); 1 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); 0 walled round(s)
- Malformed Answers: 0 (0 retried)
- Finalization: 0 bookkeeping round(s) skipped, 1 round(s) cut by the Finalization Allowance (1 after a first token, 0 silent)
- Asked Items: 8 declared; Answer standings 0 stated, 8 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 18 (75%) · Acquisition without Progress 1 (4%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 5 (21%) · Finalization 2 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 3, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- **verdict: rounds wasted** — About 15 of 24 budgeted rounds (1–7, 9–15, 24) went to off-key pages: the wrong-release status update and its archived copies, search pages, a capture calendar, an index page and a sea-level article. Rounds 10–11 also brought in no new material. Only rounds 17–18 landed on the right June release, and the September announcement was never reached.
- secondary: failed rounds — 5 of 24 rounds failed (8 and 20–23). The timed-out navigate in round 20 to the September-era archive locked the browser through round 23, which cost the last chance to read the September account before the budget ran out at round 24.
- stopped early: no — The attempt used all 24 Tool Rounds and ended with budget_exhausted, so it did not stop early.
- answer omitted: yes (fact-01, fact-04) — The Run read the archived June release (2013-209) in round 18 and recorded Evidence from it in round 19. That page carries the material for fact-01 and fact-04, yet the Grade marks both unsatisfied. The other unsatisfied checks (fact-02, fact-03 and fact-05 to fact-09) needed the September announcement, which the Run never read.
- Off-key round 1 (https://duckduckgo.com/?q=JPL+June+2013+Voyager+1+%22has+not+yet%22+reached+interstellar+space+statement&ia=web): A search results page. It lists sources but cannot carry a required fact itself.
- Off-key round 2 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/): Right site, wrong release. This is an earlier status update (release 2013-107, linking back to 2012-381), not the June account or the September announcement. It cannot carry the checked release dates or the mechanism.
- Off-key round 3 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/): A read of the same wrong-release status update.
- Off-key round 4 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location): A scroll on the wrong-release status update.
- Off-key round 5 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location): A scroll on the wrong-release status update.
- Off-key round 6 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location): A scroll on the wrong-release status update.
- Off-key round 7 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location): A scroll on the wrong-release status update.
- Off-key round 9 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location): A Look for a date on the wrong-release status update.
- Off-key round 10 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location): A Look on the wrong-release status update. It returned nothing legible.
- Off-key round 11 (https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location): A Look on the wrong-release status update. It returned nothing legible.
- Off-key round 12 (https://web.archive.org/web/20130701000000*/jpl.nasa.gov/news/news.php?release=2013-107): A Wayback capture-calendar page for the wrong release. It carries no article content.
- Off-key round 13 (https://web.archive.org/web/20130516021947/http://www.jpl.nasa.gov/news/news.php?release=2013-107): An archived copy of the same wrong-release status update (2013-107).
- Off-key round 14 (https://duckduckgo.com/?q=jpl.nasa.gov+Voyager+1+statement+June+27+2013+%22has+not+yet%22+interstellar+space&ia=web): A search results page.
- Off-key round 15 (https://web.archive.org/web/20130701174741/http://www.jpl.nasa.gov/news/archives.php?year=2013): A news-archive index page. It lists titles and cannot carry the facts, though it led to the right release.
- Off-key round 19 (https://duckduckgo.com/?q=NASA+press+release+September+12+2013+%22Voyager+1+reaches+interstellar+space%22+August+25+2012+plasma+density&ia=web): A search results page.
- Off-key round 24 (https://web.archive.org/web/20130923015816/http://www.jpl.nasa.gov/news/news.php?release=2013-255): Right site, wrong subject: an article about sea level, not Voyager.
- overrule round 10 → Acquisition without Progress: The Look returned 'not legible' on a page state already read in round 3, so it brought in no new material.
- overrule round 11 → Acquisition without Progress: The Look again returned 'not legible' on a page state already read in round 3, and the app's own notice reports two consecutive actions with no progress.
- flag (round 2): Should the 2013-107 status update (rounds 2–13) count as off-key? It states the team's not-yet-arrived consensus, though it is not the June 27 release.
- flag (round 15): Should the archive index page count as off-key when it was the step that led to the correct June release?
- flag (round 13): Should the archived copy of a page already read in rounds 2–7 count as acquisition without progress rather than with progress?
- flag: Should answer_omitted be the secondary verdict instead of failed_rounds, since fact-01 and fact-04 were on a page the Run had read and even recorded?
- reviewer claude-opus-5 at high, prompt audit-p3, digest sha256:dd1f5cab…, $0.21

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://duckduckgo.com/?q=JPL+June+2013+Voyager+1+%22has+not+yet%22+reached+inte… | 31547 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 2 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 1951 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 3 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 2408 | read_page: the first read of this page state [off-key] |
| 4 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 3060 | scroll: the scroll brought new material into view [off-key] |
| 5 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 5827 | scroll: the scroll brought new material into view [off-key] |
| 6 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 3288 | scroll: the scroll brought new material into view [off-key] |
| 7 | Acquisition with Progress | scroll | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 4407 | scroll: the scroll brought new material into view [off-key] |
| 8 | Failed round | read_page ✗ | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 1895 | every call was refused (read_page) |
| 9 | Acquisition with Progress | look | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 2587 | look: the first Look at this page state with this question [off-key] |
| 10 | Acquisition with Progress → Acquisition without Progress | look | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 1849 | look: the first Look at this page state with this question [off-key] |
| 11 | Acquisition with Progress → Acquisition without Progress | look | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location | 1802 | look: the first Look at this page state with this question [off-key] |
| 12 | Acquisition with Progress | navigate | https://web.archive.org/web/20130701000000*/jpl.nasa.gov/news/news.php?release=2… | 4910 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 13 | Acquisition with Progress | navigate | https://web.archive.org/web/20130516021947/http://www.jpl.nasa.gov/news/news.php… | 2305 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 14 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=jpl.nasa.gov+Voyager+1+statement+June+27+2013+%22has+n… | 37592 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 15 | Acquisition with Progress | navigate | https://web.archive.org/web/20130701174741/http://www.jpl.nasa.gov/news/archives… | 4016 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 16 | Acquisition without Progress | scroll | https://web.archive.org/web/20130701174741/http://www.jpl.nasa.gov/news/archives… | 5180 | scroll: a scroll that answered End of Page |
| 17 | Acquisition with Progress | navigate | https://web.archive.org/web/20130630031236/http://www.jpl.nasa.gov/news/news.php… | 4392 | navigate: the settled page state moved to a page this Run had not acquired |
| 18 | Acquisition with Progress | read_page | https://web.archive.org/web/20130630031236/http://www.jpl.nasa.gov/news/news.php… | 3865 | read_page: the first read of this page state |
| 19 | Acquisition with Progress | record_evidence, navigate | https://web.archive.org/web/20130630031236/http://www.jpl.nasa.gov/news/news.php… | 15994 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 20 | Failed round | navigate ✗ | — | 3103 | every call was refused (navigate) |
| 21 | Failed round | read_page ✗ | https://duckduckgo.com/?ia=web&q=NASA+press+release+September+12+2013+%22Voyager… | 1397 | every call was refused (read_page) |
| 22 | Failed round | read_page ✗ | https://duckduckgo.com/?ia=web&q=NASA+press+release+September+12+2013+%22Voyager… | 1686 | every call was refused (read_page) |
| 23 | Failed round | look ✗ | https://duckduckgo.com/?ia=web&q=NASA+press+release+September+12+2013+%22Voyager… | 2141 | every call was refused (look) |
| 24 | Acquisition with Progress | navigate | https://web.archive.org/web/20130923015816/http://www.jpl.nasa.gov/news/news.php… | 3024 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 25 | Finalization | — | — | 15082 | a Finalization round cut by the Finalization Allowance |
| 26 | Finalization | — | — | 23185 | the reserved Answer |

