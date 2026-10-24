# Yield: what to work on next

The highest-yield item is the most common scenario the owner is in on a
normal day of spoken use, weighted by how far that scenario is from ideal.
Ideal is: the scenario ends done, right, in one hop, within the reaction,
with the right thing said. Yield is never the most recurring line in the
Failed Lines ledger or the decision logs. Those record what was tested on
the day and say *how* a scenario breaks; they never say how much it weighs.
Ruled by the owner on 2026-10-23.

## Terms

- **User**: the owner, on a normal day, using the app as the appliance it
  is meant to be. Not a test session, not an imagined public.
- **Scenario**: a situation, the page or state the user is in plus what
  they want from it. The command is part of it, not the whole of it. A
  scenario may name a site, because the owner's day does; the fix for it
  is still built by kind for every page of that kind, never for the site.
- **Common**: frequency over a normal day of intended use. A
  once-per-session scenario counts once per session.
- **Distance from ideal**: how far the scenario is from done, right, one
  hop, within the reaction, the right thing said. A scenario in state
  `works` has zero distance and zero yield, however often it happens.
  Speed counts only when it is missed: a scenario over the reaction, or
  taking more hops than it needs, is `slow` and carries distance. Nothing
  is worked on for being faster than the reaction. So the list never
  parks on the most frequent scenario; it parks on the most frequent
  scenario that is not yet right, and when every scenario is `works` the
  answer to "what next" is that nothing is broken on a normal day.
- **Yield**: common × distance from ideal. Effort breaks ties only; it is
  never a factor, or every ranking collapses back to small fixes.
- **Missing**: a daily scenario the app has no road for. It is on the list
  and competes on the same terms; otherwise the rule can only polish what
  exists.
- **Spoken**: the user speaks. Typed lines are the agent's instrument for
  reproducing a spoken scenario, not a scenario in their own right.

## States

Every scenario carries one state and the dated evidence that set it. Each
state has a distance from ideal:

| state | meaning | distance |
|---|---|---|
| `works` | ends done, right, within the reaction | 0 |
| `slow` | right, but over the reaction or more hops than needed | 1 |
| `partly` | right some of the time, or on some pages of the kind, not others | 2 |
| `breaks` | ends wrong, unsure, silent or at the cap | 3 |
| `missing` | no road exists | 4 |
| `undated` | not reproduced; no distance until it is | none |

**Yield is per-day × distance.** It is the one number that says what is
most important: the list is sorted by yield, highest first, so the first
line is the most important and the last the least. A scenario with yield
0 is right on a normal day and is not worked on. An `undated` scenario
has no yield until it is reproduced and sits at the end, marked so.

A state is set by reproducing the scenario: the CLI harness under Xvfb
(`pnpm cli`, the CLI harness in AGENTS.md, under Xvfb as the Testing section
requires) or a spoken
session where one can be had. The ledger and the logs are the evidence of
*how*, cited by line id. A state read from the logs alone without a
reproduction is `undated`.

## The list

Sorted by yield, highest first. Scenarios are named by a short word, not
by position, since position changes as states change. The owner sets the
per-day counts; the counts here are the agent's first guess (2026-10-23)
until the owner does. The state and its evidence are set by reproduction
(see States). Where a per-day count is a guess, so is the yield.

