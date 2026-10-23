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
| control | control what is playing: pause, resume, next, loop, seek, volume | ~10 | `partly`, volume lands wrong | 2 | 20 | pause, resume, mute, unmute by grammar and `skip ahead 10 seconds`, `loop the video`, `go back 30 seconds` one call at 0.97 to 1.00 (rerun 2026-10-23 on main 413191a9, control-yt); every volume line lands wrong on main 552774da (rerun 2026-10-23): Jev picks volume-10 at 0.96 to 0.99, then `turn it down a bit more` and `make it less loud` are read as up (to 53, to 33) and every set lands lower than asked, 43% → 23% → 14% → 10%, `a little louder` included (cli-10-mvle4zz8, cli-11-mvle59a0, cli-12-mvle5ikw, claimed by #408) |
| play | play something by words | ~10 | `partly`, names misheard | 2 | 20 | typed road right on main 413191a9 (rerun 2026-10-23): `play highs and lows pomme kanye west` and `play let down by radiohead` each one call, the Pomme version found (cli-1-mvl5z511, cli-2-mvl5zoco); the distance is the mishear, stt lines turn-mvi5bacg-7 (a name on no page), turn-mvjue289-g and turn-mvk6o6wh-2 (an Early Fire on a partial's words); `BINGBONG_AUDIO_DUMP=1` is on in the root `.env` since 2026-10-23, so the next spoken session is the first replayable one |
| question | ask a question and get an answer: weather, a fact, a how-to | ~5 | `partly` | 2 | 10 | rerun 2026-10-23 on main 552774da (Mammoth, CLI harness): the time and the weather at home said by the appliance in one call (cli-2-mvldxng4, cli-3-mvldxz2k); Gurgaon and London from the watch page done in 2 calls with the DuckDuckGo box said, passage 0.96 and 0.98 (turn-mvldyk6o-1, turn-mvldzs7x-1); `how do i install it` on the Playwright README no longer dies on the card: done in 2 calls, about 4 s, the passage said at 0.75, though the hop clicks `Copy code to clipboard` on the way (turn-mvle1uz1-1). Not rerun since main 413191a9: the BBC forecast ends done with nothing said, passage none 0.50 (turn-mvl575cq-3); posthumous and the passport fee said, 0.99 and 0.81 (turn-mvl56emb-1, turn-mvl589du-1) |
| open | open a site or page by name | ~5 | `partly` | 2 | 10 | `Open youtube` (grammar) and `Go to the home page` (3 calls) done (rerun 2026-10-23 on main 413191a9); `Open Voice Studio GitHub`, which died on the card there, is done on main 552774da in 3 calls, about 6 s (click-22 at 0.83, Verdict yes 0.99; turn-mvle3bio-5), as in the owner's typed run at 19:09 (turn-mvlabj98-4). Still breaking on main 413191a9: `Open Elon Musk's latest tweet` ends wall under x.com's sign-in sheet; `Open Donald Trump's Truth Social profile` ends wall at once on an empty dialog, no ladder tried (turn-mvl5h393-5); `Open the first video` on the home page clicks YouTube's consent prompt as a target (cli-3-mvl5jmek); the bare `open voicestudio` goes to the Local Match's voicestudio.com guess (turn-mvlab1ve-1, #408 item 5) |
| read | read or move through the page open: scroll, read it, show the part about X | ~5 | `partly` | 2 | 10 | `scroll down` and `read` fire by grammar (rerun 2026-10-23 on main 413191a9); `show me the part about his death` on Alan Turing's article, which died on the card there, is done on main 552774da with the passage said, but in 5 calls and about 8 s: show-11 at 0.35, then a stray click on `Toggle the table of contents` at 0.40, then the Death link at 0.97 (cli-8-mvle43gp, turn-mvle493u-9); the Reddit sidebar line cannot be reproduced in the harness (a 958-px pane shows no sidebar), turn-mvixu07l-1 stands |
| setting | change a player setting on the watch page: captions, ambient, speed, full screen | ~3 | `breaks` | 3 | 9 | rerun 2026-10-23 on main 413191a9, 0 of 5 right: `turn on captions` clicks the switch (the video has no caption track) and the Verdict never ends it, cap after 8 calls (turn-mvl5rcjb-1); `turn off captions` and `go full screen` are refused with the control bar hidden, covered and inert, and no op on the card fires them (cli-3-mvl5rubg, cli-6-mvl5to4w); `exit full screen` and `set the speed to 1.5` time out on Mammoth at 3000 ms (cli-7-mvl5u3n0). Ambient mode is not in this profile's Settings menu, so its two lines are not evidence |
| wall | get past a wall: cookie banner, pop-up, consent-or-pay, sign-in | ~3, every new site | `partly` | 2 | 6 | rerun 2026-10-23 on main 413191a9: BBC's `Accept additional cookies` banner is cleared on the way to the forecast; every consent-or-pay wall fails: the Guardian's reject rule picks `Reject all and subscribe` (cli-2-mvl5nd6w), bbcgoodfood's picks `Reject & Pay` after a purpose toggle (cli-2-mvl5p3xc), w3schools' Decline is clicked and the sheet read before it leaves (cli-2-mvl5q7g8); YouTube's consent prompt is clicked as a target, not cleared (cli-3-mvl5jmek) |
| search | search for something, on the web or on the site open, and land on it | ~5 | `slow` | 1 | 5 | 5 of 5 land: `Search MKBHD` and `Search Linus Tech Tips` on the watch page through the search-4 op, 3 calls, 5 s; `search linus tech tips` and `Search What is the weather in London` from about:blank in 2 calls (rerun 2026-10-23 on main 413191a9); `Look up the Alan Turing wikipedia page`, which died on the card there, is done on main 552774da in 3 calls, about 5 s (search, click-22 at 0.87, Verdict yes 0.99; turn-mvle2l6p-3). The distance is the hops: a named page is two calls after its search |
| wake | the first line after wake | ~5 sessions | `slow` | 1 | 5 | STT 4.3 s cold (turn-mvjubu0t-1), decision host 1.2 s cold (turn-mvk6o0er-1); spoken only, not reproducible in the harness |
| scale | weigh in on the scale | 1 | `partly` | 2 | 2 | links missed 2026-10-23, #397 |
| idle | glance at the Idle Screen: news, weather, calendar, now playing | passive | `works` | 0 | 0 | shot:idle |
| timer | kitchen timer: set, how long left, stop | ~2 | `works` | 0 | 0 | rerun 2026-10-23 on main 413191a9: `set a timer for 5 minutes` and `stop the timer` by grammar; `how long is left on the timer` said by the appliance, say_timer 1.00 in 0.45 s: "4 minutes 51 seconds left on the timer" (cli-2-mvl5xp2s) |
| panel | control the app itself: hide a panel, open settings | ? | `missing` | 4 | ? | rerun 2026-10-23 on main 413191a9: `hide the activity panel` has no road, none 0.95 and the Where Ask none (cli-4-mvl5y6wt); `open settings` matches the grammar's `open <site>` and navigates to settings.com (cli-5-mvl5yijf); yield waits on the owner's count |

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
