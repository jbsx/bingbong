# Peek Card rides the panel overlay view

Amended on 2026-10-27 by #475: the card is the Ledger Strip, a band the
pane's width along its bottom; see the amendment below.

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

## Amendment 2026-10-27 — the card is the Ledger Strip, a band across the pane's bottom (#475)

The card is now the Ledger Strip: a band the pane's width docked to its
bottom edge, 340 px tall, solid `--surface-solid` with a hairline top, no
longer a translucent card bottom-centre. Its alpha is gone with
`--panel-peek`, because a band carrying the stage at 65 px and five history
rows is read, not glanced at. Two consequences still hold. The overlay view
shows one element at a time, so the band still replaces the edge tab, and
the view's bounds shrink-wrap the band, leaving the page's bottom 340 px
under it while it shows. Card and panel still never share a moment on
screen, since an open panel outranks the band. What changed is the anchor:
the band now spans the pane's whole width, so a page's footer is covered
for the band's life, at most 15 s after the line ends. The consent
auto-dismissal named above still covers the cookie-bar case.

The band's words row is two lines of 40 px, about 90 characters, so a
partial longer than that cannot be drawn whole. Across the 140 spoken
lines in the kiosk's decision logs (2026-10-27) the longest is 44
characters (p99 39), so no recorded line is cut. Beyond two lines the band
keeps the newest words: the row holds to its last line and the head goes
first, while words that fit stay on line 1, so nothing moves. That cut is
a guess, the arm cheapest to reverse; the first real line past two lines
decides between it and a smaller face for long partials.
