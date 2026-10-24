# ADR 0091: The app itself is on the card — its panel, views and settings offered by kind

## Status

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
  - the views: the dashboard, the Weight page, and Settings at any of
    its sections;
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
