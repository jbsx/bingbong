# ADR 0064: A quoted phrase the Run was never shown is searched unquoted

## Status

Accepted on 2026-09-21 for #267, grilled from the `fix-263-264` capture
(#263, #264) in the performance-state grill. A sibling of ADR 0055's
rewrite: a gate that transforms a search's terms and says so in the
outcome's first line. ADR 0058's Search Loop is unchanged and still counts
these rounds; ADR 0059's Search URL forms are where the terms are read.

## Context

Voyager, pass 1 of `fix-263-264`: the round-1 Composed Address 404s, and
rounds 10 to 12 then search three rewordings of one intent, each quoting a
title the model invented — `"Voyager 1 Has Not Yet Left the Solar System"`
among them. Rounds 19 and 20 do the same for the September release. No page
carries those phrases, so an exact-phrase search for them returns noise, and
the only official page the searches surfaced was the March 2013 status
update, which the Run recorded as evidence and answered from. Pass 3 loops
the same way; pass 2, the one Voyager pass that graded `pass`, broke its
loop by round 9 and reached both releases.

Reviewer said: "The right site but the wrong subject. It is the March 20,
2013 status update, not either of the two accounts the task names."

The Search Loop rail (ADR 0058) sees these rounds and notices the model at
streak 3; it never touches the terms, and the terms are the mechanism. An
exact-phrase search is a strong tool when the phrase is real. The Run has
one way to know a phrase is real: it was shown it.

## Decision

- **An Unseen Phrase is a quoted span in a search's terms that appears in
  nothing the Run has been shown.** Shown means every observation's text —
  Page Reads, listings, Action Outcomes, Look answers — the user's command,
  Steering directives and Subagent Reports, matched case-insensitively with
  whitespace runs collapsed. The user's own words are always shown: a phrase
  quoted from the command is a legitimate exact search before any page has
  carried it.
- **An Unseen Phrase is unquoted before the search runs.** The words stay;
  only the quotes go. Each quoted span is judged on its own; a span found
  anywhere shown keeps its quotes. Nothing is refused and the search runs.
- **The outcome says so** in the form ADR 0055 established: `Rewritten —
  "…" appears in nothing this run was shown, so it ran unquoted: …`. The
  model learns the rule from the outcome, not from a prompt paragraph.
- **Every search form is read alike.** A `navigate` to a Search URL by `q`,
  by a parameter named for terms or by a path segment (ADR 0059), and a typed
  search, are the same call to this gate.
- **The Round Audit counts the rewrites** per attempt beside the Composed
  Address rewrites, and the aggregate reports them by hunt. Counted, never
  gated: a rewrite that still lands on noise is visible as an Off-key round.

## Consequences

- A hallucinated title stops steering the search engine; the surrounding
  words still do. Whether that alone breaks the Voyager loops is what the
  #267 capture measures, on Search Loop rounds at streak 3 or beyond.
- The wrong-subject lock — a page of the right site and the wrong date
  recorded as evidence — gets no rail. It was reached only because the right
  pages were not; a rail comparing dates in an excerpt with dates in the
  objective would be a heuristic on one hunt's shape, and was declined.
- A phrase the Run saw in a Look answer is shown, even though a Look is a
  transcription; the gate does not rank sources of sight.

## Relationships

Sibling of [ADR 0055](0055-a-composed-address-after-the-allowance-is-rewritten-into-a-search-of-the-site.md)'s
rewrite and uses its outcome form. Leaves [ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md)'s
streak, nudge and refusal tiers as they are. Reads terms where
[ADR 0059](0059-a-search-url-carries-its-terms-as-a-named-parameter-or-as-the-path-segment-after-search.md)
parses them. Shares [ADR 0033](0033-a-ref-names-the-element-it-was-shown-as.md)'s
principle that what the Run was shown is the one ground it may act on.

## Notes

- 2026-09-21, grilled before implementation (#267). The calls this ADR
  left open:
  - **A Search Echo is not sight.** A results page repeats the Run's own
    terms in its title and in the search box's value, and the e2e fixture
    engine in its heading too, so the phrase would count as shown the round
    after it was first searched and the gate would refuse it exactly once.
    On a shown text whose source is a Search URL (ADR 0059), a line
    carrying that URL's query in full, or any quoted span of it, is an
    echo and is not sight. A result's snippet is not an echo. The one edge
    accepted: a snippet line that repeats a lone quoted phrase is dropped
    with the echoes, and the model's way through is to open the result,
    which is what the outcome asks anyway. The gate's own head never
    reaches the ledger, because the ledger records the raw outcome before
    any rewrite line is attached; nothing has to exclude it.
  - **Sight is the Run's.** The Observation ledger is created per Run and
    dies with it, and the model's wire messages are built inside the
    client and never handed back, so there is no Session-wide record of
    shown text. A phrase the model read one command ago is unquoted once
    with the outcome saying why. A Session-wide corpus was declined as a
    new store for one edge.
  - **Sight is read from the ledger, all records.** The executor gains one
    read seam in the style of `evidenceSourceUrls`, returning every shown
    text with its source URL — failed outcomes included, since the model
    read them — and the gate keeps a normalised copy per record.
  - **A worker judges against its own sight.** A browse worker runs the
    same executor with its own ledger and the same rails; its brief is
    passed ahead of the ledger so it is always seen for the worker as the
    command is for the orchestrator. The brief is not recorded into the
    worker ledger, whose frozen snapshot rides its report as provenance.
  - **Every span is judged, with no minimum length.** A lone quoted name
    the Run never saw is the same bet as a title. Straight and curly double
    quotes make a span; single quotes never; an empty or punctuation-only
    span and an unmatched quote are left alone.
  - **Matching folds what a page may print differently.** Case, whitespace
    runs, curly and straight quotes and apostrophes, dash variants, and
    punctuation at the span's edges. No stemming and no fuzzy match: a
    phrase one word off from what a page said is Unseen.
  - **The form the model chose is kept.** A `q` or named-parameter Search
    URL is rebuilt by setting that same parameter; a path-form URL replaces
    its last segment; bare terms stay bare; a typed search rewrites the
    text and keeps its trailing newline. Nothing rebuilt a `param` or
    `path` form before this.
  - **Placement.** The gate runs on the executed call after ADR 0055's
    rewrite, under the same interception and finalization conditions, with
    its own capability flag on for orchestrator and workers; when both
    fire, the address line comes first. One head names every unquoted
    span: `Rewritten — "A" and "B" appear in nothing this run was shown, so
    they ran unquoted: …`.
  - **The audit reads a stamp, not the head.** The `tool_result` event
    carries an `unquoted` stamp beside `rewritten`, mirrored on the trace
    line; the Round Audit counts the rounds per attempt, crosses them with
    Off-key, sums them in the population, and adds one by-hunt table that
    carries both rewrite kinds, since the Composed Address rewrites had
    none.

- 2026-09-21, implemented (#267, `unseenPhraseRail.ts`). Three calls the
  note above left to the code:
  - **Which lines of a results observation are echoes.** A line carrying
    the whole query — folded, and with double quotes removed on both
    sides, since an engine may print the query unquoted — is an echo
    wherever it stands. A line carrying only a quoted span of the query is
    an echo only where the engine speaks: the page title (a `title="…"`
    line or the `# … — url` header) and a ref line carrying `value="…"`.
    A result's own line — a link ref, a snippet under `page text:` — that
    carries a span without the whole query is sight, because a result
    printing the phrase is the strongest evidence the phrase is real; the
    accepted edge stays exactly as stated (a result line that repeats a
    lone quoted phrase carries the whole query and is dropped). A `url=`
    line is also read percent-decoded, so the query's own address never
    counts as sight for a one-word span.
  - **A worker's sight ahead of its ledger** is its brief and the Memory
    Entries it was handed, each as the text the request carried; the
    Composed Address rail already offers those entries' sources for the
    same reason.
  - **The Round Audit keeps a refused unquoted search in the Failed
    rounds.** ADR 0055's rewrite turns an address into a search, so a
    refusal of that search is not the model's own call and the round is
    never Failed; this gate leaves a search a search, so a refusal (the
    Search Loop cap) is the model's, and the round reads as it always did,
    with the `unquoted` marker beside it.
