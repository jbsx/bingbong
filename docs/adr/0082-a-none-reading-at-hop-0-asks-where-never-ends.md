# ADR 0082: A `none` reading at hop 0 asks where, never ends

## Status

Accepted on 2026-10-21 by the owner, grilled from the 14:25 live run's
"Turn on ambient mode." (ledger `turn-mvhzumpr-h`, `turn-mvi5ajrz-4`) and
the #363 live check's "open page information" on Wikipedia (ledger
`cli-3-mvihhicn`). Amends ADR 0076's "A Task ends" clause for hop 0 and
widens ADR 0079's "a Task looks before it gives up" to the moment before
the first action. The Question class ("what's the weather like in
gurgaon") is not this decision: it shares the `none` reading and nothing
after it, and is grilled on its own. Amended on 2026-10-21 by ADR 0084: a
second `none` makes a Mark Ask before it ends, when a Textless Ref is on
the card. Amended on 2026-10-22 by #394: the Where Ask's call carries the
Verdict, and a sure `yes` beside an action ends the Task done on the page
as it is.

## Context

"Turn on ambient mode." on a YouTube watch page read `none` 0.51 and 0.55
over the Settings click 0.33 and 0.20, with the gear's line reading
`button "Settings" hasPopup=menu expanded=false`: the card carried the
fact and Jev still read no command. "Open page information" on a
Wikipedia article read `none` 0.21 over the Tools click 0.17. Each ended
"No response." and no Task started. In all three the words name a thing
one control away, behind a menu the page does not show until opened.

The card-wording fix was measured and rejected (post mortem 2026-10-21):
"when the words name a setting the page does not show, a `hasPopup=menu`
ref is where it may be: choose its click, not none" lifts ambient mode to
0.53–0.59 and lures "turn on captions" from 0.08 to 0.40–0.48 on
Settings, because the first ask is every line's ask and a hint for the
hidden-target class reaches the lines whose target is shown.

## Decision

**A hop-0 reading whose top choice is `none`, at any probability, on a
line Jev read, is followed by one more Choice: the Where Ask.** The same
action card, every option it had, asked again with the question changed:
the words name something this page does not show; which action would
reveal it, or find it? Its `none` reads "a remark or noise, nothing to
look for". The Where Ask fires its best reading as hop 0's action, as any
hop 0 does under ADR 0076, with no bar; `search` is on the card as it is
and a hop-0 search does what it does today. The Task then goes on as
any Jev-read Task: hop 1 reads the opened menu's refs, the Verdict and the
Progress Noul are unchanged, and a dead end runs ADR 0079's rule, closing
what it opened and trying the runner-up once, the runner-up being the
Where Ask's. A Where Ask that reads `none` again ends the line as today,
"No response." with both readings in its reason; a Where Ask that is
unavailable ends the same way, since a hop never guesses. It runs only on
the Endpoint's reading, never on a partial; sequentially, after the first
reading, never speculatively beside it; at each Step's hop 0, a Step being
a Task. Nothing it finds is remembered: Jev decides each time.

**The first ask is untouched.** Its instructions and its `none` line stay
as measured; sure lines never see the Where Ask, so its question cannot
lure them.

## Amendment (#394): a page that already answers is kept

A question whose answer is already on screen reads `none` at hop 0. The
Where Ask then asks which action would reveal what the words name, as if
it were not shown, and fires its best click away from the answer: on
gov.uk passport fees, "how much is it to renew online" read `none` 0.46
over a card whose `Text in view` held the £102 fee, and the Where Ask
clicked "Renew or replace your adult passport" (0.60).

**The Where Ask's call carries the Verdict, worded as every later hop's. A
sure `yes` beside a Where Ask action ends the Task done on the page as it
is, before the action fires.** A Where Ask that reads `none` goes on as
above, whatever the Verdict says: noise reads as done when nothing was
asked ("Look." `yes` 0.76–0.79), and a `none` never ends as the page
already being what was asked (#370). The first reading still asks no
Verdict. Done-ness stays the Verdict's; no reading on the action card says
it.

Measured on 40 Where Ask cards: adding the Verdict moved no Where Ask
pick (0/40); passport `yes` 0.82–0.85 on three captures; every other sure
`yes` was beside a Where Ask `none`. A `none` past hop 0 already ends the
Task on the page as it is, so the Where Ask is the only place this class
left an answer.

Rejected on the way: rewording the first ask's `none` or `read` (every
variant moved 15–30 of 278 real asks, the uncertain non-questions with
them, such as "download it as an epub" → Download as PDF); and a `shown`
reading on the Where Ask (passport 0.77 and 4 of 36 picks moved, but a
done reading on the action card, against #370).

## Considered options

- **A hint on the first card.** Measured: lifts the hidden-target line
  under the bar and lures the shown-target line. Rejected.
- **A smaller second card of the refs that can reveal more by kind**
  (`hasPopup`, `expanded=false`, menus, tabs, details). Wikipedia's Tools
  dropdown is a checkbox in the accessibility tree; the filter hides it,
  and the next site hides the next. Rejected: a hand list by another name.
- **Asking both in parallel on every free-word line.** Saves ~250 ms on
  the lines that need it and doubles Jev's calls on every line it reads.
  Rejected.
- **Remembering the path found** (ambient mode is behind Settings on
  youtube.com). Site-shaped memory, against the owner's rule; the saving
  is one call. Rejected for now.

## Consequences

- One more Jev call, ~250 ms within the 800 ms cap, on lines that today
  end "No response.", noise included.
- Each Where Ask is its own decision record (`whereAsk: true`, as a
  runner-up is `runnerUp: true`) and its own entry in `asks-*.jsonl`; the
  first reading's record stays. A corpus case for a Where Ask passes when
  the expected opener is its top choice, not at the 0.7 bar.
- A Where Ask that opens nothing is an unchanged hop and is Set Aside by
  #336's rule; two in a row end the Task, as today.
