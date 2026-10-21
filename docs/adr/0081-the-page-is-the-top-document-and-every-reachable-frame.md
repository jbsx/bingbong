# ADR 0081: The page is the top document and every Reachable Frame

## Status

Accepted on 2026-10-21 by the owner, grilled from #377 (split out of the
#376 grill). Amends ADR 0007 ("the snapshot collector is top-frame
text-only"), ADR 0079's ops paragraph and ADR 0076 Ruling 2 ("every
playing media element in the page's top frame"). Built as two tickets:
#377 (the frames, every ref kind, the media ops, `stop`, the ducker),
then the frames' text in the Page Read with an iframe consent wall as its
check, blocked by #377. Amended on 2026-10-21 by the owner's ruling on
#378 ("widen now"): a frame in the top's open dialog gives the dialog its
text.

## Context

Everything that reads or drives the page looked at the top document
alone: the collect is one `Runtime.evaluate` in the main frame, the media
ops index `__bingbongRefs` there, `PAGE_MEDIA_JS`, the idle `stop` (#376)
and the TTS ducker all query `video, audio` on `document`. A cross-origin
iframe was listed as one opaque `iframe` ref (the challenge detection,
ADR 0007, needs it); a same-origin frame was dropped. So an embedded
player — a YouTube or Vimeo iframe on a news or course page, the most
common "other site's video" — was never on Jev's card, had no media ops,
was missed by `stop` and played over the speech at full volume. A consent
wall served in an iframe (Sourcepoint and the like), a comment widget and
an embedded form were as invisible.

Electron runs with site isolation, so a cross-origin frame is out of
process. Every tool that reaches frames does it the same way: run the
same code in each frame and merge the answers — Vimium's content script
in every frame with hints merged by `frameId`, Playwright's per-frame
execution contexts over auto-attached targets, Playwright MCP's
frame-prefixed refs in one snapshot.

## Decision

**The page is the top document and every Reachable Frame,** for every ref
kind, not media alone: what is out of reach in a frame is a class, and
reaching only its `<video>` leaves the next report to be the cookie wall
in the frame (the widest net). A Reachable Frame is one whose iframe box
is rendered, meets the viewport and is larger than 2×2 CSS px, at any
depth, from any site. No site lists; ad frames the adblocker leaves
compete for the cap like any ref.

**One way in for every frame.** The collect script runs in each frame's
own context through Electron's frame API
(`webContents.mainFrame.framesInSubtree`, `WebFrameMain.executeJavaScript`,
which routes to out-of-process frames), with CDP kept for what needs an
object handle (the Ref State read). Same-origin and cross-origin frames
take the same path; there is no `contentDocument` walk. A spike confirms
the API reaches every frame the rule admits before the build commits to
it; if it does not, auto-attached CDP sessions (`Target.setAutoAttach`,
`flatten`) with per-frame execution contexts are the fallback, same rule.

**One flat numbering for Jev, (frame, index) underneath.** Each frame
keeps its own `__bingbongRefs` and its own stale-ref guard; a frame that
navigated or went away refuses its refs as a stale ref is refused today.
A click stays one top-level mouse event at the element's rect plus every
ancestor iframe's content-box offset; a media op is one evaluate in the
ref's frame.

**A frame's refs take its iframe's place** in document order, so they
compete for the 75-ref cap by where they sit on the page, as every ref
does. Each frame ref's line names the frame's host (`in youtube.com`):
"the embedded video" bears on the reading, and the tag's wording is
measured with `jev:replay` as #372's seek wording was. The opaque `iframe`
ref stays only for a Reachable Frame that could not be read, which keeps
the challenge detection's signal.

**Frames never hold up the read.** Frames are collected in parallel with
the top frame; a frame that has not answered within a short grace after
the top frame (50 ms to start, set by measurement) stays opaque for that
read. Collect time p50/p95 is measured before and after
(`BINGBONG_BROWSER_SUBSPANS=1`).

**`stop` and the ducker reach every Reachable Frame.** An idle `stop`
pauses every playing media element in the top document and every
Reachable Frame, by kind, with no ask and without waiting on any frame's
answer (#330). The TTS ducker lowers and restores media in every frame.
A `skip`'s own pause still reaches YouTube's player alone.

**A frame's text joins the Page Read at its iframe's place** (#378). The
collect reads each Reachable Frame's text in the frame's own context,
under the same frame rule and grace. The top's text walk leaves the
iframe's place where it meets one: an inline wrapper around an iframe is
descended for it, and an iframe inside a tag block takes the place just
after that block. The merge puts the text of each frame whose elements
joined the page at that place, at any depth. A frame that was not read in
time, is 2×2 px or smaller, is hidden, or sits off the top viewport
contributes none. The iframe element itself still carries no prose.

An iframe outside the text root (the main landmark, else the body) has no
place in the Page Read, as the top's own text there has none. The one
exception is a frame in the top's open dialog: **its text is the
dialog's.** A wall served in a frame leaves the top's dialog holding only
an iframe, and a consent manager appends its container outside the main
landmark. So that frame's text joins `dialogText`, wherever the iframe
sits, within the collector's 400-character bound. That one field is what
the read's `dialog open:` line, Jev's card and the consent chooser all
read. Frames in the page layer outside the text root, such as a sidebar's
ads, stay out.

**Measured, not assumed.** The build opens with a reproduction on a real
page with an embedded player, its misses added to the Failed Lines ledger
and the Jev corpus; it ends with those cases passing and no case that
passed before failing in `jev:replay`.

## Consequences

- The card grows by the frames' refs. On a page with a large embed this
  pushes lower top-document refs past the cap; the competition by page
  position is the accepted cost, and replay is where a lure shows up.
- The collect is now a fan-out, and its latency is the slowest frame
  within the grace, never beyond it.
- Ref resolution, the stale guard, `readRefStates` and the click prep
  each learn the frame half of an address.
- ADR 0007's "cross-origin challenge iframes are invisible" holds only
  for a frame that cannot be read in time; a challenge widget whose own
  controls do come through is on the card like any control, and Jev
  reads it.
- `nodeIntegrationInSubFrames` stays off; nothing here needs a preload
  in subframes.
- The Page Read grows by the frames' text and its parts with it. The
  collected-text bound ends the read wherever it falls, a frame's place
  included.
- A consent wall's wording now reaches Jev, but the Tier-1 reject rule
  still fires before Jev is asked. On a pay-to-reject wall ("Reject all
  and subscribe") the rule clicks the paid choice: ledger
  `cli-2-mvihb65g`, a judgement that belongs to Jev and is not settled
  here.
