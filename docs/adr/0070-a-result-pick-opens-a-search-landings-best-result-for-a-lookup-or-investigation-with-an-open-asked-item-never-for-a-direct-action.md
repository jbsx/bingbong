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
- 2026-09-28, the Selected Passage is removed (#283, ADR 0069 superseded).
  Nothing closes an Asked Item during a Run any more, so "an open Asked
  Item" is every item the Run Plan declares, and a landing opened by a
  Result Pick is read and recorded by the model as any other.
- 2026-09-28 (#294, grilled; findings on #303): the reviewer's digest shows
  a Result Pick from `audit-p4` on — the label and address of what was
  opened, on the search's call — and the prompt says what one is. Until
  then the reviewer could not see one: the digest printed no pick, and the
  `Opened` line lies past the head it keeps of a result. Thirteen rounds
  holding a pick sat inside a reviewer loop across `jev-on`, `fix-281`,
  `fix-283` and `fix-288-290`. Two opened a real page the model read in
  the next round. Eleven opened one link, the "Objects" tab of rmg.co.uk's
  navigation, on a listing that showed no results, and put nothing new in
  front of the Run; the reviewer was right to keep those in the loop. One
  of the thirteen was read from its trace (`fix-288-290` pass 1, longitude,
  round 16: picked at confidence 0.91, a search again in round 17) and the
  rest from their audits. Whether the pick should refuse a link that is no
  result, or the rule should hold on an open that lands back on the
  listing, is #303's to decide and is not changed here.
- 2026-09-28 (#303, grilled with every recommendation taken): the Choice
  is over the links of the whole page, not the viewport's refs. The fault
  was the candidate list, not the Search Loop rule, which is unchanged
  (`SEARCH_STREAK_RULE` stays 3, no audit is recounted).
  - What was found. Sixteen acted picks, not eleven, chose the "Objects"
    tab: five more in `fix-291-2` and `fix-291-4`. Of 318 Decision Records
    of the result seam 52 acted, 36 on DuckDuckGo listings, all of which
    opened an off-engine result, and these 16. The rmg.co.uk listing held
    its results (24 links in the document) below the fold: after a
    navigate, 0 of 89 snapshots of that listing carried one as a ref, so
    the five options were the site's home, "BETA", "Objects", "Library"
    and "Archive". The tab sits inside `main`, so a landmark would not
    have told it from a result. 13 of the 16 landed on
    `/collections/object`, which is neither the listing nor a Search URL,
    so the rule could not have told the open from a result opened by its
    address. An engine's listing is cut the same way: 2 or 3 results in
    view, on a page 1.6 to 5.1 viewports tall.
  - Candidates. Every link of the document that has size and is not
    hidden, inert or inside a dialog, in document order, less a link that
    is not http(s) and a link to another Search URL, as before. Links to
    one address by URL fingerprint are one candidate, carrying the longest
    label. The list is cut at 100. Site chrome stays in it. The bars stay
    at 0.7 / 0.7.
  - Naming. The Choice's options are numbered by position in that list,
    never by snapshot ref. The stamp's `ref` is written only when the link
    is a ref the listing showed. The model reads `Opened [n] "label" —
    href` when there is one and `Opened "label" — href` when there is
    none; the Round Audit reads both.
  - The picked href is an Offered Address from the moment it is picked
    (ADR 0055), so a result below the fold is never rewritten into a
    search of its site. The rest of the list is not offered.
  - When the page's links cannot be read, or there are none, nothing is
    asked and the listing is returned as it is. The viewport's refs are
    never the fallback.
  - The Decision Record of the result seam carries its candidates: label,
    href, and ref where there is one. Run Trace version 9. The Shadow
    Replay reads the recorded list on a version 9 trace and rebuilds the
    options from the listing's head on an older one.
  - Rejected. A Noul bar of 0.82 drops all 16 and 6 of the 36 good picks,
    and is set on one site's scores. Dropping candidates by host or path
    drops a site's own results, which are on the listing's host. Holding
    the streak on every picked open puts a false Notice on the search
    after each good pick.
  - It closes on tests and one e2e fixture, a listing taller than the
    viewport with site chrome in view and results below, with no capture.
    The next capture taken for any reason reports, ungated: picks that
    opened a link of the listing's own chrome, Result Pick timeouts, and
    the option count. The landed line that named the listing's address in
    three of the rounds is #308.
