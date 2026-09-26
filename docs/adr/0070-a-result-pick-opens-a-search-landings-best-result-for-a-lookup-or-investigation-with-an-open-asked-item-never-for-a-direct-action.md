# ADR 0070: A Result Pick opens a search landing's best result for a Lookup or Investigation with an open Asked Item, never for a Direct Action

## Status

Accepted on 2026-09-26 for #277, grilled the same day with every
recommendation taken. The second acting seam of [ADR 0068](0068-a-decision-model-answers-a-runs-typed-questions-inside-a-round-and-acts-only-above-a-threshold-where-the-models-move-is-already-implied.md)'s
Decision Model. Runs after the search rewrites of
[ADR 0055](0055-a-composed-address-after-the-allowance-is-rewritten-into-a-search-of-the-site.md),
[ADR 0064](0064-a-quoted-phrase-the-run-was-never-shown-is-searched-unquoted.md)
and [ADR 0067](0067-a-search-runs-on-the-run-engine-and-a-search-composed-on-another-web-engine-is-rewritten-to-it.md),
and is escape for [ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md)'s
Search Loop.

## Context

A search costs a Run one round to run and one to read the listing and open
a result — about 2 rounds per search in fix-265-267 — and the second round
often becomes another search instead, which is the Search Loop the rails of
#238, #259 and #260 notice, rewrite and cap. The listing the model reads is
an ordinary snapshot: up to 75 viewport refs printed as `[n] link "label"
href=…` and the preview's snippets. The tool descriptions already tell the
model to open a result by its href. Choosing which is a Choice over the
refs against the objective, not a generation.

One Direct Action in the corpus, `open-results`, asks for the listing
itself and is judged on the pane showing it. A seam that opened a result
there would do what the user did not ask.

## Decision

- **A Result Pick is the result of a search landing the Decision Model
  chose as fitting the objective**, with a Choice over the listing's link
  refs — label, href and the preview text as state, with the objective and
  the open Asked Items — and a Noul that any result plausibly answers it,
  both above threshold.
- **It is asked when a navigate whose executed URL is a Search URL
  (ADR 0059, as rewritten by ADRs 0055, 0064 and 0067) lands**, the Run
  Plan's tier is Lookup or Investigation, and an Asked Item is open. Never
  for a Direct Action. Never before the Run Plan intercept, which runs
  first in the same Tool Round, so a round-1 search travelling with its
  plan is judged under the declared tier.
- **The Run opens it as the model would**: a navigate to the ref's whole
  href, through the same gates and rails any navigate passes — the Risk
  Gate, the Composed Address and Delegated Page rails, a Consent Dialog
  dismissed on arrival. The tool result carries the listing's head, then
  `Opened [n] "label" — href`, then the landed page's Action Outcome; the
  Selected Passage seam (ADR 0069) then scores that page in the same
  breath when it is on.
- **It is a result opened for the Search Loop rail**, so the streak is
  broken by it; the Search Observation records the search that produced
  it as before.
- **Under threshold or unavailable, the listing is returned as today** and
  the model chooses; the Decision Record says which.

## Consequences

- A Lookup that searches, opens and reads in one Tool Round can Answer in
  the next. The Round Audit's measure is the round in which each search's
  first result was opened, and Result Picks against listings returned.
- A wrong pick lands the Run on a wrong page it can see and leave: the
  listing's head is in the same result, and `back` and the href of any
  other ref are one round away, which is what the model spends today.
- Direct Actions never see this seam, so a command to show results shows
  them. A Lookup that wants the listing itself — "what does the first page
  of results say" — is a shape the corpus does not have; if it appears, it
  is a Noul on the objective, not a tier rule.
- A Subagent's loop does not get this seam in the experiment; a browse
  worker's 12-round leash makes it the next candidate if #274 holds.

## Relationships

Acts under [ADR 0068](0068-a-decision-model-answers-a-runs-typed-questions-inside-a-round-and-acts-only-above-a-threshold-where-the-models-move-is-already-implied.md).
Reads the URL forms of [ADR 0059](0059-a-search-url-carries-its-terms-as-a-named-parameter-or-as-the-path-segment-after-search.md)
after the rewrites of [ADR 0055](0055-a-composed-address-after-the-allowance-is-rewritten-into-a-search-of-the-site.md),
[ADR 0064](0064-a-quoted-phrase-the-run-was-never-shown-is-searched-unquoted.md)
and [ADR 0067](0067-a-search-runs-on-the-run-engine-and-a-search-composed-on-another-web-engine-is-rewritten-to-it.md).
Is escape under [ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md).
Chains into [ADR 0069](0069-a-run-makes-an-evidence-checkpoint-from-a-selected-passage-grounded-by-carrying-the-passage-in-the-result-the-model-reads.md).
Opens results by href as [ADR 0033](0033-a-ref-names-the-element-it-was-shown-as.md)
lets the model do.

## Notes

- 2026-09-26, implemented (#277). The judgement lives in
  `src/core/pipeline/resultPick.ts` (`createResultPick`), created by the
  pipeline only when `decision()?.seams.has('result')`, at
  `DECISION_THRESHOLDS.result` (0.7 / 0.7); a Subagent's executor is handed
  none. The executor's per-call body became one `step`, and the pick's
  navigate is a second `step` under its own call id (`<id>:result-pick`), so
  it crosses every gate and rail as its own call and leaves its own
  Observation; the model still sees one `tool_result`, stamped `resultPick`
  with the ref, label, whole href and whether the open landed, and grounded
  on the opened page's Observation. Calls the Decision left open: "an open
  Asked Item" is a declared one, since a Lookup or Investigation plan is
  refused without one and no Asked Item closes before the Answer; the
  Choice's options are the listing's link refs less a link to another
  Search URL (only another listing) and a link inside a dialog, with the
  whole href read from the tab because the printed line cuts a long one; the
  listing's head is everything above its `page text:` line, so every ref
  stays in front of the model and only the preview gives way to the opened
  page; an open refused or failed leaves the whole listing, followed by a
  `Tried to open` line; and a Search Loop nudge the search owed is dropped
  once the open lands. The Round Audit reads the stamp as the call's
  `resultPick`, takes the opened page as where the Run settled, replays the
  open as escape, and counts per attempt `resultPicks`,
  `listingsReturned` and `searchesToOpened` (optional and outside the
  digest, so older audits read "not counted"; the call field is present
  only on a pick, so an attempt with none keeps its digest).
- 2026-09-26, "open" is #276's set. Once a Selected Passage can close an
  Asked Item (ADR 0069), "an open Asked Item" is the declared items less
  those a Run-made checkpoint closed (`openAskedItems`); the Result Pick
  reads the same set through `openItems`, so a search landing whose every
  item was already recorded asks nothing, and its state lists only the
  items still open.
