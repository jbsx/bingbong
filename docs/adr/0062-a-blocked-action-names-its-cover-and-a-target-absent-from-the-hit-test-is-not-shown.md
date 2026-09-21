# ADR 0062: A blocked action names its Cover, and a target absent from the hit test is Not Shown

## Status

Accepted on 2026-09-21 for #264, grilled from the `fix-258-259` capture
(#259, ADR 0058) beside ADR 0061. Builds on ADR 0061's blocked-action
dismissal and on ADR 0033's shown registry. Amends nothing; ADR 0061
carries a note.

## Context

A click or type whose target's centre resolves to another element returned
`not clicked — blocked by overlay`, and the click description told the
model "something (usually a dialog) covers the target: read the page,
handle the dialog, then retry". Only a boolean crossed out of the page: the
in-page preparation resolved the covering element and threw it away, so
the outcome could not say what it was.

Two different situations produced that one line in every live trace on
disk. On the museum collections page the collection search box sat under
a consent wall's sibling underlay: the target was painted and something
lay over it. In the same page's header a second search input sat inside a
closed search drawer — as served, a native `<dialog>` styled open, fixed,
clipped to nothing by a zero-radius `clip-path`, marked `inert`, its
content at opacity 0. Nothing covered that input; the browser's hit test
skips an inert subtree and answered with whatever lay beneath the drawer.
The collector had listed the drawer's Close button, input and link as
refs, because its visibility rule is rect intersection plus `display` and
`visibility` by design — a covered background control is a real target —
and that rule knows nothing of `inert`, clipping or opacity.

In pass 2 the model typed into the drawer input, was blocked, cleared the
consent wall by hand, typed into the same input again, was blocked again,
clicked the drawer's own Close button, was blocked a third time, then
spent a visual-grounding round and a Look asking what dialog covered the
page. Nine rounds went on one URL and the Run stopped for no Progress. The
reachable collection search box was listed the whole time.

## Decision

- **A blocked click or type reports one of two facts**, decided by the
  page's own hit test: `document.elementsFromPoint` at the target's centre
  returns the whole paint-order stack. If the target is in the stack, it
  is **Covered** and the entries above it are the covers. If it is absent,
  it is **Not Shown**: not hit-testable at its own centre for a reason
  that belongs to the target or its ancestors — inert, clipped, hidden,
  `pointer-events: none` — which no dismissal reaches. One call separates
  the two; no computed style is walked, and the cause of a Not Shown
  target is not reported, because the model cannot act on causes
  differently.
- **A Cover is named as a page read names refs.** The first entry above
  the target that is a ref, or lies inside one, is named by that ref's
  listing line. Otherwise the first entry with an accessible name
  (`aria-label`, `aria-labelledby`, `alt`, `title`) is named by kind and
  name. Otherwise the cover is `an unlabelled <tag>`. In the last two
  cases the line lists up to three refs the cover contains, since those
  are what the model can act on. The stack is walked in paint order, so
  the "nearest labelled ancestor" is found without a separate walk.
- **The heads change and the word "overlay" leaves them.**
  `clicked [26]: not clicked — covered by [8] button "Reject all cookies"`;
  `clicked [16]: not clicked — [16] is not shown: inside a hidden or inert
  container`; type mirrors click. There is no shared "blocked" prefix: the
  two facts call for different next moves, and a shared prefix invites the
  model to treat them as one. Both heads are built by the one helper the
  #261 rails match against.
- **Neither outcome carries a listing.** Nothing was clicked and the ref
  array was not recollected, so the model's numbers are still valid; the
  named Cover carries a ref the model can act on directly. A fresh listing
  after a call that changed nothing visible would renumber the page for no
  visible event.
- **The collector stops listing what is inside an inert ancestor, and
  nothing else.** Nothing inside `inert` is ever focusable or clickable by
  the platform's definition, so the check is cheap and cannot drop a real
  target. Opacity stays an act-time fact: an opacity-0 control that is on
  top still clicks, and one that is not is Not Shown only after the hit
  test misses it.
- **Under an open Tier-1 consent root, a Not Shown target is dismissed for
  but not retried.** ADR 0061's dismissal runs where the wall is met; its
  retry is dropped because its result is known. The outcome reports the
  dismissal and the not-shown fact in one line.
- **The click and type descriptions carry the same two sentences**, and
  neither names a thing to hunt: a "covered by" result names what sits
  over the target — act on the ref it names, or choose another target you
  were shown; a "not shown" result means the target is inside a hidden or
  inert container — no dismissal reaches it; choose a target you were
  shown. "Usually a dialog" and "read the page, then retry" go, because the
  outcome already names the actionable ref.
- **Both facts are one consumed-nothing class** for the #261 rails (the
  Search Loop hold and the no-progress rail), and three Round Audit
  columns: covered, not shown, inert.

