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
