# ADR 0091: The app itself is on the card — its panel, views and settings offered by kind

## Status

Amended on 2026-10-26 by #458 (the Idle Screen is one of the views) and
on 2026-10-27 by ADR 0096 (#485): the app's ops are on the Appliance Card
first; see the amendments below.

Accepted (#420 grill, 2026-10-24). Amends ADR 0021 and the Appliance Verb
entry in CONTEXT.md.

## Context

The card carried the browser pane and nothing of the app around it.
"hide the activity panel" read none on every model (cli-4-mvl5y6wt,
turn-mvjugmqn-1e), and "open settings" was read by the grammar as
`open <site>` and landed on the parked settings.com (cli-5-mvl5yijf).
None was a misreading: no option could have been right. The `panel`
scenario is ~3 a day, `missing`, yield 12.

## Decision

- **The app's own surfaces and settings are Appliance Verbs, offered by
  kind as ADR 0080 offers Media Ops.** Each line carries its current
  state, and every op its kind allows is offered, whatever the state:
  - the Feed panel: open, close, overlay, docked, and its width as an
    Amount Choice;
  - the views: the dashboard, the Weight page, Settings at any of its
    sections, and — while it is not up — the Idle Screen (#458,
    2026-10-26), its line just before the dashboard's as measured; its
    pick brings the Idle Screen up by the idle shortcut's road and says
    nothing, the screen its own receipt;
  - each setting, generated from the `AppSettings` shape, never listed
    by hand: a boolean gets on and off, an enum one op per value, a
    number an amount, text a Slot. Each op is one `settingsStore.update`;
    the sanitizer keeps its bounds.
- **A Command whose words ask for the panel may open it** (amends ADR
  0021). Every other Command still shows the Peek Card.
- **Hard policy: what voice may not change.** `micId`,
  `wakeWordThreshold`, `pauseCapMs`, `resumptionMergeMs`,
  `hotListenSilenceMs` and `sttEngine` (owner, 2026-10-24: a wrong
  value leaves voice unable to hear the line that would put it back),
  and the Environment section's values.
  The records (news topics and feeds, the Weight people, the usage
  dashboard, the scale's address) are edits of records, not values with
  a kind, and are out.
- **No navigation.** A change is one hop; Jev never has to open the
  Settings page to change a value.
- **The Answer** is a fixed sentence filled as it fires, naming the new
  value; shown and spoken, page untouched, as for an Appliance Fact. Not
  offered on the Where Ask.
- **One Reading** (ADR 0089): `open settings` and its kind now have two
  readings, so they go to Jev.

## Measured at build

- Every line on every card vs one `settings` line expanded on a second
  ask (ADR 0088's budget): a tie on `pnpm jev:gate`, cases grown from the
  three claimed lines and the asks log first.
- The wording of the state lines and the op lines: a tie on the gate.
- *Measured 2026-10-24: every setting's ops on every card lost four
  cases (long pages' further-down options pushed past the Card Budget);
  one `settings` line on the card, its ops on a second ask, lost none.
  That line is worded as measured: generated from the settings' names it
  lost two cases. A new setting is on the settings ask's card with no
  card code.*

## Guess

- A spoken weather city takes the geocoder's first match, and the
  Answer names the place picked. Cheapest to reverse; a line naming a
  place other than the one meant would settle it.

## Consequences

- The Appliance Verb set is no longer fixed and small: it grows with the
  app's own surfaces and settings, never per site.
- A setting added to `AppSettings` is on the card without a line of
  card code. Excluding one is a policy entry.

## Amendment 2026-10-27 — the app's ops are on the Appliance Card first (ADR 0096, #485)

The app's ops, the settings line and its settings ask are on the Appliance
Card first (ADR 0096).

## Amendment 2026-10-26 — the Idle Screen is one of the views (#458)

While the Idle Screen is not up, `show_idle` is offered with the views,
on any view and any page (built a56508fe). Its pick runs `enterIdle`, the
idle shortcut's road: the pane, the Player and the Last Page are kept,
and the Command keeps the Idle Screen up over the turn still running.
"Showing the Idle Screen." is shown in the Feed and never spoken. There
is no grammar line for it.

*Measured 2026-10-26 on `pnpm jev:gate`, Mammoth ∩ Elephant, 29 cases
(the 23 app-line cards, the four kiosk lines, and two lures, "Go to the
home page." meaning YouTube's Home and "Go back to YouTube."): the line
placed just before `show_dashboard` passed 28 of 29 and lost nothing.
Placed after it, or worded to name "home", Elephant lost
`app-show-the-weather-settings-youtube`.*

ADR 0096 overtook where the line is read. As built, it was on the page
card, the one action card; since #485 the app's ops, `show_idle` among
them, are read first on the Appliance Card, and on the page card only
when a line goes on to it. The line's wording and its place just before
`show_dashboard` are unchanged on both cards. Rechecked 2026-10-27 at
main 72851667 (one pass per gate model): the three "Go to Idle Screen"
lines are through on both cards, 6/6. "Go back to home page."
(turn-mvp4p39a-vn) is not: it names a site's home and the app's own
screen at once, and ADR 0096 records the pair as a pick and a guess.
