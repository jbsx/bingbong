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
  a page past 255 blocks is picked in two passes, a window then a block.
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
