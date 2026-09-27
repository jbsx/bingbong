# ADR 0069: A Run makes an Evidence Checkpoint from a Selected Passage, grounded by carrying the passage in the result the model reads

## Status

Accepted on 2026-09-26 for #276, grilled the same day with every
recommendation taken. The first acting seam of [ADR 0068](0068-a-decision-model-answers-a-runs-typed-questions-inside-a-round-and-acts-only-above-a-threshold-where-the-models-move-is-already-implied.md)'s
Decision Model. Amends the Evidence Checkpoint's origin, not its rule:
[ADR 0054](0054-an-excerpt-is-every-passage-verbatim-and-a-mis-shaped-checkpoint-call-is-applied-as-the-call-it-evidently-is.md)'s
verbatim test and [ADR 0056](0056-the-finalization-bookkeeping-round-is-skipped-when-there-is-nothing-new-to-record.md)'s
skip read a Run-made checkpoint exactly as a model-made one.

## Context

In fix-265-267 the orchestrator spent 3.8 rounds per Run, 54 s, on rounds
whose only call was `record_evidence`, and 3.1 rounds reading Page Read
parts to find the passage to quote. #254's Notice and #256's skip trimmed
the edges; the rounds remain because the model must see the passage before
it can quote it, and the landing shows it 1,800 characters of a page whose
whole text the snapshot already collected.

An Evidence Checkpoint's excerpt is verbatim, tested against the raw tool
result the model saw for that URL — the ledger payload, not a stored page
(ADR 0054). A passage picked from deeper in the page than the Page Preview
would fail that test, because the model was never shown it. That constraint
shapes the design rather than blocking it: the passage has to reach the
result the model reads.

## Decision

- **A Selected Passage is one text block of a landed page or a Page Read
  that the Decision Model chose as stating an open Asked Item**, with a
  Choice over the page's id-prefixed blocks and a Noul that any block does,
  both above threshold. Blocks are the collector's own — a paragraph, a list
  item, a table row, a container's prose run (ADR 0047) — in document order;
  a page past 255 blocks is asked about in Passage Spans, each as a page
  would be.
- **It is asked on a navigate or click landing and on a read_page result**,
  once the Run Plan is declared with an Asked Item not yet checkpointed in
  this Run. Never on a scroll or a Look; never for a Direct Action, which
  declares none. An item already recorded is not asked again.
- **The passage is carried in the tool result**, one line per Asked Item —
  `Selected passage for "<item>": <block verbatim>` — after the Action
  Outcome's own text. The ledger records the whole result, so the excerpt is
  supported by the same rule as any other: nothing in the checkpoint
  evaluator changes, and nothing is stored that the model did not see.
- **The Run records the checkpoint itself**, through the same
  `checkpointEvidence` seam the tool calls, with the landed URL as source,
  the block as excerpt and the Asked Item's wording as observation. It
  enters the Run's accepted checkpoints and the Session commit as one the
  model called would, with its origin — `run` rather than `model` — kept
  on the trace event and the Memory Entry. The result then says
  `Recorded as evidence for "<item>".` so the model does not record it
  twice.
- **The rails treat it as the model's own move.** It counts for
  `newSinceCheckpoint`, the bookkeeping-only Notice and the Finalization
  skip; it is a Held Page's observation; it is one Evidence Checkpoint, not
  a second kind through every rail.
- **Under threshold or unavailable, the result is untouched** and the model
  reads and records as today; the Decision Record says which.

## Consequences

- A Lookup whose landing states the fact has its evidence before the model
  reads the result, so the next round can be the Answer. The bookkeeping-only
  count and the Page Read count per Run are the Round Audit's measures.
- The excerpt is verbatim by construction, so ADR 0054's `excerpt_unsupported`
  rejections cannot come from this path; a wrong pick is a wrong passage
  recorded against the item, visible to the model in the same result, and
  the model may record a better one — two checkpoints on one item merge as
  they do today.
- read_page keeps its part argument and its Page Read; it becomes the
  fallback when a landing scored nothing, not the habit. Picking which part
  to read is not done: the landing's whole text is scored instead.
- A Subagent's loop does not get this seam; it has no `record_evidence` and
  writes a Report.

## Relationships

Acts under [ADR 0068](0068-a-decision-model-answers-a-runs-typed-questions-inside-a-round-and-acts-only-above-a-threshold-where-the-models-move-is-already-implied.md).
Depends on [ADR 0054](0054-an-excerpt-is-every-passage-verbatim-and-a-mis-shaped-checkpoint-call-is-applied-as-the-call-it-evidently-is.md)'s
ledger-payload test, which is why the passage is carried. Reads the blocks
[ADR 0047](0047-a-page-is-read-in-one-round-and-an-action-outcome-carries-a-preview.md)
collects. Feeds [ADR 0056](0056-the-finalization-bookkeeping-round-is-skipped-when-there-is-nothing-new-to-record.md)'s
predicate. Chains after [ADR 0070](0070-a-result-pick-opens-a-search-landings-best-result-for-a-lookup-or-investigation-with-an-open-asked-item-never-for-a-direct-action.md)'s
opened page in the same Tool Round.

