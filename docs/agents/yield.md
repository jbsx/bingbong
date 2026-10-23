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
| play | play something by words | ~10 | `partly`, names misheard | 2 | 20 | stt ledger lines 2026-10-21/22 |
| question | ask a question and get an answer: weather, a fact, a how-to | ~5 | `breaks` | 3 | 15 | rerun 2026-10-23 on main 17f82618, 9 lines: 5 end done, every done silent (cli-2-mvkw8yms); the time has no road (cli-2-mvkw7388); the slot drops the question 3 of 3 from YouTube (cli-2-mvkwji1f, cli-4-mvkwkang, cli-6-mvkwl3aw) |
| search | search for something, on the web or on the site open, and land on it | ~5 | `breaks` | 3 | 15 | 4 of 27 multi-hop Tasks done, counted 2026-10-23; #398 |
| open | open a site or page by name | ~5 | `breaks` | 3 | 15 | 0 of 16 multi-hop Tasks done, counted 2026-10-23 |
| read | read or move through the page open: scroll, read it, show the part about X | ~5 | `partly` | 2 | 10 | scroll works; cli-10-mvjkuljs |
| wall | get past a wall: cookie banner, pop-up, consent-or-pay, sign-in | ~3, every new site | `partly` | 2 | 6 | Dismissal Ladder; turn-mvjj8vg4-2, cli-2-mvjkzcdk |
| wake | the first line after wake | ~5 sessions | `slow` | 1 | 5 | STT 4.3 s cold (turn-mvjubu0t-1), decision host 1.2 s cold (turn-mvk6o0er-1) |
| setting | change a player setting on the watch page: captions, ambient, speed, full screen | ~3 | `slow` | 1 | 3 | #388 menu holds, look-then-act #363 |
| scale | weigh in on the scale | 1 | `partly` | 2 | 2 | links missed 2026-10-23, #397 |
| control | control what is playing: pause, resume, next, loop, seek, volume | ~10 | `works` | 0 | 0 | Media Ops #372, the grammar |
| idle | glance at the Idle Screen: news, weather, calendar, now playing | passive | `works` | 0 | 0 | shot:idle |
| timer | kitchen timer: set, how long left, stop | ~2 | `undated` | | | not reproduced |
| panel | control the app itself: hide a panel, open settings | ? | `undated` | | | turn-mvjugmqn-1e; not reproduced |

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
