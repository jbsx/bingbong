# ADR 0044: A cross-pass summary reads reports, and refuses what it cannot check

## Status

Accepted on 2026-09-12 for #233. Extends the `live:report` contract (#226)
by one report version; changes nothing #226 derives.

## Context

A Baseline is several Passes read together (#223: three, on one route, under
one Grading Key version and one reviewer). `pnpm live:report` takes one
capture set by design, and the three-pass picture — every result, and
min / median / max per task — existed only in prose written by hand from
three reports, where nothing would notice if it drifted from them.

## Decision

`pnpm live:summary` reads N `live:report --format=json` files named
explicitly, never the capture sets or the grades behind them, and writes one
summary. Every input must agree on everything the protocol fixes — key
version and digest, routing for every role, the prompt version of every
task, the reviewer, the study, the protocol version, the mode, the adblock
setting and the effort overrides — or the command refuses and names the
values that differ. Commit, dirty tree and grades revision are listed per
input and never compared. A set whose state is not `complete` is accepted
with a warning, because a short Pass is a finding and not a protocol break.

So that the summary can read what it checks rather than be told it, the
report gains version 2: `provenance.reviewers` (the distinct reviewer
identities over reviewed entries) and `promptVersion` on every row. The
summary accepts only version 2.

## Considered options

- **Re-derive from captures and grades.** Fresher, and independent of the
  report's version. Rejected: it is a second implementation of the
  disposition, grade-binding, timing and usage rules, and the two would
  diverge silently — the failure this command exists to remove.
- **Merge across routes or reviewers with a column for each.** Rejected: a
  comparison across routes is a different document with a different
  question. A Baseline is one route by protocol, and mixing is a break, not
  a merge.
- **Assert the reviewer with a flag.** Rejected: an operator-typed claim is
  the hand-written statement the summary replaces, and the reviewer is a
  model identity — as much a protocol fact as the routing.

## Consequences

- Provenance fields are added to the report only when the summary must
  check them; the report does not grow otherwise.
- Min, median and max only, over N Passes, with a median of an even count
  taken as the mean of its two middle values; no p95, mean or interval at
  any N, and the summary says so in one line.
- The JSON inputs are committed beside the summary, so the summary's own
  provenance can be re-read from the repository.