## Notes

- 2026-09-26, implemented (#276). The seam lives in
  `src/core/pipeline/selectedPassage.ts` (`createSelectedPassageSeam`),
  created by the pipeline only when `decision()?.seams.has('passage')`, a
  Session can take the checkpoint and the tab can be read
  (`BrowserController.pageTextBlocks`, the freshest snapshot's rendered
  blocks), at `DECISION_THRESHOLDS.passage`; with the seam off nothing is
  asked, not even in shadow. It runs inside the executor's per-call `step`,
  after the call and before the ledger records it, so a Result Pick's
  opened page is asked about as its own navigate; the passage is carried in
  what the ledger records and the model reads, while every rail reads the
  outcome the tool produced, so a carried passage offers no address and
  arms no wall. **A search results page
  is never asked about** (a landing `parseSearchUrl` recognises): its
  snippets are the engine's excerpts of other pages, and one recorded as
  evidence sourced to the search URL would let the engine's words stand as
  the source. Calls the Decision left open: all open items go in one ask,
  as `pick_<n>` and `any_<n>`, each item judged on its own pair, so the
  Decision Record reads `acted` when any item's pair cleared; a page past
  255 blocks asks the Noul with the window Choice, then one Choice per
  item over its window's blocks, and both records carry `windowed: true`; a
  block past a Memory Entry's 2,000 characters is carried and recorded as
  its head, cut at a word, still verbatim; asking again over identical
  text, URL and items is skipped (a read_page after a landing that scored
  nothing). "Open" is declared less the items a Run-made checkpoint closed
  in this Run (`openAskedItems`); the model's own record_evidence names no
  Asked Item, so it closes none, and a Steering replan keeps what closed.
  The origin is `origin: 'run'` on the `evidence_checkpoint` record, the
  commit input and the Memory Entry's provenance, absent for the model's
  own — the only change to `evidenceCheckpoint.ts`, whose grading is
  untouched; the no-Progress rail hears the checkpoint as a successful
  record_evidence. The Round Audit counts per attempt `runMadeCheckpoints`
  (read from the trace's origin, never joined to a call) and
  `modelRecordEvidenceCalls` beside the bookkeeping rounds, outside the
  digest.
- 2026-09-27, grilled from the #274 live traces (#281), every
  recommendation taken. The seam acted on 1 of 83 asks because its Noul bar
  was read from a different question (the note on ADR 0068); the Noul is
  the bar that decides — of 477 item pairs under threshold none failed on
  the Choice alone, and Choice confidence does not predict agreement (0.60
  to 0.65 at every bar). **The bars are Choice 0.7 and Noul 0.8**, agreeing
  with the model on 14 of 16 scored acts; no setting reaches 0.9 over ten,
  and the lower Noul bars that pass only under the repaired truth are not
  taken. It is one bar for landings and Page Reads: 82 of the 83 asks were
  landings, since a Page Read after a landing holds the same text and is
  not asked again, which stays. **The question carries the Objective**,
  because the wrong picks were the right field of the wrong object — an ID
  row of an unrelated catalogue entry — and the bar is re-read from one
  Shadow Replay after that change, 0.7 and 0.8 standing if it scores fewer
  than ten acts. That replay runs over the on arm's landings whose text can
  be rebuilt and the off arm's whole Page Reads; an off-arm landing cannot
  be replayed, the trace holding its Page Preview and not its text, so **a
  passage Decision Record keeps the passage chosen and, when tracing, the
  text asked over**. The replay's truth credits a quoted table row however
  short, and credits a Page Read of the same page to its landing. **A
  Not-found Page and a walled landing are not asked about.** Windowed
  pages are left to their own issue: no block pass has ever run. If the
  Run-made checkpoints the model did not record again are under 15% of its
  accepted checkpoints on the capture's initials, `passage` leaves the
  default seam list and this ADR says so; the code stays behind the list.
- 2026-09-27, implemented (#281), the bars before the capture. The seam's
  questions, state and landing test live in
  `src/core/pipeline/passageQuestions.ts`, which the Shadow Replay imports,
  so the replay asks exactly the seam's `pick_<n>` and `any_<n>`, each
  naming the Run Plan's Objective, over exactly its state. Beside a
  Not-found Page and a wall, an Unavailable Page is not asked about either:
  it is the Result Pick's own test, and no 5xx page states an item. A
  passage Decision Record keeps `passages` (the block each Choice chose, by
  question key, acted or not) and `askedText` (the state) when the Run
  traces. **The replay** (`e2e/eval/jev/shadow-2026-09-27.json`) sampled
  the 33 `jev-on` landings whose text rebuilds exactly — from an uncut Page
  Preview, which is the whole text, or from a later whole or every-part
  Page Read of the page, a rebuild counting only when its state is as long
  as the record's `stateChars`; 18 could not be — and 28 whole Page Reads,
  26 of them `jev-off`'s and 2 on-arm reads the seam would ask; 188 asks,
  365 item pairs, 8 not comparable, Jev median 252 ms. It carries the
  unrepaired truth beside the repaired one so Decision 3 is applied by the
  report, not by hand. With the Choice at 0.7, no Noul bar agrees 0.9 over
  ten scored pairs; Noul 0.5 and 0.6 meet 0.8 only under the repaired truth
  (0.81 and 0.82 against 0.64 and 0.71); **Noul 0.7 meets it under both**
  (21 of 24, 15 of 16), and 0.8 rests on six. So Decision 7's fallback does
  not apply and **the bars are Choice 0.7 and Noul 0.7**, not the 0.8 this
  note's grill read before the Objective entered the question. At them the
  seam acts on 8.7% of pairs: 21 agree, 3 do not, 7 fall where the model
  recorded nothing, judged 5 right and 2 weak (a part number for the case's
  own ID; K1 named without its name), none wrong. The Round Audit counts a
  Run-made checkpoint recorded again at two strengths, since the model's
  call names no Asked Item: from the same page (an upper bound, the reading
  of the #274 act) and with the same passage (a lower bound).
- 2026-09-27, grilled from the `jev-on` and `fix-281` traces (#282), every
  recommendation taken; the Decision's sentence on a page past 255 blocks
  is reworded in place. The two passes never reached the second: 19
  windowed asks in `jev-on` and 11 in `fix-281`'s first two passes, all
  under threshold, the window Noul never past 0.64. The window pass was
  asked to find a passage in fragments — the whole page in one state, so
  each block cut to 80 characters at 743 blocks and 36 at 1,639, a window
  described by its id range alone — and the block pass it guarded carried
  no Noul, so a checkpoint would have been made on a Choice whose
  confidence #281 found does not predict agreement. **A page past 255
  blocks is asked about in Passage Spans**: consecutive runs of at most
  255 blocks in document order, each asked the seam's ordinary `pick_<n>`
  and `any_<n>` over its own blocks, in parallel; per Asked Item the
  clearing pair with the highest Noul is the Selected Passage. A window
  described by its headings was not taken: it keeps a routing question no
  bar was ever read for. **No Evidence Checkpoint is made without a Noul
  over the text its Choice read.** A page past 8 spans (2,040 blocks) is
  not asked about and its Decision Record says so; a span whose ask is
  unavailable is recorded as such and the spans that answered are used.
  The bars start at the one-pass bars, Choice 0.7 and Noul 0.7, and one
  Shadow Replay may raise them under #281's floor (0.8 agreement over at
  least ten scored acts), never lower them: a page has as many chances of
  a false clear as it has spans. That replay scores a page, not a span —
  the winning pair against the model's checkpoint on the visit — over the
  six `jev-on` pages re-collected with the seam's own collector, a page
  counting only when its rebuilt state is as long as the record's
  `stateChars`, since a Page Read's parts do not give back the seam's
  blocks (685 lines against 743 on the camera documentation). A Decision
  Record on such a page keeps the whole block list when the Run traces.
  **If the replay scores fewer than ten acts at the floor, a page past 255
  blocks is not asked about at all**, which returns the 300 to 390 ms each
  such landing spends today; where it falls short for lack of pages that
  re-collect rather than lack of clears, that gate waits for the first
  capture that keeps block lists. None of this is built while Decision
  16's outcome on `fix-281` is unrecorded: with `passage` off the default
  seam list, #282 closes with it.
- 2026-09-27, Decision 16 applied to the `fix-281` capture (#281):
  **`passage` has left the default seam list**
  (`DEFAULT_DECISION_SEAMS` is `result` and `tier`); the code stays behind
  the list and `BINGBONG_DECISION_SEAMS=passage,…` turns it on. Three
  passes on 77a7431 at Choice 0.7 and Noul 0.7, against `jev-on-1..3`, on
  initials: the bars did what they were re-read to do — Run-made
  checkpoints 1 → 21, from 10 of 56 asks that acted, none recording a wrong passage (judged
  16 right, 5 weak: a part number for the case's own ID, K1 for the other
  watch's name twice, two Eurostar items quoted from the Musicians' Union
  page) — and the seam spared the model nothing. After every one of the 21
  the model recorded again from the same page, and after 14 it quoted the
  same passage, so the Run-made checkpoints not recorded again are 0 by
  the page rule and 7 by the passage rule: 0% to 12.7% of the model's 55
  accepted checkpoints, under 15% by either. The model's own accepted
  checkpoints rose (49 → 55) and the bookkeeping-only rounds with them
  (3.00 → 3.25 per Run); the wording `Recorded as evidence for "<item>"`
  did not stop a second record, which the issue left unmeasured until
  now. Of the capture's four gates one was met (Run-made checkpoints at
  least 10) and three were not: bookkeeping-only rounds below the
  Reference's, judged precision at least 0.8 (0.76 counting a weak pick as
  a miss), initials verified not below 9 of 12 (8 of 12; the pooled Run
  median 178.6 → 210.1 s). Three passes cannot tell 8 from 9, so the
  capture does not show the seam costing correctness; it shows it buying
  nothing. An unset seam list in a report written before this note meant
  every seam, passage included, and reads `unset (every seam)`; after it,
  `unset (the default seams)`. Result Pick is unaffected. #282's Passage
  Spans close with this, by their own note above.
