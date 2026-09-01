# Peek Card rides the panel overlay view

The Peek Card originally lived in an in-flow footer band because renderer DOM
cannot float above the browser pane's native `WebContentsView` — appearing
shrank the browsing row instead of overlaying it. We decided to render the card
from the Feed Panel's existing overlay `WebContentsView` (ADR 0004), the one
surface the app already stacks above the pane, as a translucent card floating
over the page with no reflow.

Three consequences follow from native-view mechanics and one product
constraint:

- **Alpha only, no frost.** True backdrop blur is impossible across native
  view boundaries (the finding behind the panel's near-opaque skin, ADR 0012).
  The card ships alpha-translucent (~0.92), slightly clearer than the panel's
  0.97 because a peek is glanceable, not readable-for-long.
- **The card replaces the Collapsed edge tab.** A `WebContentsView` intercepts
  mouse input across its entire bounds with no per-pixel click-through, so the
  overlay view shows exactly one element at a time — expanded panel, Peek
  Card, or edge tab — and its bounds shrink-wrap that element.
- **The card anchors bottom-center, away from the panel's right edge.** Card
  and panel never cover the same page region, so switching between them
  reveals the page beneath the other for direct interaction. Bottom-center
  also keeps the card's familiar footer position; the cookie-bar hazard there
  is already handled by Consent Dialog auto-dismissal.

Considered and rejected: a third dedicated `WebContentsView` for the card
(another native surface fighting for z-order and geometry sync, for no gain
over the view we already float), and keeping the in-flow band restyled
translucent (still resizes the browser, rejecting the point of the change).
