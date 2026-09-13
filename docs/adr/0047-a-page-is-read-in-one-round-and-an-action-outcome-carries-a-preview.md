# ADR 0047: A page is read in one round, and an Action Outcome carries a preview

## Status

Accepted on 2026-09-13 for #235, grilled from the Round Audit (#234, ADR
0045). Changes what `read_page` returns and what the page text on a
navigate, click and scroll result is for. The scroll delta of #194 (New In
View, End of Page, the repeat rule the note feeds) is unchanged; the stale-ref
rule (ADR 0033) is unchanged; the Blocker gate's read of the digest (ADR 0010)
reads the same first stretch it always did.

## Context

The Round Audit of the Baseline counted 105 scroll rounds against 19
`read_page` rounds over 340 tool rounds, and fifteen of eighteen attempts were
judged rounds wasted. Four attempts spent six to fourteen consecutive rounds
scrolling one page they had already opened. The issue that carried this
finding assumed `read_page` returned the whole page and the model was simply
not calling it. Read from the code and the Run Traces, that is not what
happened:

- The page text every browser result carries is one digest: the page's `p`,
  `li`, `h2` and `h3` blocks under `main` or `article`, joined and cut at
  1,800 characters from the top of the document. It does not move when the
  page scrolls. `navigate` and `click` return it; `read_page` returns the same
  digest again.
- Of the 105 scrolls, 97 were on a page the attempt never called `read_page`
  on. The model had no reason to: the navigate result already held everything
  a read would return, and both descriptions said so. In every result across
  the three sets the page text stops under 2,000 characters; 63 of 120
  navigate results hit the cut.
- On the Eurostar luggage page (8,854 px tall) the navigate result and the one
  `read_page` stop mid-word at the same place. The scrolls that followed
  brought in the sections past it. Scroll's "new in view" block was the only
  path the model had to text below the cut, and a scroll is three wheel
  notches, about 277 CSS px on a 575 px viewport: under half a screen a round.
- The table the Eurostar hunt needed reached the model as three lines of
  "2 pieces of luggage + 1 piece of hand luggage." with no row headers,
  because table cells are not among the collected blocks. The raw asciidoc
  pages the pi-camera attempts opened came back as a header line, because
  their text is in `pre`.

So the sentence the issue proposed — "read_page is how text is read" — would
have sent the model to a tool that returned the identical 1,800 characters it
already held: a neutral observation, no new material, and one more round. The
fix has to change what a read returns; the descriptions follow from that.

Three shapes were weighed. Raising the digest cap everywhere pays the larger
text on every page the Run touches, including the search pages and 404s that
were 90 of the Baseline's Off-key rounds. A full-viewport scroll step still
spends a round per screen, and the controller's own comment records why the
step is small: a step larger than the viewport skips short elements on short
viewports. The third shape is the decision.

## Decision

- **An Action Outcome carries a Page Preview; `read_page` is the Page Read.**
  The text on a navigate, click or scroll result is the opening stretch of the
  page, capped at 1,800 characters as today, for orienting and choosing. A
  `read_page` returns the page's text from the top, up to 12,000 characters
  in one result, and a longer page in numbered parts selected by a `part`
  argument. A part is cut at the last block boundary under the cap, never
  mid-word, so no fact is split across two rounds. Part 1 starts at the top
  of the page and repeats what the preview showed: a read is the page, not a
  diff of what the model has seen.
- **A cut says so, as a fact line, not a Notice.** A preview that was cut ends
  with one line naming the size — `page text: first 1,800 of 7,412 characters
  — read_page returns the whole text`. A read with more parts ends with `page
  text: part 1 of 3 — read_page part=2 continues`. A page that fits carries no
  line. The decision to scroll was made one round earlier, looking at the cut
  preview; that is where the pointer belongs. A Notice is advice the pipeline
  appends in a fixed precedence; the cut is a fact the browser controller
  already knows, stated the way End of Page is.
- **Scroll keeps its job and loses its sentence.** Scroll brings refs past the
  ref cap into view, loads more of a page that fills as it scrolls, and places
  the viewport for a Look; its New In View block stays, capped as a Page
  Preview is. The clause "continue straight from those, no read_page after a
  scroll" goes, replaced by: to read the page's text, use `read_page`. The
  navigate and click descriptions say the page text is a preview and
  `read_page` returns the whole text. The shared browsing policy's "re-inspect
  a page only when you explicitly need a fresh look" becomes: read a page with
  `read_page` when its preview is cut or you need a fresh look; scrolling is
  for elements and position, not for reading. The Browse Subagent reads the
  same policy and the same catalog, so both loops change through one text.
- **Tables, pre blocks and definition lists are text.** A table row is one
  block, its cells joined by ` | `, header rows included, so a label and its
  value share a line. A `pre` block keeps its line breaks. A `dt` and its `dd`
  render as `term: definition`. Blocks are collected in document order and an
  element inside an already collected block is skipped. There is no per-block
  cap: a large block is bounded by the part cap like everything else. This
  changes the digest for every page with a table, so the Round Audit's
  reviewer cache re-keys for sets captured after the change; the Baseline's
  outputs are already written and nothing recorded moves.
- **A continuation is its own observation.** The part is in a read's action
  fingerprint and in what the page-read Observation Producer records: part 2
  of an unchanged page is a first observation and neutral, the same part again
  is a repeat, and the auto-vision check for near-identical reads compares
  only reads of the same part. A part past the end is refused before
  execution with the range named, the way ADR 0046's admission step refuses:
  a refused call in the round, spending nothing.
- **The audit counts tools.** The Round Audit's mechanical output gains a
  per-tool round count per population: tool, rounds, share of tool rounds.
  The count is code-counted from the Run Trace and does not enter the
  reviewer's digest, so the four Baseline outputs are regenerated with their
  cached judgements and the reviewer is not re-run.

## Consequences

- Reading the Eurostar or JPL pages the Baseline scrolled through becomes one
  round each. A page over 12,000 characters of text takes a few rounds, one
  per part, instead of one per screen.
- One `read_page` result can be about 3k tokens against a per-round prompt of
  about 13k today. That is the trade: tokens on a page the model chose to
  read, against rounds on every page. The preview cap is unchanged, so pages
  the model only passes through cost what they cost.
- The scroll step is unchanged. Whether a Look placed by scroll still finds
  what it needs is ADR 0046's concern and is not moved by this decision.
- The New In View glossary entry, which said the block is capped "as a page
  read formats and caps them", now names the Page Preview: a read is no
  longer the thing capped at 1,800.
- What is established here is mechanical and unit-testable: what a read
  returns for a page of a given length, where a part cuts, what a row renders
  as, what the rail records for a part, what the audit counts. Whether a live
  model reads instead of scrolling is what the three-pass capture is for: the
  number that has to move is scroll rounds as a share of tool rounds, from
  30% in the Baseline to 10% or under, with read_page rounds beside it and
  the primary verdicts and checks reached no worse.

## Relationships

Motivated by [ADR 0045](0045-a-round-audit-is-counted-by-code-and-judged-by-a-model-that-is-not-measured.md)'s
Baseline audit. Keeps [ADR 0033](0033-a-ref-names-the-element-it-was-shown-as.md)'s
stale-ref rule and the #194 scroll delta as they are. Uses the admission step
[ADR 0046](0046-a-region-look-that-names-a-place-runs-and-an-argument-refusal-is-not-a-vision-attempt.md)
established for the out-of-range part. The Blocker gate of
[ADR 0010](0010-mechanical-blocker-detection-gate.md) classifies from the same
first 1,800 characters it always did.
