# Round Audit — bingbong.live-web.information-hunts (fix-313-319-3)

Generated 2026-10-05T21:20:33.961Z from a capture set created 2026-10-05T20:34:32.593Z (state complete). This audit counts and does not judge: every verdict is the reviewer’s for one attempt, and the ranking is arithmetic over those verdicts.

## Provenance

- capture: commit(s) 5e68eb03; mode measured; protocol 1; prompt version(s) 1
- routing: decision=jev-1.13.0; orchestrator=GLM-5.3; subagent=GLM-5.3-flash; vision=GLM-4.6V | reasoning override: none | decision seams: unset (the default seams) | effort overrides: none | adblock: production_default | browser sub-spans: on
- key 2.2.2.2, manifest sha256:faa25d04…; grades by claude-opus-5 via live:grade (revision 1)
- reviewer: claude-opus-5 at high, prompt audit-p4; audit run at commit 5e68eb03 (dirty tree)

## Populations

Kinds are mechanical counts; a share is over the budgeted rounds (Finalization over all rounds). An arrow shows the count after the reviewer’s overrules.

| population | attempts | judged | rounds | budgeted | tool rounds used | at budget | Acquisition with Progress | Acquisition without Progress | Collection | Bookkeeping | Failed round | Finalization |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| initial | 4 | 4 | 78 | 73 | 73 | 2 | 51 (70%) → 57 | 17 (23%) → 11 | 0 (0%) | 5 (7%) | 0 (0%) | 5 (6%) |
| follow_up | 2 | 2 | 15 | 13 | 13 | 0 | 7 (54%) → 6 | 2 (15%) → 3 | 0 (0%) | 4 (31%) | 0 (0%) | 2 (13%) |

| verdict | initial primary | initial secondary | follow_up primary | follow_up secondary |
| --- | --- | --- | --- | --- |
| rounds wasted | 2 | 2 | 1 | 1 |
| tier too small or never escalated | 0 | 0 | 0 | 0 |
| budget too small for the Hunt | 0 | 0 | 0 | 0 |
| stopped early | 0 | 0 | 1 | 0 |
| answer omitted | 2 | 0 | 0 | 0 |
| failed rounds | 0 | 0 | 0 | 0 |

