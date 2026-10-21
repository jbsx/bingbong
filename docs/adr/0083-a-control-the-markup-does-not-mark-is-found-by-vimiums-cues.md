# ADR 0083: A control the markup does not mark is found by Vimium's cues

## Status

Accepted on 2026-10-21 by the owner, grilled from #381 (the companion of
#380). Amends ADR 0007's selector-only collect. Leaves ADR 0062's
visibility rule as it is.

## Context

The collector takes tags and ARIA roles only (#380 widened the roles). A
hand-built site marks controls for the eye, not for the tree: a `div` with
an `onclick`, a `span` styled as a button, Google's `jsaction`. Those never
became refs, so Jev was never offered them. The candidates were computed
`cursor: pointer` (Surfingkeys, browser-use), click-listener detection (a
main-world `addEventListener` wrapper, or CDP's `getEventListeners` /
`DOMSnapshot.isClickable`), and Vimium's link-hint cues.

## Decision

The owner ruled:

> in my personal experience vimium works flawlessly. dont try to fix what works. replicate vimiums behaviour as closly as possible

The collect adds the cues of Vimium's `getLocalHintsForElement`, one for
one: `onclick`; Angular `ng-click` and its variants, only on a page with an
`.ng-scope`; a `jsaction` with a click event; `contenteditable`; the tags
`details`, `object` and `embed`; a `label` whose control is not itself a
ref; an `img` with a zoom cursor. A `button`/`btn` class and every `span`
are weak cues, dropped when a ref within Vimium's lookback (the 6 before
it, 3 levels up) is its descendant; strong cues nest freely. `tabindex`
alone gives no ref, and `aria-disabled="true"` vetoes one.

The collect walks open shadow roots, for every ref kind, as Vimium does.
An Unmarked Control is kinded `button` and carries no flag on its line.
Marked elements take the collect's 400 places first. The cues run in
every Reachable Frame. The role list stays a superset of Vimium's.

Not taken: `cursor: pointer` and listener detection, which Vimium does not
use; its `addEventListener` wrapper was disabled in 2018 after it broke
Google Payments (Vimium #2997). Not taken either: Vimium's visibility. Its
3×3 floor and occlusion test exist so a hint can be seen, while ours are
acted on; ADR 0062's rect rule and act-time Covered verdict stand.
Scrollable `div`/`ul`/`ol`/`body` are left out: a click does nothing for
them, and a "scroll this region" op is a separate decision.

## Consequences

- A React or jQuery control with a delegated listener and no Vimium cue
  stays invisible, as it does to Vimium. A ledger miss of that shape
  reopens the listener question, with `DOMSnapshot.isClickable` measured
  first.
- The collect gains a cost, budgeted at ≤15 ms added to the median
  `browser-collect` on a YouTube watch page and a news front page; the
  shadow-root walk counts against it.
- A pointer `div` with none of these cues is not a ref. That is Vimium's
  own false negative, accepted.
- How such a ref is labelled when it has no text is ADR 0084.
