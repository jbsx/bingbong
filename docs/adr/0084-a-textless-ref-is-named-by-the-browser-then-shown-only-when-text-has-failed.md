# ADR 0084: A Textless Ref is named by the browser, then shown only when text has failed

## Status

Accepted on 2026-10-21 by the owner, grilled beside #381 (ADR 0083).
Amends ADR 0082: the Where Ask's second `none` makes a Mark Ask before it
ends, when a Textless Ref is on the card. Amended on 2026-10-22 by the
owner's ruling on #382: an unsure hop-0 click on a Textless Ref makes a
Mark Ask too (Decision 2).

## Context

On 381 logged cards 7.6% of refs had an empty label and 2.9% were
anonymous controls, neither media nor links with an address. Truth Social
had 28% of its refs empty, and DuckDuckGo about 200 bare buttons. Jev
reads them as `[33] button ""`. Chrome's computed accessible name is
fetched for every top-document ref (`readRefStates`) and thrown away:
`refStatesOf` never reads `name`.

TypeSafe SDK 0.7.0 lets Jev read PNG and JPEG images, an experimental
opt-in. The owner wanted images kept to a minimum on cost. About 81 calls
on a YouTube watch-page card measured the forms:

- A plain screenshot added about 50 ms and moved the answer to the wrong
  Settings.
- Icon crops must have a short side over 256 px; ten of them (272 KB)
  added about 175 ms and did not help.
- A screenshot with numbered marks (111 KB) added no median time and was
  right 6/6 at a confidence of 0.92–1.00.

## Decision

1. **The accessible name first.** A ref whose `labelOf` text is empty takes
   Chrome's computed accessible name as its label. This is free, and by
   kind.
2. **The Mark Ask, only when text has failed.** When the Where Ask's second
   reading is `none` and a Textless Ref is on the card, the same card is
   asked once more, with one JPEG of the pane on which each Textless Ref's
   ref number is boxed, and those refs' options read "the control marked
   N". Its best reading fires as hop 0, and a `none` ends "No response." as
   before. No other point makes a Mark Ask until a ledger line shows text
   running dry there.

   *Amended 2026-10-22.* The Mark Ask is also made at hop 0 when the
   reading's top choice is a click on a Textless Ref below the Choice bar:
   the guess is replaced by the Mark Ask's reading, which fires as hop 0.
   A Mark Ask that gets no answer, or no capture, leaves the guess to fire
   as it was read. The ledger lines that showed it (cli-4-mviqbp8w,
   cli-6-mviqcayg): on cards of Textless Refs Jev never read `none`; it
   guessed one at 0.20–0.74 and fired the wrong icon. The same three lines
   asked with marks chose the right icon 3 of 3 at 0.84–1.00, for 0.3–0.5 s
   more.
3. **Marks are drawn off the page.** The textless refs' rects are read
   again right before the capture, scaled from CSS pixels to the bitmap,
   with frame offsets added. The page is never written to (Vimium #2997).
   No capture means no Mark Ask.
4. **The SDK moves to 0.7.0 for every ask.** The
   `TypeSafe-Danger-Zone-Images` header goes on the Mark Ask alone, so a
   change to the experimental API breaks only that ask.

## Consequences

- A line that succeeds on text, or a card where every ref has words, never
  pays for an image.
- The worst case for a line becomes three Jev calls (reading, Where Ask,
  Mark Ask), about 0.3 s more than today's two. An unsure guess at a
  Textless Ref costs one call more than firing it did.
- The Mark Ask has its own `asks-*.jsonl` line with the image saved beside
  it, and a `markAsk` field in the Decision Record; `jev:case` and
  `jev:replay` carry the image.
- A Textless Ref in a frame has no accessible-name read yet, so it falls
  to the Mark Ask.
- The `box` question and crops were measured and rejected. Marks on
  labelled refs were rejected as clutter.
