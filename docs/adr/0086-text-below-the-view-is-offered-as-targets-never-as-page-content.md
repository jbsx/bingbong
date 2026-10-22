# ADR 0086: Text below the view is offered as targets, never as page content

## Status

Accepted on 2026-10-22 by the owner ("add it"), grilled from #393 (split
out of the #391 grill). The owner delegated the answers: "if we can test
something empirically, then do so … make sure no suggested fix violates the
widen guideline in AGENTS.md and where unsure between equally sensible
options, you test empirically".

## Context

#393 asked whether Jev should see what the action card leaves out: text
below the viewport, hidden text, and structured data. Since #392 the card
carries every block in view and says when a cut leaves blocks out. The
collect already gathers the blocks below the view (`textBlocks`), and only
`read` uses them.

Nine lines were driven live. Two failed for lack of what was below the
view. On docs.python.org's json page, "show me how to pretty print" typed
into the site search, left the page and ran to the cap. On a RecipeTin
Eats recipe, "show me the ingredients" took four actions to get there.

## Decision

The blocks below the view are listed at the end of the card as Text
Further Down, one `[text-N] "…"` entry each, in reading order. A block is
held to 300 characters, as the blocks in view are, and an entry that
repeats a label already on the card is left out. The list stops at 6000
characters. Each entry carries a Show Op, `show-N`: "scroll until [text-N]
"…" is in view". It is one evaluate that scrolls that block's element into
view, on any site. The ops take only the room the Choice has left under
its 255 options.

No `learn_more` choice is offered, and hidden text does not go on the
card. `read` keeps its text as today. The Verdict's wording is unchanged.

## Considered options

Each option was asked of the real Jev three times. The cards were the
same ten live cards (three failing, four controls, three Verdict guards),
rewritten for each option.

- **A `Text further down:` line under Page**, flat or grouped by screens,
  at 2k, 6k and 12k: rejected. The Verdict reads text below the view as
  shown. README hop 1, with the install line not in view, went from
  `not_yet` 0.92 (3 of 3) to a false `yes` 0.52–0.77 (0 of 3) in every
  variant. RecipeTin at the top of the page went to `yes` 0.9 at 6k and
  12k. The action gains were small (Python docs 0.03 → about 0.23). Live,
  the line drew the Extent to `end` and `lot` on cards that needed no
  scroll.
- **The same line at the end of the card, or the Verdict told that only
  text in view counts**: rejected. Neither restored README hop 1 (2 of 3
  and 1 of 3), and the wording lowered MDN's true `yes` from 0.52 to 0.37.
- **A `learn_more` re-ask**, the paid step: rejected. Jev picked it 0 of 30
  times.
- **Hidden text on its own line**: rejected. No case gained, and the
  Scotland tab dropped from 0.92 to 0.72. A tab is already a ref, and
  that is how hidden text is reached.
- **A distance on each entry, `(+N)` screens**: dropped. Without it every
  card read the same or better (RecipeTin 0.68–0.77 → 0.86–0.88).
- **A 2k bound against 6k**: 6k. RecipeTin's ingredients lie past 2k. At
  6k the guard at the top of the page reads `not_yet` 0.52–0.67. That is
  short of 2k's 0.97, but it is still `not_yet`, and a Task ends only on a
  sure yes.

## Consequences

- Python docs went from 0.04 to 0.84–0.90, and RecipeTin goes straight to
  the ingredients. Every control and Verdict guard holds. With the targets
  on 38 corpus cases, the corpus read 52–53 of 53 over three runs, the same
  as the unchanged corpus. Latency was unchanged: p50 227–242 ms, p90
  273–320 ms.
- A Show Op is a scroll. It counts against the Task's five actions, and the
  next hop's Verdict and Progress Noul judge it as they judge a scroll.
- A full card gives the ops little room. README hop 1 had room for three.
- The README's "how do i install it" still reads `none` with the targets
  on the card. That is the reading of a question, and its ledger line is
  unclaimed.
- Structured data (JSON-LD) waits for a ledgered line that needs it. It
  carries facts that are not on screen, the same lure this decision rules
  out.
- The glossary gains **Text Further Down** and **Show Op**.