## Measurement

Deterministic per-round tags in the Round Audit, as ADR 0061's are, pooled
over the `fix-264` capture against the `fix-263` reference: covered and
not-shown outcomes per Run; post-block vision rounds — a Look or visual
grounding call within two rounds of either outcome, decided by tool name,
never by wording; and recovery rounds — from a covered or not-shown
outcome to the next round whose action landed or answered. The gate is
post-block vision rounds at zero across three passes. Counts and recovery
rounds are reported per hunt, not gated: with the collector change the
museum hunt should show zero not-shown outcomes, and a zero has to be
visible as a count rather than as silence. The collector's inert exclusion
and the stack rule are unit-tested in headless Chrome against a fixture
with an inert drawer and a sibling underlay, since jsdom has no hit test;
the two heads are fixture-tested in core.

## Considered options

- **One fact, naming `top`.** Rejected: for the drawer input the hit test
  answers with the page content beneath the inert dialog, and "blocked by
  the results grid" is worse than today's line.
- **Three facts, splitting Not Shown by cause** (inert, clipped, hidden).
  Rejected: the model's next move is the same for all three, and the
  causes are words for it to hunt.
- **Deciding Covered against Not Shown by computed style** (`inert`
  ancestors, `checkVisibility`, clip-path, overflow clipping). Rejected:
  every rule missed a case the hit test catches — `checkVisibility` knows
  nothing of clip-path, an ancestor with `overflow: hidden` clips without
  hiding — and the stack answers all of them in one call.
- **The collector also dropping opacity-0 elements.** Rejected: the
  custom-checkbox pattern hides a real input at opacity 0 behind a styled
  label, and dropping it would drop the only ref for that control.
- **A fresh listing on a blocked outcome**, or one only when the
  preparation's scroll moved the viewport. Rejected: renumbering after a
  no-op call is a new trap, and #263's retry already recollects when the
  page actually changed.
- **Keeping "blocked by" as a shared prefix** for continuity with traces
  and e2e assertions. Rejected: the assertions are cheap to move, and the
  prefix is the thing that made two facts read as one.

## Consequences

- A cover that is a labelled region with no refs of its own inside it is
  named by its label alone; the model then has a name and no ref, and the
  next move is another shown target. The audit's recovery rounds are where
  that would show.
- A target clipped by an ancestor's `clip-path` while the ancestor is not
  inert is Not Shown by the stack rule, though the collector still lists
  it; the not-shown count on hunts other than the museum's is the signal
  that a site does this often enough to warrant a collect-time rule.
- The open-dialog suffix that lists a role-bearing dialog's controls stays
  as it is; a Cover line may repeat one of those controls. The
  visual-grounding path's own refusal ("no longer resolves at the visually
  grounded point") is a third string and stays out of scope.

## Notes

- 2026-09-21, implementation (#264). The calls this ADR left open:
  - **A Cover is named only by a number the model holds.** With no
    dismissal, a ref names a Cover only while it is still the node the
    model was shown there (ADR 0033's shown registry) and falls inside the
    listing's cap; after a consent dismissal the outcome carries the
    post-dismissal listing, so any number it lists may. A ref that contains
    the target is never its Cover, and a ref cover the snapshot does not
    list falls back to `an unlabelled <element>`. The kind of a labelled
    Cover is its `role`, else a short implicit-role table (`section` is
    `region`, `nav` is `navigation`, …), else its tag; the tag is printed in
    angle brackets, `an unlabelled <div>`.
  - **Inert reaches the dialog root too.** A role-bearing dialog inside an
    inert subtree is never the snapshot's dialog root, and a consent
    control inside one never makes a Consent Dialog: a closed drawer would
    otherwise open the dialog layer with nothing listed on it.
  - **The retry note follows whether a retry ran, not the fact.** A Not
    Shown first attempt under a Tier-1 root reads `… (not retried)` after
    the dismissal line; a Covered first attempt whose retry is then Not
    Shown was retried, and reads `(it covered [n]; retried, still blocked)`.
  - **The audit keeps pre-#264 heads.** `blocked by overlay` is no longer a
    head the port writes, so the rail's helper does not read it; the Round
    Audit reads it as a Blocked Action of no recorded kind, a fourth column
    (`pre-#264`) beside covered, not shown and inert, because the `fix-263`
    Reference was captured under it. An action *landed* when it is a page
    action (never inspection — `read_page`, `scroll` — and never `look` or
    `ground_visual`) that consumed something as the rail decides it; the
    first Finalization round counts as the answer. A post-block vision
    round is counted once per round, from the round of the block to two
    rounds after it; recovery is counted per block, and a block nothing
    followed is `never`.
