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

Every scenario carries one state and the dated evidence that set it:

| state | meaning |
|---|---|
| `works` | ends done, right, within the reaction |
| `slow` | right, but over the reaction or more hops than needed |
| `partly` | right on some pages of the kind, not others |
| `breaks` | ends wrong, unsure, silent or at the cap |
| `missing` | no road exists |
| `undated` | not reproduced; the state is a guess and the ranking says so |

A state is set by reproducing the scenario: the CLI harness under Xvfb
(`pnpm cli`, the CLI harness in AGENTS.md, under Xvfb as the Testing section
requires) or a spoken
session where one can be had. The ledger and the logs are the evidence of
*how*, cited by line id. A state read from the logs alone without a
reproduction is `undated`.

## The list

Each line of the table is one scenario; its number is its position, which
the owner sets. "Scenario 3" means the third line. Per-day counts are the
agent's first guess (2026-10-23) until the owner reorders; the owner's
order wins over any count.

| # | Scenario, on a normal day | per day | state | evidence |
|---|---|---|---|---|
| 1 | Play something by words | ~10 | works, mishears names | logs 2026-10-21/22, stt ledger lines |
| 2 | Control what is playing: pause, resume, next, loop, seek, volume | ~10 | works | Media Ops #372, the grammar |
| 3 | Search for something, on the web or on the site open, and land on it | ~5 | breaks | 4 of 27 multi-hop Tasks done, counted 2026-10-23 |
| 4 | Ask a question and get an answer: weather, a fact, a how-to | ~5 | missing | reads `none`, "No response" |
| 5 | Open a site or page by name | ~5 | breaks past one hop | 0 of 16 multi-hop Tasks done, counted 2026-10-23 |
| 6 | Read or move through the page open: scroll, read it, show the part about X | ~5 | works for scroll, breaks for "the part about" | cli-10-mvjkuljs |
| 7 | Change a player setting on the watch page: captions, ambient, speed, full screen | ~3 | works, slow | #388 menu holds, look-then-act #363 |
| 8 | Get past a wall: cookie banner, pop-up, consent-or-pay, sign-in | ~3, every new site | partly | Dismissal Ladder; cookie banners drag the Verdict (turn-mvjj8vg4-2) |
| 9 | First line after wake | once a session | slow | STT 4.3 s cold (turn-mvjubu0t-1), decision host 1.2 s cold (turn-mvk6o0er-1) |
| 10 | Kitchen timer: set, how long left, stop | ~2 | undated | not reproduced |
| 11 | Weigh in on the scale | 1 | breaks sometimes | scale links missed 2026-10-23 |
| 12 | Glance at the Idle Screen: news, weather, calendar, now playing | passive | works | shot:idle |

## The statement

Every "work on this next", every triage order and every audit order
carries this, in this order:

1. **Scenario**: which one, by number and name.
2. **Place**: where it sits on the list and the per-day count behind it.
3. **State**: the scenario's state, with the dated evidence and the ledger line
   ids that show how it breaks.
4. **Change**: what the one change does to the scenario's state and to the
   other scenarios it touches.

An item that cannot be stated this way is not a yield claim. Ledger line
counts, log frequencies and stage totals may appear under 3, never under 2.

## Maintenance

- The owner orders the list and strikes scenarios. Agents never reorder it.
- An agent that meets a daily scenario not on the list adds it at the
  end, state `undated`, and says so in its report.
- A state changes only with new dated evidence: a reproduction, a ledger
  line, a corpus case. The old evidence is replaced, not appended.
- A fix issue names the scenario it serves in its body, beside the ledger
  lines it claims (`docs/agents/bugs.md`).