- initial: 20 Off-key round(s), 3 Search Loop round(s) by the reviewer (3 by the streak rule, heads included: 2 at streak 2 or beyond, 1 at 3 or beyond; attempts by search source rail 3, replay 1, none 0; navigate searches by Search URL form q 15, param 0, path 2; 1 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 3 recovery round(s) over 1 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 1 Empty Landing(s), 0 followed by a search, 0 read with text; 2 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 2 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined no_tier_above 2, 0 declined no_progress against the replay), 0 inherited, 1 rejected Evidence Checkpoint(s), 0 walled round(s), 3 navigate(s) landed on a Not-found Page (3 judged Off-key), 5 Composed Address(es) rewritten into a site search (3 judged Off-key, 0 to an address the Run was shown), 5 search(es) ran with an Unseen Phrase unquoted (4 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 6 Result Pick(s) against 12 listing(s) returned to the model, a search’s result opened in 1.9 round(s) on average (14 of 18 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 12 record_evidence call(s) by the model and 5 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 3 Held Page round(s) without Progress, 4 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 0 landing(s) that carried no page, 3 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 6 offered in 4 Answer(s), 5 accepted, 1 dropped (malformed 1), 0 Malformed Answer(s) (0 retried), 0 Off-language Answer(s), 2 sentence(s) spoken early (0 second utterance(s), 0 stood for an Answer not its own), 2 Card(s) published early (0 Answer(s) out of field order, 0 Answer Tail(s) fell back), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 1 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 2167 ms, p90 5214 ms over 78 round(s), 4 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 0 stopped early, 2 answer omitted, 8 overrule(s), 21 flag(s); Finalization Causes: budget_exhausted 2, objective_met 2
- follow_up: 2 Off-key round(s), 2 Search Loop round(s) by the reviewer (2 by the streak rule, heads included: 1 at streak 2 or beyond, 0 at 3 or beyond; attempts by search source rail 1, replay 0, none 1; navigate searches by Search URL form q 2, param 0, path 0; 0 covered, 0 not shown and 0 pre-#264 Blocked Action(s), 0 inert click(s), 0 inside a Search Loop streak, 0 post-block vision round(s), 0 recovery round(s) over 0 recovered block(s) and 0 never recovered; 0 Unavailable Landing(s) (0 by status, 0 by title), 0 followed by a search; 0 Empty Landing(s), 0 followed by a search, 0 read with text; 0 page arrival(s) by a click, a type or a step through history, 0 that showed no text, 0 Unfinished Load(s); 0 consent dismissal(s), 0 hand consent click(s), 0 blocked then hand consent; 0 window open(s) followed, 0 denied; 0 budget-armed and 0 deadline-armed Tier Escalation(s) (replay found Progress before 0, none before 0), declined none, 0 declined no_progress against the replay), 1 inherited, 0 rejected Evidence Checkpoint(s), 1 walled round(s), 0 navigate(s) landed on a Not-found Page (0 judged Off-key), 0 Composed Address(es) rewritten into a site search (0 judged Off-key, 0 to an address the Run was shown), 0 search(es) ran with an Unseen Phrase unquoted (0 judged Off-key), 0 search(es) ran on the Run Engine in place of another Web Engine (0 judged Off-key), 0 Result Pick(s) against 1 listing(s) returned to the model, a search’s result opened in 2.0 round(s) on average (1 of 1 searches), 0 Run-made Evidence Checkpoint(s) from a Selected Passage (0 recorded again by the model from the same page, 0 with the same passage) against 4 record_evidence call(s) by the model and 4 bookkeeping-only round(s), of 0 Run-made Evidence Checkpoint(s), 0 whose passage a later record of the model's contains and 0 cited in the Answer's evidence_ids, 0 accepted record(s) answered with the contradiction Note, 0 Subagent round(s), 0 merged Evidence Checkpoint(s) (a floor), 0 Held Page round(s) without Progress, 1 bundled checkpoint round(s), 0 same-source unsupported round(s), subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address, 0 Answer(s) with an Identity Slip, 0 id(s) slipped, Delegated Page rounds 0 while running, 0 while finished and uncollected, 0 after collection, 0 read(s) refused as past the end, 0 landing(s) that carried no page, 4 bookkeeping round(s) right before the Answer, 0 bookkeeping round(s) right before the cut, Answer Checkpoints: 3 offered in 2 Answer(s), 3 accepted, 0 dropped, 0 Malformed Answer(s) (0 retried), 0 Off-language Answer(s), 2 sentence(s) spoken early (0 second utterance(s), 0 stood for an Answer not its own), 2 Card(s) published early (0 Answer(s) out of field order, 0 Answer Tail(s) fell back), 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable), 0 skipped bookkeeping round(s), 0 Finalization round(s) cut by the Allowance; first-token latency p50 4769 ms, p90 6039 ms over 15 round(s), 1 declared Asked Items (0 with an unverified standing, 0 shape failure(s), 0 retried), 1 stopped early, 0 answer omitted, 1 overrule(s), 5 flag(s); Finalization Causes: objective_met 2

## Verified, or failing only on unasked facts

A second reading beside the verified count (#287): the attempts verified, plus those not verified whose unsatisfied checks are all checks the command did not ask for. Reported, never gated, and never in place of the verified count. An attempt with no Grade, or from an audit written before the checks unsatisfied were kept under that name, is not recorded and counts on neither side.

Unasked facts, by check id: rule-eurostar-luggage initial fact-03, fact-07.

| population | attempts | verified | failing only on unasked facts | verified, or failing only on unasked facts | not recorded |
| --- | --- | --- | --- | --- | --- |
| initial | 4 | 2 | 1 | 3 of 4 | 0 |
| follow_up | 2 | 1 | 0 | 1 of 2 | 0 |

## Tool rounds

The rounds outside Finalization that called each tool — a round counts once per tool, refused calls included — and their share of the tool rounds used. Counted from the Run Trace; the reviewer never sees it.

| tool | initial | follow_up |
| --- | --- | --- |
| navigate | 33 (45%) | 7 (54%) |
| read_page | 18 (25%) | 2 (15%) |
| record_evidence | 10 (14%) | 3 (23%) |
| scroll | 11 (15%) | 0 |
| report_run_plan | 4 (5%) | 2 (15%) |
| record_candidate | 0 | 3 (23%) |
| click | 2 (3%) | 0 |
| look | 2 (3%) | 0 |
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
| rule-eurostar-luggage | 1 | 0 | 0 | 0 | 3 | 1 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Tier Escalations by hunt

Automatic Tier Escalations by arm (ADR 0042, ADR 0063), the replay’s own Progress verdict on the round before each, and the declines a budget or deadline stop recorded, by reason in guard order. Reported, never gated.

| hunt | budget arm | deadline arm | Progress before | no Progress before | declined no_rail | declined no_tier_above | declined once_spent | declined hard_ceiling | declined no_progress | against the replay | not recorded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| rule-eurostar-luggage | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| superseded-voyager-interstellar | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |

## Rewrites by hunt

Composed Addresses rewritten into a search of the site (ADR 0055), searches that ran with an Unseen Phrase unquoted (ADR 0064) and searches that ran on the Run Engine in place of another Web Engine (ADR 0067), one per call, from the Tool Round’s own stamps.

| hunt | composed addresses | unseen phrases | engine rewrites |
| --- | --- | --- | --- |
| compatibility-pi-camera | 1 | 0 | 0 |
| historical-longitude-watch | 0 | 0 | 0 |
| rule-eurostar-luggage | 1 | 0 | 0 |
| superseded-voyager-interstellar | 3 | 5 | 0 |

## Tier shadow

The Decision Model’s tier pick, asked before the first orchestrator call and never acted on (#278, ADR 0068), against the tier the model’s first Run Plan declared; then its garble Noul against the Run’s Finalization Cause. Initials and follow-ups are kept apart, since a follow-up is asked with its own command alone. Agreement is over the compared attempts; the confident ones cleared the tier seam’s Choice threshold of 0.7. Reported, never gated.

| hunt | asked | unavailable | compared | agreed | confident (≥ 0.7) | confident agreed |
| --- | --- | --- | --- | --- | --- | --- |
| compatibility-pi-camera (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| compatibility-pi-camera (follow-up) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| historical-longitude-watch (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |
| rule-eurostar-luggage (initial) | 1 | 0 | 1 | 0 (0%) | 0 | 0 (n/a) |
| rule-eurostar-luggage (follow-up) | 1 | 0 | 0 | 0 (n/a) | 0 | 0 (n/a) |
| superseded-voyager-interstellar (initial) | 1 | 0 | 1 | 1 (100%) | 1 | 1 (100%) |

| hunt | Finalization Cause | answered | garbled (≥ 0.7) |
| --- | --- | --- | --- |
| compatibility-pi-camera (initial) | budget_exhausted | 1 | 0 (0%) |
| compatibility-pi-camera (follow-up) | objective_met | 1 | 0 (0%) |
| historical-longitude-watch (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (initial) | objective_met | 1 | 0 (0%) |
| rule-eurostar-luggage (follow-up) | objective_met | 1 | 0 (0%) |
| superseded-voyager-interstellar (initial) | budget_exhausted | 1 | 0 (0%) |

## Attempts

### compatibility-pi-camera--initial (initial)

- answered; ended done / completed (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 26 orchestrator rounds, 2 in Finalization; Run duration 121976 ms; LLM stage 112534 ms over 26 joined round(s)
- grade useful_partial; checks unsatisfied: fact-05 (1 of 10)
- verified, or failing only on unasked facts: neither
- 0 Subagent round(s) over 0 Subagent(s); 5 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 3 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.85 against the declared investigation (agrees); garbled 0.03
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 0 (0 second utterance(s), 0 stood for an Answer not its own)
- Cards published early: 0 (0 Answer(s) out of field order, 0 Answer Tail(s) fell back)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 4 declared; Answer standings 4 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 17)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 1 (round 18)
- of the rewrites, judged Off-key by the reviewer: 1
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 1 (round 18)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 5; bookkeeping-only rounds: 2
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 13 (54%) · Acquisition without Progress 9 (38%) · Collection 0 (0%) · Bookkeeping 2 (8%) · Failed round 0 (0%) · Finalization 2 (8%)
- search source replay: the streak rule re-run over navigate searches
- navigate searches by Search URL form: q 1, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 1 (round 19); showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; declined at the budget: no_tier_above (after round 24, replay: no Progress)
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 0
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: answer omitted** — The single unsatisfied check, fact-05, follows from the documentation page the Run had already read and twice cited as Evidence (opened round 5; read and scrolled rounds 6-16; Evidence in rounds 7 and 17 both grounded on it), yet the Answer in round 26 left it unstated. Nine of ten checks were satisfied, so the gap is one of reporting from material in hand rather than of material never seen.
- secondary: rounds wasted — Eight of the 24 budgeted rounds — 17 through 24, a third of the budget — went to pages that can carry no required fact of this task: a 404 (round 17), a DuckDuckGo results page produced by the app's rewrite (round 18), and six rounds on https://www.raspberrypi.com/documentation/computers/config_txt.html (rounds 19-24, the last under budget_warning:3/24). Those rounds, plus the End-of-Page scroll in round 13, are where the budget ran out while fact-05's own page was left unfinished.
- stopped early: no — The attempt ran to its budget: 24 of 24 Tool Rounds used, ended budget_exhausted with the reserved Answer in round 26. An attempt that exhausted its budget did not stop early, so no unsatisfied check is assigned here.
- answer omitted: yes (fact-05) — fact-05 rests on https://www.raspberrypi.com/documentation/computers/camera_software.html, a page the Run opened in round 5 and worked through in rounds 6-16 (scrolls 6-13, part reads 14-16), recording Evidence from it twice (round 7 on the legacy stack's status, round 17 on autofocus-on-capture). The material for fact-05 sits on that same page the Run had read, and the Answer left it unstated; the Run then spent rounds 17-24 on a 404, a rewritten search and the boot-configuration page instead of finishing that page's legacy-stack section.
- Off-key round 17 (https://www.raspberrypi.com/documentation/computers/config-txt.html#camera-settings): The navigate landed on a Not-found page (404 on www.raspberrypi.com, title "Page not found"); a 404 body can carry no fact-NN of this task.
- Off-key round 18 (https://duckduckgo.com/?q=documentation+computers+config+txt+site%3Araspberrypi.com&ia=web): The composed address was rewritten by the app into a site search, so the settled page was a DuckDuckGo results list. A results page itself carries none of this task's required facts; it only offered a link.
- Off-key round 19 (https://www.raspberrypi.com/documentation/computers/config_txt.html): Right site, wrong subject: the boot-configuration reference. None of fact-01..fact-06 rests on it, and it is not among the key's verified sources; the still-capture and legacy-stack material lives on camera_software.html, which the Run had already left.
- Off-key round 20 (https://www.raspberrypi.com/documentation/computers/config_txt.html): First read of the boot-configuration page; same off-key subject as round 19 — no required fact of this task can be carried here.
- Off-key round 21 (https://www.raspberrypi.com/documentation/computers/config_txt.html): Further read of the boot-configuration page under budget_warning:3/24; off-key for every fact-NN of this task.
- Off-key round 22 (https://www.raspberrypi.com/documentation/computers/config_txt.html): Further read of the same off-key boot-configuration page.
- Off-key round 23 (https://www.raspberrypi.com/documentation/computers/config_txt.html): Further read of the same off-key boot-configuration page.
- Off-key round 24 (https://www.raspberrypi.com/documentation/computers/config_txt.html): Last budgeted round spent on the same off-key boot-configuration page, with fact-05's documentation page left unfinished.
- overrule round 3 → Acquisition with Progress: Labelled a repeat read because the page signature (deb65fce) was unchanged, but the call requested a different chunk (part 1 after part 2 in round 2) and new text reached the assistant: the two Evidence Checkpoints accepted in round 4 are grounded in obs-4 and obs-5 from these reads, one of them on the connector/cable material.
- overrule round 15 → Acquisition with Progress: Same signature (659b02e6) but a new chunk (part 6) of an 84565-long page; the round produced 1972 chars of reasoning and 494 output tokens, and the autofocus-option Evidence accepted in round 17 is grounded in obs-19 from these part reads — material the Run had not previously had in front of it.
- overrule round 16 → Acquisition with Progress: Distinct chunk (part 7) of the same page state; a different slice of a long document, not a re-observation of material already shown, and it feeds the obs-19 Evidence recorded in round 17.
- overrule round 21 → Acquisition with Progress: Distinct chunk (part 5) of config_txt.html (35166 long) after part 6 in round 20; new page text, not a repeat observation. It remains Off-key.
- overrule round 22 → Acquisition with Progress: Distinct chunk (part 4) of config_txt.html; new slice of the document. Off-key nonetheless.
- overrule round 23 → Acquisition with Progress: Distinct chunk (part 3) of config_txt.html; new slice of the document. Off-key nonetheless.
- overrule round 24 → Acquisition with Progress: Distinct chunk (part 2) of config_txt.html; the Evidence accepted in round 25 is grounded in obs-28 from this sequence, showing new material arrived. Off-key nonetheless.
- flag (round 19): Is https://www.raspberrypi.com/documentation/computers/config_txt.html genuinely Off-key? Its camera auto-detect material is adjacent to the Bookworm setup story a reader of fact-06 might want, so a careful human could call rounds 19-24 on-key context rather than Off-key.
- flag (round 18): Should the rewritten navigate count as Acquisition with Progress at all? The intended raspberrypi.com address was never opened and the settled page was a search results list; a human might score it without Progress.
- flag (round 3): Is a read of a different part of an unchanged page state Progress? The overrules in rounds 3, 15, 16 and 21-24 turn on reading part N of a long document as new material; a human could keep the mechanical repeat-read label, which would raise the no-Progress share to 9 of 24.
- flag (round 16): Did the chunks actually read on camera_software.html (parts 2, 6, 7 plus the scrolls of rounds 6-13) include the legacy-stack module-support passage? If that passage sat in an unread part, fact-05 would be a matter of pages not read rather than an omission — though the attempt still exhausted its budget, so stoppedEarly would stay false.
- flag (round 26): Is answer_omitted the right primary over rounds_wasted? The two are close here: a third of the budget went Off-key in rounds 17-24, and that waste is what left the fact-05 page unfinished.
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:dd795a6b…, $0.32

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress | report_run_plan, navigate | https://www.raspberrypi.com/documentation/accessories/camera.html | 12116 | navigate: the settled page state moved to a page this Run had not acquired |
| 2 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 5002 | read_page: the first read of this page state |
| 3 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/accessories/camera.html | 2443 | read_page: a repeat read of a page state already read |
| 4 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/documentation/accessories/camera.html | 3066 | record_evidence, record_evidence |
| 5 | Acquisition with Progress | navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1454 | navigate: the settled page state moved to a page this Run had not acquired |
| 6 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1329 | scroll: the scroll brought new material into view |
| 7 | Bookkeeping | record_evidence | https://www.raspberrypi.com/documentation/computers/camera_software.html | 7208 | record_evidence |
| 8 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1250 | scroll: the scroll brought new material into view |
| 9 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1328 | scroll: the scroll brought new material into view |
| 10 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1375 | scroll: the scroll brought new material into view |
| 11 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 4103 | scroll: the scroll brought new material into view |
| 12 | Acquisition with Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 1260 | scroll: the scroll brought new material into view |
| 13 | Acquisition without Progress | scroll | https://www.raspberrypi.com/documentation/computers/camera_software.html | 4273 | scroll: a scroll that answered End of Page |
| 14 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 8007 | read_page: the first read of this page state |
| 15 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 7516 | read_page: a repeat read of a page state already read |
| 16 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/camera_software.html | 5079 | read_page: a repeat read of a page state already read |
| 17 | Acquisition without Progress | record_evidence, navigate | https://www.raspberrypi.com/documentation/computers/camera_software.html | 7888 | navigate: landed on a Not-found Page [not found, off-key] |
| 18 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=documentation+computers+config+txt+site%3Araspberrypi.… | 4894 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 19 | Acquisition with Progress | click | https://www.raspberrypi.com/documentation/computers/config_txt.html | 2044 | click: the settled page state moved [off-key] |
| 20 | Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/config_txt.html | 2042 | read_page: the first read of this page state [off-key] |
| 21 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/config_txt.html | 1633 | read_page: a repeat read of a page state already read [off-key] |
| 22 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/config_txt.html | 1903 | read_page: a repeat read of a page state already read [off-key] |
| 23 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/config_txt.html | 4797 | read_page: a repeat read of a page state already read [off-key] |
| 24 | Acquisition without Progress → Acquisition with Progress | read_page | https://www.raspberrypi.com/documentation/computers/config_txt.html | 2139 | read_page: a repeat read of a page state already read [off-key] |
| 25 | Finalization | record_evidence | https://www.raspberrypi.com/documentation/computers/config_txt.html | 7081 | the bookkeeping round (record_evidence) |
| 26 | Finalization | — | — | 11304 | the reserved Answer |

### compatibility-pi-camera--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier investigation; 8 of 24 Tool Rounds used; 9 orchestrator rounds, 1 in Finalization; Run duration 160523 ms; LLM stage 154063 ms over 9 joined round(s)
- grade useful_partial; checks unsatisfied: fact-02 (1 of 6)
- verified, or failing only on unasked facts: neither
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 1 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.70 against the declared investigation (agrees); garbled 0.04
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 9: 39.2 s after its start, 9.2 s before its end, ended answer
- Cards published early: 1 (0 Answer(s) out of field order, 0 Answer Tail(s) fell back); round 9: 45.0 s after its start, 3.4 s before its end
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; Answer standings 3 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 1 (round 2)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 3; bookkeeping-only rounds: 2
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 5 (63%) · Acquisition without Progress 1 (13%) · Collection 0 (0%) · Bookkeeping 2 (25%) · Failed round 0 (0%) · Finalization 1 (11%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 2, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 2 (round 7, 8)
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 3 offered in 1 Answer(s), 3 accepted, 0 dropped
- **verdict: stopped early** — The Run used 8 of 24 budgeted Tool Rounds (16 unused) and finished in 160 s with a terminal objective_met, yet unsatisfied fact-02 required the mechanical documentation page that no round reached - rounds 3-6 stayed on product pages. With two thirds of the budget untouched, not finding and opening that page is the stop.
- secondary: rounds wasted — Rounds 1 and 2 were a single blind search loop on DuckDuckGo results pages, both Off-key - 2 of the 8 rounds actually used (25%), and the only acquisition rounds that put no new material in front of the assistant. They did not exhaust the budget, so this ranks below the early stop.
- stopped early: yes (fact-02) — The Run stopped at 8 of its 24 Tool Rounds after about 160 s, ending terminal/objective_met with 16 rounds in hand. The one unsatisfied check, fact-02, turns on the official mechanical documentation at https://www.raspberrypi.com/documentation/accessories/camera.html, a page the Run never opened: it read only the Zero Case, Camera Module 3 and Camera Module 2 product pages (rounds 3-6), whose recorded excerpts give a bare compatibility note and board dimensions rather than the documented mechanical account fact-02 requires. Deriving it from those product pages' dimension lines would be inference, which does not carry a required fact.
- answer omitted: no — The only unsatisfied check, fact-02, is attributed to a page the Run had not read, so no unsatisfied check follows from material already in front of the assistant; a check id may appear in only one list.
- Search Loop over rounds 1, 2: Round 1's navigate was rewritten by the app into a search (streak 1) and its Result Pick opened https://forums.raspberrypi.com/viewtopic.php?t=395459, which came back as a challenge wall titled "Just a moment..." — nothing was actually put in front of the assistant. Round 2 is a second search (streak 2, rewording the first), so the two consecutive searches form one loop; a landing on a wall does not end it.
- Off-key round 1 (https://duckduckgo.com/?q=Raspberry+Pi+Zero+Case+camera+lid+Camera+Module+3+fit+dimensions&ia=web): The settled page is a DuckDuckGo results list, and the one link the app opened on the assistant's behalf resolved to a bot-challenge wall on forums.raspberrypi.com. Neither surface can carry any required fact of this task.
- Off-key round 2 (https://duckduckgo.com/?q=%22Camera+Module+3%22+official+Raspberry+Pi+Zero+case+lid+does+not+fit+aperture&ia=web): A second DuckDuckGo results page with no result opened; a search results list carries none of the task's required facts.
- overrule round 1 → Acquisition without Progress: Mechanically scored as progress because the settled state moved to a URL not yet acquired, but that URL is the DuckDuckGo results page for an address the app rewrote into a search, and its Result Pick landed on a challenge wall. As the first member of the rounds 1-2 search loop it brought in no new material.
- flag (round 1): Round 1's Result Pick did open a forum thread whose label names a Zero-Case lid model for Camera Module 3; should the challenge wall there still count as nothing opened, keeping rounds 1-2 one loop and overruling round 1's progress label?
- flag (round 6): Round 6's https://www.raspberrypi.com/products/camera-module-v2/ is the right site but the predecessor module's subject page; a reviewer could call it Off-key rather than on-key support for the cable and continuity material.
- flag (round 9): Is stopped_early decisive over rounds_wasted (2 of 8 used rounds in the rounds 1-2 loop) and over tier_too_small_or_never_escalated, given 16 rounds remained and the needed documentation page was one navigate away?
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:1e372c62…, $0.24

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition with Progress → Acquisition without Progress | report_run_plan, navigate | https://forums.raspberrypi.com/viewtopic.php?t=395459 | 8707 | navigate: the settled page state moved to a page this Run had not acquired [walled, result pick, off-key, search loop, loop head by the streak rule] |
| 2 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=%22Camera+Module+3%22+official+Raspberry+Pi+Zero+case+… | 44138 | navigate: a search after a search with nothing opened between them (streak 2, rewording the one before it) [off-key, search loop] |
| 3 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case/ | 13077 | navigate: the settled page state moved to a page this Run had not acquired |
| 4 | Acquisition with Progress | record_evidence, navigate | https://www.raspberrypi.com/products/raspberry-pi-zero-case | 14090 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | read_page | https://www.raspberrypi.com/products/camera-module-3/ | 2691 | read_page: the first read of this page state |
| 6 | Acquisition with Progress | navigate | https://www.raspberrypi.com/products/camera-module-v2/ | 4361 | navigate: the settled page state moved to a page this Run had not acquired |
| 7 | Bookkeeping | record_evidence, record_evidence | https://www.raspberrypi.com/products/camera-module-v2 | 13719 | record_evidence, record_evidence |
| 8 | Bookkeeping | record_candidate | https://www.raspberrypi.com/products/camera-module-v2 | 4889 | record_candidate |
| 9 | Finalization | — | — | 48391 | the reserved Answer |

### historical-longitude-watch--initial (initial)

- answered; ended done / completed (objective_met); tier investigation; 14 of 24 Tool Rounds used; 15 orchestrator rounds, 1 in Finalization; Run duration 132945 ms; LLM stage 106314 ms over 15 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 0 Subagent round(s) over 0 Subagent(s); 0 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.06
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 15: 27.5 s after its start, 13.0 s before its end, ended answer
- Cards published early: 1 (0 Answer(s) out of field order, 0 Answer Tail(s) fell back); round 15: 33.1 s after its start, 7.4 s before its end
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 3 declared; Answer standings 3 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 1 (round 6); listings returned to the model: 2 (round 3, 7)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 0; bookkeeping-only rounds: 0
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 2, 1, 7
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 12 (86%) · Acquisition without Progress 2 (14%) · Collection 0 (0%) · Bookkeeping 0 (0%) · Failed round 0 (0%) · Finalization 1 (7%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 0, param 0, path 2
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 1 (round 1); followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 1 (round 4); showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 0
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 4 offered in 1 Answer(s), 3 accepted, 1 dropped (malformed 1)
- **verdict: rounds wasted** — Nothing in the closed set fits a passing, under-budget Run well; the only cost visible is the two rounds without Progress, 2 of 14 budgeted rounds (~14%): round 1's navigate to https://www.rmg.co.uk/collections/objects-and-stories/harrison-sea-watch-h4 returned an Empty Landing, and round 9's Look on https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 returned nothing legible before round 10 re-asked it with a region. The remaining 12 rounds carried Progress, both key sources were opened (rounds 6 and 13), no round failed, 10 of 24 Tool Rounds went unused, and the Grade is a pass — so this is a minor charge, not a diagnosis of the attempt.
- stopped early: no — The Grade records no unsatisfied checks, so there is no check to attribute to a page the Run had not read; the Run also ended on its own terms (done/objective_met) after 14 of 24 Tool Rounds, having read both verified sources (https://www.rmg.co.uk/collections/objects/rmgc-object-79142 at round 6 and https://www.rmg.co.uk/collections/objects/rmgc-object-256323 at round 13).
- answer omitted: no — No check is listed as unsatisfied, so nothing from a read page was left unstated to judge.
- flag (round 2): Round 2's landing on https://www.rmg.co.uk/collections/objects is a bare Collection Results surface that states no required fact of its own — should it be called Off-key, or is it properly read as the entry surface the Run had to reach to query the catalogue?
- flag (round 5): Round 5 reads the results page at https://www.rmg.co.uk/collections/objects/search/Harrison%20sea%20watch%20H4, which the Run then set aside for a different query in round 6 — a careful human might call this results read Off-key; I did not, because its result heads carried the object links the Run needed next.
- flag (round 7): Rounds 7, 8, 10, 11 and 12 all work the one results page https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 (read, two Looks, two scrolls) rather than opening the records directly; is that five-round dwell on a results surface Off-key or legitimate navigation, given round 12's result head surfaced the case link the Run opened in round 13?
- flag (round 6): Round 6 is a navigate the app recorded as a URL search with a Result Pick that opened https://www.rmg.co.uk/collections/objects/rmgc-object-79142; I treated that Pick as a real opening, which ends any streak before round 7's search — a reviewer who treated rounds 3, 6 and 7 as three searches with only a results page and a read between them could call rounds 6-7 a loop boundary instead.
- flag (round 1): Round 1 bundles report_run_plan with the navigate that hit an Empty Landing; the mechanical kind is Acquisition without Progress rather than Bookkeeping — is that the right reading of a round whose only completed work was the plan report?
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:c152104f…, $0.18

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.rmg.co.uk/collections/objects-and-stories/harrison-sea-watch-h4 | 4985 | navigate: landed on an Empty Landing [empty landing] |
| 2 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects | 2292 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | type | https://www.rmg.co.uk/collections/objects | 2409 | type: a requested state change (text entered or an option selected) |
| 4 | Acquisition with Progress | click | https://www.rmg.co.uk/collections/objects/search/Harrison%20sea%20watch%20H4 | 1266 | click: the settled page state moved |
| 5 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/Harrison%20sea%20watch%20H4 | 1447 | read_page: the first read of this page state |
| 6 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79142 | 2532 | navigate: the settled page state moved to a page this Run had not acquired [result pick] |
| 7 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 6129 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | read_page | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 1274 | read_page: the first read of this page state |
| 9 | Acquisition without Progress | look | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 2788 | look: the Look returned nothing legible |
| 10 | Acquisition with Progress | look | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 4400 | look: the first Look at this page state with this question |
| 11 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 1515 | scroll: the scroll brought new material into view |
| 12 | Acquisition with Progress | scroll | https://www.rmg.co.uk/collections/objects/search/ZAA0037.1 | 1304 | scroll: the scroll brought new material into view |
| 13 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-256323 | 1492 | navigate: the settled page state moved to a page this Run had not acquired |
| 14 | Acquisition with Progress | navigate | https://www.rmg.co.uk/collections/objects/rmgc-object-79143 | 32020 | navigate: the settled page state moved to a page this Run had not acquired |
| 15 | Finalization | — | — | 40461 | the reserved Answer |

### rule-eurostar-luggage--initial (initial)

- answered; ended done / completed (objective_met); tier lookup; 11 of 12 Tool Rounds used; 12 orchestrator rounds, 1 in Finalization; Run duration 91214 ms; LLM stage 76977 ms over 12 joined round(s)
- grade useful_partial; checks unsatisfied: fact-07 (1 of 14)
- verified, or failing only on unasked facts: failing only on unasked facts
- 0 Subagent round(s) over 0 Subagent(s); 2 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 1 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 0.69 against the declared lookup (disagrees); garbled 0.04
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 12: 20.8 s after its start, 9.2 s before its end, ended answer
- Cards published early: 1 (0 Answer(s) out of field order, 0 Answer Tail(s) fell back); round 12: 27.1 s after its start, 2.8 s before its end
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 5 declared; Answer standings 5 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 1 (round 3)
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 3 (round 2, 3, 9); listings returned to the model: 0
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 2; bookkeeping-only rounds: 1
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 1, 1, 1
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 8 (73%) · Acquisition without Progress 2 (18%) · Collection 0 (0%) · Bookkeeping 1 (9%) · Failed round 0 (0%) · Finalization 1 (8%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 3, param 0, path 0
- Blocked Actions covered 1 (round 5), not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block 5 +3
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 1 (round 1), hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 1 (round 11)
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 1 offered in 1 Answer(s), 1 accepted, 0 dropped
- **verdict: answer omitted** — 13 of 14 checks were satisfied and the one unsatisfied check, fact-07, rests entirely on pages the Run had read and recorded (round 8 help-centre allowance FAQ, round 10 musical-instruments page, both accepted as Evidence at rounds 9 and 11). The shortfall lies in what the round-12 Answer stated, not in what the Run acquired, so answerOmitted is decisive.
- secondary: rounds wasted — 3 of the 11 budgeted rounds (~27%) produced nothing usable: round 1 on a Not-found page, round 2 on the booking homepage reached via an errored search-results URL and that error page's own "Go to the homepage" link, and round 5's type that the result reports as not typed. The Run reached its first on-key policy page only at round 8 and finished with 1 budgeted round left (budget_warning:3/12 at round 9), so those detours squeezed the end of the Run without costing it the result.
- stopped early: no — The only unsatisfied check, fact-07, does not require a page the Run had not read: the allowance statement read at round 8 (https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take) and the instrument page read at round 10 (https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments) were both put in front of the assistant. No unsatisfied check points to unread material, so the single remaining budgeted round does not make this an early stop.
- answer omitted: yes (fact-07) — fact-07 turns on the same item count and allowance structure the Run had already acquired and recorded as Evidence from https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take (round 8, checkpoint at round 9) and https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instruments (round 10, checkpoint at round 11); no further page was needed for the Answer to state it, and the round-12 Answer left it unstated.
- Off-key round 1 (https://www.eurostar.com/us-en/travel-info/service/luggage-allowance): The composed address resolved to a Not-found page ("Sorry, we can't find the page you're looking for"); a 404 shell carries no policy text, so this acquisition could land none of the task's required facts.
- Off-key round 2 (https://www.eurostar.com/uk-en): The intended search-results URL returned "Sorry, something went wrong" and the app's Result Pick followed the error page's own navigation link "Go to the homepage"; the settled state is the commercial booking homepage, which states no allowance or instrument policy and is not one of the key's verified sources.
- flag (round 2): Round 2 is marked off-key, yet the Result Pick did move the Run to a Eurostar page it had not been on and the homepage is the entry point to the travel-info sections; should a navigational landing reached through an error page count as on-key instead?
- flag (round 3): Round 3's address was rewritten by the app into a site search whose pick opened https://help.eurostar.com/, a category hub that states no allowance itself; should it be called off-key, or on-key because the scroll at round 7 surfaced the Luggage FAQ links from it?
- flag (round 5): The rewritten call at round 3 is explicitly neither a search of a loop nor an end to one; a stricter reading could treat the searches of rounds 2 and 5 as a two-search loop — should that boundary be drawn differently?
- flag (round 5): Round 5's type returned "not typed — covered by an unlabelled <div>"; a careful human might call that a failed round rather than an acquisition without progress.
- flag (round 1): Round 1 bundles report_run_plan with the navigate that hit the 404; should it be read as bookkeeping rather than an off-key acquisition without progress?
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:93376238…, $0.31

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.eurostar.com/us-en/travel-info/service/luggage-allowance | 10231 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en | 1768 | navigate: the settled page state moved to a page this Run had not acquired [result pick, off-key] |
| 3 | Acquisition with Progress | navigate | https://help.eurostar.com/ | 2630 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, result pick] |
| 4 | Acquisition with Progress | read_page | https://help.eurostar.com/ | 4746 | read_page: the first read of this page state |
| 5 | Acquisition without Progress | type | https://help.eurostar.com/ | 3517 | type: the result reports no page movement |
| 6 | Acquisition with Progress | scroll | https://help.eurostar.com/ | 4710 | scroll: the scroll brought new material into view |
| 7 | Acquisition with Progress | scroll | https://help.eurostar.com/ | 3931 | scroll: the scroll brought new material into view |
| 8 | Acquisition with Progress | navigate | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 1487 | navigate: the settled page state moved to a page this Run had not acquired |
| 9 | Acquisition with Progress | navigate, record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 9336 | navigate: the settled page state moved to a page this Run had not acquired [result pick] |
| 10 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 1413 | read_page: the first read of this page state |
| 11 | Bookkeeping | record_evidence | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage/musical-instr… | 3234 | record_evidence |
| 12 | Finalization | — | — | 29974 | the reserved Answer |

### rule-eurostar-luggage--follow_up (revised_objective)

- answered; ended done / completed (objective_met); tier lookup; 5 of 12 Tool Rounds used; 6 orchestrator rounds, 1 in Finalization; Run duration 41467 ms; LLM stage 39182 ms over 6 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 0 Subagent round(s) over 0 Subagent(s); 3 accepted (0 merged, a floor) and 0 rejected Evidence Checkpoint(s); 1 inherited round(s); 0 Held Page round(s) without Progress; 0 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: lookup at 0.77 with no declared tier; garbled 0.11
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 1 (0 second utterance(s), 0 stood for an Answer not its own); round 6: 5.2 s after its start, 6.7 s before its end, ended answer
- Cards published early: 1 (0 Answer(s) out of field order, 0 Answer Tail(s) fell back); round 6: 9.9 s after its start, 2.0 s before its end
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 0 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: not recorded
- navigates that landed on a Not-found Page: 0
- of those, judged Off-key by the reviewer: 0
- Composed Addresses rewritten into a site search: 0
- of the rewrites, judged Off-key by the reviewer: 0
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 0
- of those, judged Off-key by the reviewer: 0
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 0; listings returned to the model: 0
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 1; bookkeeping-only rounds: 2
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: no search
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 2 (40%) · Acquisition without Progress 1 (20%) · Collection 0 (0%) · Bookkeeping 2 (40%) · Failed round 0 (0%) · Finalization 1 (17%)
- search source none: no Search Observation in the trace, and no navigate search for the replay to find
- navigate searches by Search URL form: q 0, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; none declined
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 2 (round 4, 5)
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 0 offered in 1 Answer(s), 0 accepted, 0 dropped
- **verdict: rounds wasted** — The only inefficiency available to name: of 5 budgeted rounds, round 1 was an Acquisition without Progress (re-navigation to https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take, already checkpointed by the inherited initial attempt) and also carried a rejected report_run_plan, i.e. 1 of 5 rounds (20%) brought nothing new. The remaining 4 rounds were on-key and productive — rounds 2-3 acquired and read https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage (the verified source S1) and rounds 4-5 recorded three accepted checkpoints — and the attempt passed using 5 of its 12 Tool Rounds, so the finding is minor and no tier or budget limit bound the work.
- stopped early: no — The Grade records no unsatisfied checks (pass), so there is no check that could have needed an unread page; the Run also ended on its own terminal stop with 7 of 12 Tool Rounds unused, but with nothing unsatisfied there is no early-stop finding.
- answer omitted: no — No check is listed as unsatisfied, so nothing follows from a read page that the Answer left unstated.
- flag (round 1): Round 1's navigate re-acquired a help-centre luggage FAQ carried over from the initial attempt: a careful human might treat it as reasonable re-grounding for the changed fare class rather than a wasted round, and might also weigh its rejected report_run_plan as bookkeeping noise instead.
- flag: The verdict is on the line: the attempt passed every check inside a fraction of its budget, and all closed-set verdicts describe failures — is naming rounds_wasted on a single 20% non-progress round the right call for an otherwise clean, efficient run?
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:f16427bc…, $0.10

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://help.eurostar.com/faq/uk-en/question/How-much-luggage-can-I-take | 6917 | navigate: a re-acquisition of a page the initial attempt already checkpointed (inherited) [inherited] |
| 2 | Acquisition with Progress | navigate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 4927 | navigate: the settled page state moved to a page this Run had not acquired |
| 3 | Acquisition with Progress | read_page | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 1703 | read_page: the first read of this page state |
| 4 | Bookkeeping | record_evidence, record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 8739 | record_evidence, record_candidate |
| 5 | Bookkeeping | record_candidate | https://www.eurostar.com/uk-en/travel-info/travel-planning/luggage | 5012 | record_candidate |
| 6 | Finalization | — | — | 11884 | the reserved Answer |

### superseded-voyager-interstellar--initial (initial)

- answered; ended done / completed (budget_exhausted); tier investigation; 24 of 24 Tool Rounds used; 25 orchestrator rounds, 1 in Finalization; Run duration 329808 ms; LLM stage 291431 ms over 25 joined round(s)
- grade pass; checks unsatisfied: none
- verified, or failing only on unasked facts: verified
- 0 Subagent round(s) over 0 Subagent(s); 4 accepted (0 merged, a floor) and 1 rejected Evidence Checkpoint(s); 0 inherited round(s); 0 Held Page round(s) without Progress; 2 bundled checkpoint round(s); 0 same-source unsupported round(s); subagent citations: 0 excerpt_unsupported, 0 applied with a dropped excerpt, 0 refused for a wall or error source, 0 applied under no finding's address; 0 walled round(s)
- Delegated Page rounds: 0 while running, 0 while finished and uncollected, 0 after collection
- Tier shadow: investigation at 1.00 against the declared investigation (agrees); garbled 0.05
- Malformed Answers: 0 (0 retried)
- Off-language Answers: 0
- Sentences spoken early: 0 (0 second utterance(s), 0 stood for an Answer not its own)
- Cards published early: 0 (0 Answer(s) out of field order, 0 Answer Tail(s) fell back)
- Transport Failures: 0 Transport Failure attempt(s) (0 round(s) recovered by a Transport Retry, 0 Run(s) model_unreachable)
- Finalization: 1 bookkeeping round(s) skipped, 0 round(s) cut by the Finalization Allowance
- Asked Items: 7 declared; Answer standings 7 stated, 0 unverified; 0 shape failure(s) (0 retried)
- navigates that landed on a Not-found Page: 1 (round 1)
- of those, judged Off-key by the reviewer: 1
- Composed Addresses rewritten into a site search: 3 (round 2, 5, 20)
- of the rewrites, judged Off-key by the reviewer: 2
- of the rewrites, to an address the Run was shown, whole or cut: 0
- searches that ran with an Unseen Phrase unquoted: 5 (round 3, 9, 10, 14, 15)
- of those, judged Off-key by the reviewer: 4
- searches that ran on the Run Engine in place of another Web Engine: 0
- of those, judged Off-key by the reviewer: 0
- Result Picks: 2 (round 2, 9); listings returned to the model: 9 (round 3, 5, 6, 10, 13, 14, 15, 19, 20)
- Evidence Checkpoints the Run made from a Selected Passage: 0; recorded again by the model from the same page: 0; with the same passage: 0; record_evidence calls by the model: 5; bookkeeping-only rounds: 2
- Run-made checkpoints whose passage a later record of the model's contains: 0; cited in the Answer's evidence_ids: 0
- accepted records answered with the contradiction Note: 0
- rounds from a search to an opened result: 1, 2, none, 2, 1, 2, none, none, 2, none, 2
- Identity Slips: 0 Answer(s) with an Identity Slip, 0 id(s) slipped
- kinds: Acquisition with Progress 18 (75%) · Acquisition without Progress 4 (17%) · Collection 0 (0%) · Bookkeeping 2 (8%) · Failed round 0 (0%) · Finalization 1 (4%)
- search source rail: the rail’s own Search Observations, the streak replayed by its rule
- navigate searches by Search URL form: q 11, param 0, path 0
- Blocked Actions covered 0, not shown 0, inert clicks 0; inside a Search Loop streak, holding it: 0; post-block vision rounds 0; recovery rounds by block none
- Unavailable Landings by status 0, by title 0; followed by a search: 0
- Empty Landings 0; followed by a search: 0; read with text: 0
- page arrivals by a click, a type or a step through history 0; showed no text: 0; Unfinished Loads: 0
- consent walls: dismissals 0, hand consent clicks 0, blocked then hand consent 0
- window opens: followed 0, denied 0
- Tier Escalations: none fired; declined at the budget: no_tier_above (after round 24, replay: no judged call)
- reads refused as past the end: 0
- landings that carried no page: 0
- bookkeeping rounds right before the Answer: 2 (round 23, 24)
- bookkeeping rounds right before the cut: 0
- Answer Checkpoints: 1 offered in 1 Answer(s), 1 accepted, 0 dropped
- **verdict: rounds wasted** — The Run passed, but it spent its whole budget and roughly a fifth of it brought nothing new: rounds 1 (JPL 404), 9 (re-open of https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/, already acquired at round 2), and the three-search loop at 13–15 — 5 of 24 budgeted rounds (~21%) after the round-13 overrule, with round 19 additionally burning a rejected Evidence Checkpoint. Ten of the 22 Acquisition rounds (1, 3, 5, 6, 10, 13, 14, 15, 19, 20, ~45%) settled on a 404 or a DuckDuckGo results listing, and repeated app rewrites of composed nasa.gov/science.nasa.gov addresses (rounds 2, 5, 20) turned direct navigations into further results pages. The two verified official accounts were only read at rounds 18 and 22, leaving rounds 23–24 to record them right at the budget wall.
- stopped early: no — The attempt ran to its budget (24 of 24 Tool Rounds, ended budget_exhausted), and the Grade lists no unsatisfied checks, so there is no check to assign and no early stop.
- answer omitted: no — The Grade is a pass with no unsatisfied checks, so there is nothing the Answer left unstated for this judgement to name.
- Search Loop over rounds 13, 14, 15: Round 13 (site:science.nasa.gov voyager 1 interstellar June 2013), round 14 (site:jpl.nasa.gov news interstellar connection Voyager, streak 2) and round 15 (NASA statement June 2013 ... Webber, streak 3) are three consecutive searches with nothing opened between them — each settled on a DuckDuckGo results page with no Result Pick, so no page, user answer or Subagent Report intervened. The loop ends at round 16, which opened https://science.nasa.gov/missions/voyager-program/nasa-voyager-status-update-on-voyager-1-location/.
- Off-key round 1 (https://www.jpl.nasa.gov/news/nasa-voyager-team-says-spacecraft-has-not-yet-left-the-solar-system): Landed on a JPL 404 (Not-found page). A not-found shell renders no release text, so it can carry no required fact of this task.
- Off-key round 3 (https://duckduckgo.com/?q=Voyager+1+enters+new+region+solar+system+June+2013+site%3Ajpl.nasa.gov&ia=web): Settled on a DuckDuckGo results listing. A results page holds only link labels and snippets of other pages, not the official release text the task's facts live in. Borderline: it led directly to the on-key page opened at round 4.
- Off-key round 5 (https://duckduckgo.com/?q=press+release+nasa+confirms+voyager+has+entered+interstellar+space+site%3Anasa.gov&ia=web): The composed nasa.gov address was rewritten into a site search and the settled state is a DuckDuckGo results listing — no release page was opened, so no required fact could be carried.
- Off-key round 6 (https://duckduckgo.com/?q=Voyager+1+interstellar+space+September+2013+press+release+plasma+oscillations+site%3Ajpl.nasa.gov&ia=web): Settled on a DuckDuckGo results listing; a results surface carries none of the key's facts. Borderline: it immediately yielded the September account opened at round 7.
- Off-key round 10 (https://duckduckgo.com/?q=%22Voyager%22+site%3Anasa.gov+June+27%2C+2013+interstellar&ia=web): Settled on a DuckDuckGo results listing with no Result Pick; no official account text was put in front of the assistant.
- Off-key round 13 (https://duckduckgo.com/?q=site%3Ascience.nasa.gov+voyager+1+interstellar+June+2013&ia=web): DuckDuckGo results listing, and the first member of the 13–15 loop; a results surface can carry none of the required facts.
- Off-key round 14 (https://duckduckgo.com/?q=site%3Ajpl.nasa.gov+news+interstellar+connection+Voyager&ia=web): DuckDuckGo results listing inside the 13–15 loop; nothing on it can carry a required fact.
- Off-key round 15 (https://duckduckgo.com/?q=NASA+statement+June+2013+Voyager+1+not+left+the+solar+system+Webber&ia=web): DuckDuckGo results listing inside the 13–15 loop; nothing on it can carry a required fact.
- Off-key round 19 (https://duckduckgo.com/?q=site%3Ascience.nasa.gov+voyager+spacecraft+embarks+historic+journey+interstellar+space&ia=web): Settled on a DuckDuckGo results listing. Borderline: the round also spent a rejected Evidence Checkpoint, and the listing contributed only a mirror path that the app rewrote again at round 20.
- Off-key round 20 (https://duckduckgo.com/?q=missions+voyager+program+nasa+spacecraft+embarks+on+historic+journey+into+interstellar+space+site%3Anasa.gov&ia=web): The science.nasa.gov mirror address was rewritten into a site search; the settled state is a results listing, which carries none of the required facts.
- overrule round 13 → Acquisition without Progress: Mechanically scored with Progress because the DuckDuckGo results page was a page state this Run had not acquired, and the app's streak counter started at 1 here. On the evidence it is the first member of the 13–15 Search Loop: nothing was opened between it and round 14 or between 14 and 15, so it brought no new material and belongs with the other two members as Acquisition without Progress.
- flag (round 9): Rounds 9 and 10 are consecutive searches whose only intervening opening was round 9's Result Pick onto a page the Run had already acquired at round 2 — should that re-open count as something new put in front of the assistant, or should 9–10 be read as a second two-search loop?
- flag (round 13): Is the overrule of round 13 to Acquisition without Progress right, given the app's own streak counter treated it as the loop's trigger rather than a member?
- flag (round 3): Should an intermediate results listing that directly produced the correct official release in the very next round (3→4, 6→7) be called Off-key at all, or treated as necessary navigation?
- flag (round 19): Round 19 mixes a rejected Evidence Checkpoint with a search that settled on a results page — is Acquisition with Progress the right kind, or should the round be scored on the failed checkpoint and the fruitless listing?
- flag (round 24): Round 24 is the last bookkeeping round before the reserved Answer; should it have been scored Finalization and placed outside the budget rather than counted as a budgeted bookkeeping round?
- flag (round 15): With a passing Grade and the budget fully consumed, is rounds_wasted the decisive verdict, or was this on-key work that the investigation tier's 24 rounds merely ended (tier_too_small_or_never_escalated)?
- reviewer claude-opus-5 at high, prompt audit-p4, digest sha256:28f8da63…, $0.52

| round | kind | tools | page | ms | note |
| --- | --- | --- | --- | --- | --- |
| 1 | Acquisition without Progress | report_run_plan, navigate | https://www.jpl.nasa.gov/news/nasa-voyager-team-says-spacecraft-has-not-yet-left… | 17363 | navigate: landed on a Not-found Page [not found, off-key] |
| 2 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 1811 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, result pick] |
| 3 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=Voyager+1+enters+new+region+solar+system+June+2013+sit… | 59862 | navigate: the settled page state moved to a page this Run had not acquired [unquoted, off-key] |
| 4 | Acquisition with Progress | navigate, record_evidence | https://www.jpl.nasa.gov/news/nasa-voyager-1-encounters-new-region-in-deep-space… | 3576 | navigate: the settled page state moved to a page this Run had not acquired |
| 5 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=press+release+nasa+confirms+voyager+has+entered+inters… | 1596 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 6 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=Voyager+1+interstellar+space+September+2013+press+rele… | 2085 | navigate: the settled page state moved to a page this Run had not acquired [off-key] |
| 7 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 1413 | navigate: the settled page state moved to a page this Run had not acquired |
| 8 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasa-spacecraft-embarks-on-historic-journey-into-i… | 3900 | read_page: the first read of this page state |
| 9 | Acquisition without Progress | navigate, record_evidence | https://www.jpl.nasa.gov/news/nasa-voyager-status-update-on-voyager-1-location/ | 22512 | navigate: a navigate to a URL this Run already acquired [unquoted, result pick] |
| 10 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=%22Voyager%22+site%3Anasa.gov+June+27%2C+2013+interste… | 1707 | navigate: the settled page state moved to a page this Run had not acquired [unquoted, off-key] |
| 11 | Acquisition with Progress | navigate | https://www.nasa.gov/solar-system/the-voyage-to-interstellar-space/ | 1465 | navigate: the settled page state moved to a page this Run had not acquired |
| 12 | Acquisition with Progress | read_page | https://www.nasa.gov/solar-system/the-voyage-to-interstellar-space/ | 1269 | read_page: the first read of this page state |
| 13 | Acquisition with Progress → Acquisition without Progress | navigate | https://duckduckgo.com/?q=site%3Ascience.nasa.gov+voyager+1+interstellar+June+20… | 8355 | navigate: the settled page state moved to a page this Run had not acquired [off-key, search loop, loop head by the streak rule] |
| 14 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=site%3Ajpl.nasa.gov+news+interstellar+connection+Voyag… | 3906 | navigate: a search after a search with nothing opened between them (streak 2) [unquoted, off-key, search loop] |
| 15 | Acquisition without Progress | navigate | https://duckduckgo.com/?q=NASA+statement+June+2013+Voyager+1+not+left+the+solar+… | 9636 | navigate: a search after a search with nothing opened between them (streak 3) [unquoted, off-key, search loop] |
| 16 | Acquisition with Progress | navigate | https://science.nasa.gov/missions/voyager-program/nasa-voyager-status-update-on-… | 11834 | navigate: the settled page state moved to a page this Run had not acquired |
| 17 | Acquisition with Progress | navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 8047 | navigate: the settled page state moved to a page this Run had not acquired |
| 18 | Acquisition with Progress | read_page | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 1368 | read_page: the first read of this page state |
| 19 | Acquisition with Progress | record_evidence, navigate | https://www.jpl.nasa.gov/news/nasas-voyager-1-explores-final-frontier-of-our-sol… | 24917 | navigate: the settled page state moved to a page this Run had not acquired [off-key, 1 rejected checkpoint] |
| 20 | Acquisition with Progress | navigate | https://duckduckgo.com/?q=missions+voyager+program+nasa+spacecraft+embarks+on+hi… | 6834 | navigate: the settled page state moved to a page this Run had not acquired [rewritten, off-key] |
| 21 | Acquisition with Progress | navigate | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 5484 | navigate: the settled page state moved to a page this Run had not acquired |
| 22 | Acquisition with Progress | read_page | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 8460 | read_page: the first read of this page state |
| 23 | Bookkeeping | record_evidence | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 38172 | record_evidence |
| 24 | Bookkeeping | record_evidence | https://www.nasa.gov/news-release/nasa-spacecraft-embarks-on-historic-journey-in… | 29054 | record_evidence |
| 25 | Finalization | — | — | 16805 | the reserved Answer |

