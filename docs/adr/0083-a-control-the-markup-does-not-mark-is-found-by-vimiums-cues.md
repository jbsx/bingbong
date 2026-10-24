# ADR 0083: A control the markup does not mark is found by Vimium's cues

## Status

Accepted on 2026-10-21 by the owner, grilled from #381 (the companion of
#380). Amends ADR 0007's selector-only collect. Leaves ADR 0062's
visibility rule as it is. Amended on 2026-10-22 by the owner's rulings on
#384 and #386, and on 2026-10-24 by the owner's rulings on #414.

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

One step is not Vimium's, ruled on #384. A weak cue that sits inside a
ref a click acts on whole (any `<a>`, a `button`, or one of #380's click
roles), at any depth and whatever its words, is dropped. Vimium keeps
that hint, since two markers on one button cost a person nothing and
either clicks it; on the card it is a second line for the same click, a
button's own icon or text span, with no words of its own, and a Textless
Ref that would gate the Mark Ask for nothing. The "one for one" above
binds which elements the collect finds, not how many lines one element
gets. A weak cue inside an Unmarked Control stays, as in Vimium: an
`onclick` or `jsaction` container may hold a distinct control of its own.

A second step is not Vimium's, ruled on #386. A `details` is acted on
through its summary: the first `summary` child of a `details` is the ref,
kinded `button` and labelled by its own text, and the `details` gives
none. Vimium hints the `details` and sets its `open` in script. We act
with a real click. Neither a click on the `details` nor its `click()`
toggles it, and on an open one the click lands in its body, so it could
be opened but never closed. The summary is the control the platform
makes: a click toggles it, and it carries the `expanded` state Ref State
reads. A `details` with no summary keeps the cue.

Two more cues are not Vimium's, ruled on #414. Both hold only inside the
open dialog's layer, and both are weak: an element that carries one is
dropped when a ref within the lookback is its descendant, or when it sits
inside a ref that takes a click whole. The first is an element whose only
cue is a `tabindex` of 0 or more. Vimium calls such an element a
second-class citizen and, on its current master, never hints it. The
second is an element the browser reports as clickable
(`DOMSnapshot.isClickable`), which means it has a click listener of its
own. publicholidays.co.uk's anti-adblock dialog closes on a
`<span tabindex="0">×</span>` and on a `<p>` reading "Continue without
supporting us" that has its own listener. Without them its only ref was
DISABLE, which leads further into the wall. The Dismissal Ladder was left
with Escape, which the dialog ignores. On a page a person sees such a
control and clicks it; over a dialog, leaving it off the card takes away
the way out. The layer is small and its refs come first, ahead of the cap,
so the card cost is bounded. Outside it, the page keeps Vimium's cues as
above.

The collect walks open shadow roots, for every ref kind, as Vimium does.
An Unmarked Control is kinded `button` and carries no flag on its line.
Marked elements take the collect's 400 places first. The cues run in
every Reachable Frame. The role list stays a superset of Vimium's.

Not taken outside a dialog's layer: `cursor: pointer` and listener
detection, which Vimium does not use; its `addEventListener` wrapper was disabled in 2018 after it broke
Google Payments (Vimium #2997). Not taken either: Vimium's visibility. Its
3×3 floor and occlusion test exist so a hint can be seen, while ours are
acted on; ADR 0062's rect rule and act-time Covered verdict stand.
Scrollable `div`/`ul`/`ol`/`body` are left out: a click does nothing for
them, and a "scroll this region" op is a separate decision.

## Consequences

- Outside a dialog's layer, a React or jQuery control with a delegated
  listener and no Vimium cue stays invisible, as it does to Vimium. Inside
  the layer, a listener of the element's own makes it a ref (#414). A
  delegated one still does not, unless it carries a `tabindex`.
- Measured on #414: the anti-adblock dialog gives 3 refs with the two cues
  and 1 without. `browser-collect` with a dialog open adds 0.6 ms to the
  median, against a ≤15 ms budget, and with no dialog open it adds
  nothing. The gate case from `turn-mvlq72ay-4` passes on every gate
  model, and no case that passed before is lost.
- The collect gains a cost, budgeted at ≤15 ms added to the median
  `browser-collect` on a YouTube watch page and a news front page; the
  shadow-root walk counts against it.
- The drop is measured, not assumed (2026-10-22, headless Chrome, the
  first viewport, each page clean of its wall): a YouTube watch page
  gives 48 refs with the step and 65 without, the 17 dropped all a
  button's own icon (14, no words) or text span (3, words within the
  button's own); the BBC News and Guardian fronts give 45 and 48 either
  way. It costs no measurable collect time. A dropped line that was a
  distinct control would be a ledger miss and reopens this paragraph.
- A pointer `div` with none of these cues is not a ref. That is Vimium's
  own false negative, accepted.
- Three more of Vimium's reaches were measured on 2026-10-22 and left out
  until a ledger line shows one. The first is a link whose own box is
  empty but whose floated or absolutely positioned child shows (Vimium's
  child-rect test). The second is an inline link at `font-size: 0`. The
  third is an image map's `area`s, which have no box and which the
  accessibility tree ignores. In headless Chrome, the first two occurred
  nowhere, on the whole page, across eleven live pages (BBC News, the
  Guardian, YouTube, Amazon, Wikipedia, HN, GitHub, Stack Overflow, IKEA,
  GOV.UK, Booking). An image map occurred once in fifteen pages.
- How such a ref is labelled when it has no text is ADR 0084.
