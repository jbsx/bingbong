# ADR 0046: A Region Look that names a place runs, and an argument refusal is not a Vision Attempt

## Status

Accepted on 2026-09-13 for #236, grilled from the Round Audit (#234, ADR
0045). Supersedes one bullet of ADR 0032 (a region over a quarter of the
viewport is refused) and one consequence of it (a refused region still spends
the Look). Pins one word of ADR 0041: a call has been *attempted* when it was
admitted and executed, not when it reached the tool. Describe, Locate, the
Vision Budget, the Vision Deadlines and the glossary are unchanged.

## Context

The Round Audit counted 34 Look rounds across the Baseline's 18 attempts and
found 23 that produced nothing. Read call by call from the Run Traces, the 16
refused `look` calls are not one rule but two, and the second is a consequence
of the first:

| Refusal | Count | What was asked |
|---|---|---|
| `'region' must cover at most a quarter of the viewport` | 7 | Bands of 100×30, 100×40, 100×45 and 95×45, a 60×100 column, a 45×60 block (8% over the cap) |
| `That check already failed once in this run` | 9 | The next Look after a quarter refusal, in every case |

Four of the nine were well-formed quarter regions — `50,50,50,50`,
`0,5,100,25`, `0,50,50,50`, `0,0,100,25`. The model read the quarter refusal,
did what it said, and was refused again. The seventeenth refusal in the audit's
count, a `ground_visual` whose vision point fell outside the viewport, is a
different message and is not addressed here.

The second rule fired because the quarter check runs inside the `look` tool's
execute. ADR 0041 spends a verification route only on a call that "was actually
asked", and the round tells the rail which calls reached the tool — but a
refusal thrown by the tool's own argument reading is still a failed outcome
from a call that reached it, so the rail spent the route on our sentence.
Every quarter refusal in the Baseline therefore closed vision for the rest of
that Run, which is exactly what ADR 0041 said a pre-execution refusal must not
do. The defect is against that ADR, not a choice it made.

ADR 0032 refused oversize regions for a measured reason: on the #195 page a
half-viewport band shown at 2x read titles that were not there, three runs in a
row, and the same row read exactly at 3x and 4x. The refusal was the way to
keep every crop at 3x or more. It was also accepted that a refused region
spends a Look, because the Vision Budget is wide and a second charging path was
not worth one call. Neither reason survives contact with the Baseline: the
refusal cost a round every time, the model corrected its region only to lose
the route, and the six "not legible" answers beside the refusals show the
region the model wanted was rarely the problem.

## Decision

- **A region that names a place runs.** A `look` region is read in two
  steps before anything is refused for size. It is clipped to the viewport:
  the part past an edge cannot be shown, so the request is the part inside,
  and `50,50,100,100` is the bottom-right quarter, not a crop shifted onto
  ground the model did not name. If the clipped region is still over a
  quarter of the viewport it is shrunk uniformly around its own centre — both
  sides by the square root of a quarter over its area, floored to whole
  percent so the area never exceeds the cap, the centre kept within rounding.
  No side is preferred: the rule does not know which one the model drew on
  purpose, and a uniform shrink keeps the shape it drew. There is no size
  above which a region is dropped and the Look runs plain; a model that asked
  for magnification is shown a magnified crop, and narrows from there. Only a
  string that names no place is refused: not four numbers, a zero side, an
  empty intersection with the viewport, or a region without a question.
- **The scale is the effective region's.** Zoom is still decided in code from
  the area (ADR 0032); the area is the crop's, so every crop is shown at 3x or
  more and the 2x misreads the cap was written against cannot recur.
- **The clamp is named to the orchestrator, not to the vision model.** The
  bracketed line every region Look ends with names the region as written, the
  region as shown, the quarter cap, and the zoom. The crop-extent sentence the
  vision model reads after the anti-guessing preamble names only the region it
  is looking at: it has no use for what was asked. The orchestrator is the one
  deciding whether to narrow, and the line is the moment it decides.
- **The effective region is the region.** The no-progress rail fingerprints a
  region the way the tool reads it, so two oversize regions that clamp to the
  same crop are the same inspection; a malformed string is still fingerprinted
  as written, so two identical mistakes are still a repeat. The
  `vision_request` record carries both the region as written and the region as
  shown.
- **The tool description states the consequence, after the cap.** "At most a
  quarter of the viewport" stays first; one clause follows saying a larger
  region is shrunk around its centre to a quarter. The model is told what
  happens, not invited to stop aiming.
- **An argument refusal is not an attempt.** A tool catalog entry may declare
  an admission step over its arguments. The round runs it after the rails —
  no-progress, verification, risk — and before the Vision Budget charge and
  the mark that says the call was attempted. A refused admission is a failed
  call carrying our sentence, like every other pre-execution gate: it spends
  no budget, spends no route, and the next well-formed call passes the rail.
  The step only refuses; execute reads its own arguments as it always did, and
  no other tool's signature changes. `look` declares one for the two refusals
  it still makes, the grammar and a region without a question.
  `ground_visual`'s empty-target refusal stays where it is: that tool spends no
  route, so nothing is lost by leaving it.

## Consequences

- The seven quarter refusals in the Baseline become seven Looks, and the nine
  refusals that followed them do not happen, because a Look that ran either
  answers or fails as vision itself, and only the second spends the route.
- ADR 0032's "a refused region still spends the Look" is retired without a
  second charging path: admission simply runs before the charge.
- The no-progress rail still sees a repeated mistake, because the rails run
  ahead of admission. What changes is only what the mistake costs.
- The rounding is one-sided on purpose: a shrunk region may fall a percent
  short of a quarter, never over it. A region exactly at the cap is unchanged.
- The Round Audit keys a repeat Look on the region string as written. After
  this change two written regions can be one crop; the audit's repeat count is
  therefore a floor, and the `vision_request` record is where the effective
  region is read. Changing the audit is not part of #236.
- Whether an illegible Look should answer with the page's own text is left
  where the issue left it: out. Six of the Baseline's Looks answered "not
  legible" from a full-viewport screenshot of a documentation page; that is a
  question about the vision model and the read-page route, not about regions.
- What is established here is mechanical and unit-testable: which calls the
  round refuses ahead of the charge, what the rail counts, what the crop is.
  Whether a live model narrows from the named clamp is what the three-pass
  capture is for, diffed against the Baseline's audit.

## Relationships

Supersedes one decision of [ADR 0032](0032-region-looks-re-render-from-the-page.md)
(the refusal over a quarter) and keeps the rest: compositor re-render, the
percentage grammar, zoom from the area, one Look, the named magnification.
Refines [ADR 0041](0041-a-failed-check-is-spent-until-something-can-answer-it.md):
its rule that only a check actually asked can spend a route now has an
admission step to stand on. Motivated by [ADR 0045](0045-a-round-audit-is-counted-by-code-and-judged-by-a-model-that-is-not-measured.md)'s
Baseline audit. Rides [ADR 0040](0040-a-vision-attempt-records-what-it-observed.md)'s
`vision_request` record, which gains the effective region beside the written one.
