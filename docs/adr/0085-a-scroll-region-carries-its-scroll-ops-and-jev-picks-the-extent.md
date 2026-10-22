# ADR 0085: A Scroll Region carries its scroll ops, and Jev picks the extent

## Status

Accepted on 2026-10-22 by the owner, grilled from #383 (split out of the
#381 grill, ADR 0083). Extends ADR 0080's shape (a ref's kind decides its
ops) to a new kind. Amends ADR 0083 in one place: a Scroll Region has a
floor where an Unmarked Control has none. The owner delegated the answers
past the first round: "as long as your fix follows 'Jev decides; code
shapes the ask' from AGENTS.md and you empirically test for a between
options when there are trade offs, i am okay with what you recommend".

## Context

`scroll up|down` is three wheel notches (360 px) dispatched at the centre
of the viewport. Chromium routes a wheel to the innermost scroller under
that point and chains to the page when it is at its end, so the page
scroll already moves whatever sits at the centre. What it cannot do is
name a region: a feed, a chat pane or a side panel that scrolls on its own
is never a ref, so Jev cannot be asked to scroll it, and "scroll the chat
to the bottom" has no line that does it in one.

Vimium hints such regions (`link_hints.js`): a `div`, `ol` or `ul` whose
`clientHeight < scrollHeight` and which `Scroller.isScrollableElement`
passes, and `body` when it is the document's. `isScrollableElement`
scrolls the element by one pixel and back to prove it moves (a Chrome 38
bug workaround) and refuses `overflow-y: hidden`, hidden and undisplayed
elements. Activating a scroll hint scrolls nothing: it makes the element
the target Vimium's `j`/`k` scroll afterwards.

Measured on 2026-10-22 (headless Chrome 153, 1280×800, the cue copied
exactly, probe included): 0 or 1 element passes per page. YouTube's watch
page, home and a live stream, BBC News and Wikipedia have none; YouTube's
comments and related column are document flow. The hits were YouTube's
consent dialog (18 px of overflow), DuckDuckGo's closed side drawer
(parked off-screen with an 11 px sliver in the viewport), Hacker News's
`body`, and Reddit's right sidebar, the one real content region found.
Chat layouts live behind logins and were not measured; YouTube's live chat
is an iframe. The count costs 1–33 ms, about 2 ms per thousand elements.

## Decision

**The cue is Vimium's, without its probe, above a floor.** An element is a
Scroll Region when its tag is `div`, `ol` or `ul`, `scrollHeight >
clientHeight`, its computed `overflow-y` is `auto` or `scroll`, it passes
ADR 0062's rect rule, at least half of its box is in the viewport, and it
hides at least half a view of content (`scrollHeight − clientHeight ≥
clientHeight / 2`). Vertical only, as Vimium's cue is. The cue runs in
every Reachable Frame (ADR 0081) and under open shadow roots (ADR 0083).
`body` is left out: the page scroll already covers the document. The
probe is dropped because it would scroll every candidate on every
collect and fire real `scroll` events into the page, which Vimium risks
only while hints are up. The floor is where this ADR departs from ADR
0083's rect-only rule: a dialog's slack and a drawer's sliver are not
things a person scrolls, and both would be lures on the card.

**A new ref kind, `region`, with no click.** Its line reads
`region "Live chat" at top 12 screens`: its label, its position (`at
top`, `at end`, or `scrolled 40%`) and its length in screens, so Jev can
tell a short panel from a long feed and the Verdict can see the position
move. The label is its accessible name, else the first heading inside
it, else the first 60 characters of its text; a region with none is a
Textless Ref and falls to ADR 0084. The whole region's text is never its
label.

**Two Scroll Ops per region, `down-N` and `up-N`,** each a whole line on
the action card that says what a region is, since its label never does:
"scroll down inside [12] "Live chat", a part of the page that scrolls on
its own — a sidebar, panel, feed or chat — not the page itself; the
extent Choice saying how far". Measured on a live Reddit card: the
sidebar's op went from 0.23–0.29 under the page's `scroll_down` to
0.87–0.89, and "scroll down" stayed the page's at 1.00. They are offered
whatever the region's position: a scroll at the end
changes nothing and the next Hop's Verdict ends it. Each is one evaluate
in the ref's frame: `scrollBy` on the element, `behavior: 'instant'`,
`end` a `scrollTo` of its end or its top, armed and awaited through the
readiness watch so the scroll event is the op's own, then the recollect.
An explicit scroll on the element never chains to the page. Nested
regions are each their own ref with their own ops; a scroll of the inner
never moves the outer.