| scenario | on a normal day | per day | state | distance | yield | evidence |
|---|---|---|---|---|---|---|
| play | play something by words | ~10 | `partly`, names misheard | 2 | 20 | typed road right on main 413191a9 (rerun 2026-10-23): `play highs and lows pomme kanye west` and `play let down by radiohead` each one call, the Pomme version found (cli-1-mvl5z511, cli-2-mvl5zoco); the distance is the mishear, stt lines turn-mvi5bacg-7 (a name on no page), turn-mvjue289-g and turn-mvk6o6wh-2 (an Early Fire on a partial's words); `BINGBONG_AUDIO_DUMP=1` is on in the root `.env` since 2026-10-23, so the next spoken session is the first replayable one |
| question | ask a question and get an answer: weather, a fact, a how-to | ~5 | `partly` | 2 | 10 | rerun 2026-10-24 on main 20f843b5 (Mammoth, CLI harness), 7 of 8 said: the time and the weather at home by the appliance in one call, say_time and say_weather 0.99 (cli-15-mvm5zi6m, cli-16-mvm5zxow); London from the watch page is now the home weather, one call in 0.8 s (cli-20-mvm61f4w); Gurgaon from the watch page 2 calls, passage 0.94 (turn-mvm60nv2-h); posthumous 2 calls, 0.99 (turn-mvm621pi-i); the passport fee 2 calls, 0.80 (turn-mvm62sf8-j); `how do i install it` on the Playwright README 2 calls, passage 0.81 said, but the Verdict hop also clicks `Copy code to clipboard` at 0.67 (turn-mvm6468f-m). Still breaking: `show me the BBC weather forecast for London` lands on BBC Weather in 3 calls and ends done with nothing said, passage none 0.64 (turn-mvm63gpl-l, as turn-mvl575cq-3) |
| open | open a site or page by name | ~5 | `partly` | 2 | 10 | rerun 2026-10-24 on main 20f843b5 (Mammoth, CLI harness), 4 of 7 right: `Go to the home page` 3 calls, click-3 at 0.94 (cli-2-mvm5uil0); `open voice studio github` 4 calls, search then debpalash/VoiceStudio at 0.75 (cli-7-mvm5w9b7); `Open Elon Musk's latest tweet` now done in 4 calls on an x.com status page, no sign-in wall (cli-11-mvm5y330); `Open Donald Trump's Truth Social profile` now done in 4 calls on truthsocial.com/@realDonaldTrump (cli-13-mvm5ysms). Breaking: `Open the first video` on the YouTube home page still clicks the consent prompt's `Update settings` at 0.40 and ends unsure after 5 calls on consent.youtube.com (cli-3-mvm5uy2u, as cli-3-mvl5jmek); `open voicestudio` still navigates at 0.58 to an empty voicestudio.com and reads it done (cli-5-mvm5vjrc); `open the first headline` on the Guardian front page, done on 76e1516f, now ends wall: the landing's consent rule clicks `[5] Accept personalised advertising…` and the sheet stays, 3 of 3, bisected to #414 6486d6e1 (cli-9-mvm5xdjh) |
| read | read or move through the page open: scroll, read it, show the part about X | ~5 | `partly` | 2 | 10 | rerun 2026-10-24 on main 20f843b5 (Mammoth, CLI harness): `scroll down` and `read` by grammar (cli-30-mvm65bat, cli-31-mvm65hi3); `show me the part about his death` on Alan Turing's article done in 3 calls, about 5 s, passage 0.89 said: `Toggle the table of contents` at 0.51 opens the folded contents, then Death at 0.99 (cli-32-mvm65npd), down from 5 calls on 552774da; the Reddit sidebar line cannot be reproduced in the harness (a 958-px pane shows no sidebar), turn-mvixu07l-1 stands |
| setting | change a player setting on the watch page: captions, ambient, speed, full screen | ~3 | `partly` | 2 | 6 | rerun 2026-10-23 on main 76e1516f, 6 of 7 right: `turn off captions` 2 calls, `go full screen` 2, `exit full screen` 3, `turn off ambient mode` 2, `set the speed to 1.5` one call through rate-10 at 0.98, 1× → 1.5× (cli-3-mvlijptw, cli-6-mvliljn8, cli-7-mvlilz54, cli-5-mvlikwf4, cli-8-mvlimelv); `turn on ambient mode` done but in 4 calls, Settings, a stray `Cinema mode`, Settings again, then Ambient mode at 0.89 (cli-4-mvlik972); `turn on captions` clicks the switch at 0.99 (the video has no caption track) and the Verdict never ends it, cap after 7 calls (cli-2-mvlij6h0, as turn-mvl5rcjb-1) |
| wall | get past a wall: cookie banner, pop-up, consent-or-pay, sign-in | ~3, every new site | `partly` | 2 | 6 | rerun 2026-10-24 on main 20f843b5: the Guardian's consent-or-pay wall, cleared on landing by its free `Accept all` on 76e1516f (cli-17-mvli90wg), is no longer cleared: the consent rule clicks `[5] Accept personalised advertising…` and the sheet stays, bisected to #414 6486d6e1 (cli-9-mvm5xdjh); rerun 2026-10-23 on main 76e1516f: bbcgoodfood's `accept cookies` ends done in 3 calls, but Jev clicks the purpose accordion `Store and/or access information on a device` at 0.47 and the controller's accept clears the wall (cli-20-mvlia6q4, as cli-23-mvlgc13o: the card lacks the wall's own buttons); w3schools' `decline the cookies` clicks Decline at 0.99, the sheet is read before it leaves, the next hop clicks `Preferences` and ends wall (cli-22-mvliaze4, as cli-2-mvl5q7g8); YouTube's consent prompt is still clicked as a target, not cleared (cli-16-mvli8hj8). BBC's `Accept additional cookies` banner cleared on main 413191a9, not rerun |
| search | search for something, on the web or on the site open, and land on it | ~5 | `slow` | 1 | 5 | 5 of 5 land: `Search MKBHD` and `Search Linus Tech Tips` on the watch page through the search-4 op, 3 calls, 5 s; `search linus tech tips` and `Search What is the weather in London` from about:blank in 2 calls (rerun 2026-10-23 on main 413191a9); `Look up the Alan Turing wikipedia page`, which died on the card there, is done on main 552774da in 3 calls, about 5 s (search, click-22 at 0.87, Verdict yes 0.99; turn-mvle2l6p-3). The distance is the hops: a named page is two calls after its search |
| wake | the first line after wake | ~5 sessions | `slow` | 1 | 5 | STT 4.3 s cold (turn-mvjubu0t-1), decision host 1.2 s cold (turn-mvk6o0er-1); spoken only, not reproducible in the harness |
| scale | weigh in on the scale | 1 | `partly` | 2 | 2 | links missed 2026-10-23, #397 |
| control | control what is playing: pause, resume, next, loop, seek, volume | ~10 | `works` | 0 | 0 | rerun 2026-10-23 on main 76e1516f (Mammoth, CLI harness): `pause` and `resume` by grammar; every volume line one call, read the right way and landing where set: `turn it down a bit more` 43% → 38%, `make it less loud` → 33%, `a little louder` → 38%, `turn the volume down` → 33%, volume-10 at 0.96 to 0.99 (cli-4-mvli4nmo to cli-7-mvli5mik; the old lines cli-10-mvle4zz8, cli-11-mvle59a0, cli-12-mvle5ikw fixed by #408); `skip ahead 10 seconds` one call at 0.99, 0:04 → 0:14 (cli-8-mvli5y58). `loop the video`, `go back 30 seconds`, mute and unmute were right on main 413191a9 and not rerun |
| idle | glance at the Idle Screen: news, weather, calendar, now playing | passive | `works` | 0 | 0 | shot:idle |
| timer | kitchen timer: set, how long left, stop | ~2 | `works` | 0 | 0 | rerun 2026-10-23 on main 413191a9: `set a timer for 5 minutes` and `stop the timer` by grammar; `how long is left on the timer` said by the appliance, say_timer 1.00 in 0.45 s: "4 minutes 51 seconds left on the timer" (cli-2-mvl5xp2s) |
| panel | control the app itself: hide a panel, open settings | ? | `missing` | 4 | ? | rerun 2026-10-23 on main 76e1516f: `hide the activity panel` has no road, none 0.50 and the Where Ask none 0.69 (cli-13-mvli7ovc); `open settings` is now Jev's navigate at 0.73 to settings.com, then a `back` that cannot go back, ends wall (cli-12-mvli71n8); yield waits on the owner's count |

The four rerun deaths on main 413191a9 from a hop card over about 54k chars (turn-mvl59cdi-1, turn-mvl5dtuv-4, turn-mvl5g89b-4, turn-mvl5kpp9-1) all end done on main 552774da, after the Card Budget (#406) and #407; their rows above carry the new evidence.

## The statement

Every "work on this next", every triage order and every audit order
carries this, in this order:

1. **Scenario**: which one, by its name.
2. **Place**: its yield, the per-day count and distance behind it, and
   what sits above it.
3. **State**: the scenario's state, with the dated evidence and the ledger line
   ids that show how it breaks.
4. **Change**: what the one change does to the scenario's state and to the
   other scenarios it touches.

An item that cannot be stated this way is not a yield claim. Ledger line
counts, log frequencies and stage totals may appear under 3, never under 2.

## Maintenance

- The owner sets the per-day counts and strikes scenarios. Agents never
  change a count; they change a state only with new dated evidence, and
  the sort follows.
- An agent that meets a daily scenario not on the list adds it at the
  end, state `undated`, and says so in its report.
- A state changes only with new dated evidence: a reproduction, a ledger
  line, a corpus case. The old evidence is replaced, not appended.
- A fix issue names the scenario it serves in its body, beside the ledger
  lines it claims (`docs/agents/bugs.md`).