**Jev picks the extent.** One `extent` Choice rides on every ask, read
only when the action is a Scroll Op or the page's `scroll_up`/
`scroll_down`: `words` (the number the words carry, in screens),
`little` (a third of a screen), `screen` (one view height, the browser's
own Page Down), `lot` (three screens), `end` (to the end, or to the top
going up). Its instructions name `screen` as the rung when the words say
nothing of how far. It is a Choice of its own, not the media Amount:
nobody scrolls "half the feed", and the view is a scroll's natural unit
where the duration is a seek's. The record keeps the rung.

**The page scroll joins the class.** The card's `scroll_up` and
`scroll_down` options read the same Extent, so "scroll to the bottom of
the page" is one action. The mechanism stays the wheel at the viewport
centre, since the browser's routing is already right: the fraction rungs
become a number of notches (a screen is the viewport height over 120 px,
rounded up); `end` is the browser's own End or Home key at the centre,
which reaches the document scroller, or the focused region in an app
shell whose body does not scroll. A field or frame holding the focus is
blurred first, so the key reaches the scroller and not a caret; the
scroll is read where it stops, not on its first animated frame. The exact grammar lines `scroll
up|down` stay local and fire today's 360 px unchanged (ADR 0076). The
grammar gains `scroll <ref> up|down`, an exact line that scrolls that
region one screen with no ask, for the harness and the tests.

**The outcome is a scroll's.** The outcome names the position it moved
from and to (`at top → scrolled 35%`, to the tenth of a percent when a
long region moves less than one), then what entered the view; **End of
Region** when the region did not move: it was at its end, or its top.
"Done so far" names which way the scrolling part moved, and the change:
`scroll down a screen "Live chat" (the scrolling part moved down: at top
→ scrolled 35%)`. Measured on a live YouTube chat: yes 0.74–0.79 without
the direction, 0.84–0.89 with it. The opposite-scroll Misfire signal and
the no-progress rail read a region scroll as they read a page scroll, on
the same scroller only: a page scroll followed by a region scroll is no
recovery.

**Order under the caps.** Regions take the collect's places after marked
elements and after Unmarked Controls. On the card their lines sit with
the other refs in page order; their ops come after the Media Ops and
before `menu-N`, so menus give way first.

## Considered options

- **Vimium's probe kept.** Exact, but it writes `scrollTop` on every
  candidate on every collect and fires scroll events the page and our
  readiness watch see. Rejected; the static overflow test stands in. A
  ledger miss on a region the static test refuses reopens it.
- **No floor, ADR 0062's rect rule alone.** Measured: the consent dialog
  and DuckDuckGo's drawer pass and would be two lures on an otherwise
  empty count. Rejected; the floor is by kind, never by site, and its bars
  are measured against the fixture and `jev:replay` before they are kept.
- **One Amount for seeks and scrolls.** Fewer questions, but the rungs
  would be fractions of a length nobody scrolls by, and one wording would
  have to serve both. Rejected for a second Choice, costed below.
- **`body` as a region.** Vimium hints it; here the page scroll is the
  document's op already, and a second line for the same thing is a lure.
  Rejected.
- **Vimium's two-step** (activate the region, then scroll keys). Two
  actions where one line does; ADR 0080's shape is one op per line.
  Rejected.
- **The page scroll untouched.** Consistent today, inconsistent the day a
  region can scroll to its end and the page cannot. Rejected, with the
  page half the first thing to give if `jev:replay` says the Extent costs.
- **Horizontal scrollers.** Vimium's cue is vertical; a carousel miss goes
  in the ledger and is its own decision.

## Consequences

- One more Choice on every Jev call, since the page's scroll options are
  on every card. Measured against every `jev:replay` case; a regression
  drops the page from the Extent first and asks it only when a region is
  on the card.
- The collect gains about 2 ms per thousand elements; it counts against
  ADR 0083's ≤15 ms budget.
- The build measures what the grill could not: the card wording of
  `down-N`/`up-N` against the page's `scroll_down` (as ADR 0080's "by a
  length of time" was measured), the floor's two bars, and the Extent on
  every ask against the Extent only with a region.
- A region the cue misses (any other tag, a horizontal scroller, a page
  whose `overflow` is set by script after the collect) is Vimium's own
  false negative, accepted until a ledger line shows it.
- The glossary gains **Scroll Region**, **Scroll Op**, **Extent** and
  **End of Region**; **End of Page** points at the last.
- The live class (chat panes) is unmeasured logged out; the ticket's live
  half is Reddit's sidebar by the agent and YouTube's live chat, a region
  in a frame, by the owner.
