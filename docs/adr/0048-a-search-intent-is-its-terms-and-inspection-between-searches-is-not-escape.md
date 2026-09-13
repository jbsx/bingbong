# ADR 0048: A Search Intent is its terms, and inspection between searches is not escape

## Status

Accepted on 2026-09-13 for #238, grilled from the Round Audit (#234, ADR
0045). Changes what the Search Loop rail compares and what breaks its streak;
the search signature (#82), the nudge and refusal tiers (#74), and the
threshold pinned by the failed-run-47 replay are unchanged. The Round Audit's
replay of the rail's rule changes with it, and the audit's count of a loop
gains its head. Note of 2026-09-14 (#239, ADR 0050): the loss accepted below
— a guessed-URL navigate that lands on a 404 still resets the streak — is
closed. A Not-found Landing is recognised by status and title, and the rail
treats it as inspection: observed, never resetting.

## Context

The Round Audit's reviewer placed ten rounds in Search Loops across the three
Baseline passes; the rail's streak rule, re-run over the same traces, caught
three. The issue that carried the finding blamed one thing: the same-intent
test is token Jaccard over the raw query, and `site:rmg.co.uk` tokenizes to
four tokens that dilute every comparison. Read round by round from the traces,
the seven misses have four causes, and the operator fold is one of them:

- One miss is the fold. Bing's `site:rmg.co.uk collections Harrison longitude
  watch` against the museum's own `Harrison longitude watch` scores 0.38 raw
  and 0.75 with the scope removed.
- Three misses are counting. The first search of a loop is streak 1, and the
  audit counts a round only once its streak is 2, so a loop's head is
  uncatchable by construction while the reviewer counts every round.
- Two misses are resets the glossary sanctioned. A scroll on the results page
  is a successful call that is not a page read, so it escaped; the reviewer
  read the same scrolls as "reads of the results". The typed search that
  followed was a search to the live rail (the nudge on watch baseline-1 round 8
  is proof the rail counted two typed queries) and invisible to the replay,
  which sees no element facts and reset on it instead.
- One miss is a navigate to a guessed URL that landed on a 404 with ok:true.
  The two searches around it already score 0.64 raw; the reset is the loss.
  Those navigates are #239's.

A narrowing (`"Harrison"` after `Harrison longitude watch`, 0.33) is missed
under every reading of the rule and is not addressed here.

The glossary's Approach entry already said that rewording a search or changing
engines does not necessarily create a new Approach. Nothing said what "one
intent" was, so the rail compared strings and the reviewer compared meanings.

## Decision

**A search's intent is its terms with its scope removed.** Scope is a search
operator with its argument (`site:`, `intitle:`, `inurl:`, `filetype:`), an
engine's uppercase connective (`OR`, `AND`), or a bare hostname given as a
term — five of the corpus's queries carry `jpl.nasa.gov`, `eurostar.com` or
`science.nasa.gov` as a scope hint, and on the Voyager rewordings it is the
host tokens that differ, not the terms. A token is a hostname by the same test
the URL normalizer uses to decide that typed text is a domain, so one rule
decides what a host is. Quotation marks and `-` vanish as punctuation and
their words stay: they emphasise terms, they do not scope them. A search that
is nothing but scope keeps the scope as its intent, so it still counts as a
search and starts or continues a streak rather than resetting one — the
invisible reset run 47 closed must not come back through the fold.

**The fold lives in the one tokenizer.** `queryTokens` feeds both the rail's
same-intent test and the query-intent fingerprint the no-progress rails
compare, so a `site:` swap over the same terms fingerprints as the same
navigate. That is the Approach entry's own rule applied to Progress
accounting, and it keeps one notion of intent rather than two that drift.

**Inspection between searches is not escape.** A page read, a Look, or a
scroll looks at what the search returned; none of them leaves the results.
The rail classifies all three as reads — observed, never resetting. Only a
call that leaves the results breaks the loop: opening a result by href or
click, back, a type outside a search input, any other successful tool. A
guessed-URL navigate that lands on a 404 is such a call and still resets;
the rail cannot see an HTTP status and a guessed URL is the "open a result"
move the loop exists to provoke. That loss is accepted and belongs to #239.

**The threshold stays at 0.45.** The run-47 replay pins it, and ADR 0045
rejected tuning a rule to the data it judges. Whether short rewordings and
narrowings still escape after the fold is for the capture to show and a
further issue to decide.

**The audit replays the rail's code, not a copy.** `audit.ts` carried its own
`queryTokens` and `similarQueries`, hand-copied and pinned only against its
own strings. It imports the rail's pure functions instead, and its test pins
that the replay and the rail agree. A replay of a rule that does not run the
rule's code is not a replay.

**The audit counts a loop's head.** Once a streak reaches 2, the round that
started it is a Search Loop round too. The audit marks it in a pass over the
attempt's calls after the digest is built, without changing the head's kind or
reason, so the digest hash — and the reviewer cache keyed on it — is
untouched by the count.

**Typed searches reach the replay through the trace, as a separate issue.**
The trace does not keep element facts, so the audit cannot classify a `type`
call as a search; today it resets on one. The rail records what it observed —
a search observation with its query and surface — on the Tool Round, so the
audit replays what the rail saw. That is a trace-shape change outside this
issue's files; it is its own issue and blocks #238's capture, because the
number #238 promises to move — streak-rule rounds against the reviewer's — is
navigate-only until the trace carries the typed half.

## Considered options

- **Keep the operator's argument as one token** (`rmg.co.uk` rather than
  nothing). Rejected: the scope still costs a token of Jaccard on short
  queries, which is the dilution the audit found, and a scope change is the
  same move as an engine change, which the glossary already says is not a new
  Approach.
- **Fold only in the rail's similarity, not the shared tokenizer.** Rejected:
  two tokenizers for one notion of intent is exactly how the audit's copy
  drifted; the action-fingerprint consequence (a `site:` swap is the same
  navigate) is wanted.
- **Treat a scroll as escape, overruling the reviewer.** Rejected: the
  Progress entry already treats a scroll as movement of the window rather
  than new evidence, and the loop's rule is about leaving the results, which a
  scroll never does.
- **Detect the 404 landing from the page title.** Rejected: fragile, and it
  would reward guessing URLs between searches. #239 owns the guessing.
- **A containment rule for narrowings.** Deferred: a second change to the
  same-intent test with one example; the capture will show whether it recurs.
- **Count typed searches in the audit from the nudge Notice.** Rejected: the
  nudge fires at streak 3, so it hides the rounds where a fold turns streak 2
  into 3.
- **Fold the trace change into #238.** Rejected: it has its own shape and its
  own tests; the two issues share one three-pass capture instead.

## Consequences

- Two glossary changes: the Search Loop entry names inspection (read, Look,
  scroll) as what does not break it, and a new term, Search Intent, says what
  "one intent" is without the threshold or the tokenizer.
- On the audited corpus the fold alone moves the streak rule's count from 3
  to 4; the scroll rule and the head count move it further; the typed half
  waits on the trace issue. The capture's number is honest only once all
  three land, which is why the issues share one three-pass set.
- A `site:` swap over the same terms is now a repeated navigate to the
  no-progress rails as well as to the Search Loop rail. A model that narrows
  by scope alone will meet the no-progress Notice sooner.
- `"Harrison"` after `Harrison longitude watch` still starts a new streak.
  Recorded here so the next audit does not rediscover it.

## Implementation notes

- The rule lives in `src/core/pipeline/searchLoopRule.ts`: `queryTokens`,
  `similarQueries` and `isSearchInspection`. It is its own module because the
  audit runs under plain Node's type stripping, which cannot load
  `progressFingerprints.ts`'s extensionless import graph; the rule imports
  only `urlInput.ts`, with its extension. The rail and
  `progressFingerprints.ts` import from it, and `audit.ts` re-exports the
  rule's `similarQueries` so its test can pin that they are one function.
- The hostname test is `looksLikeDomain`, which `normalizeUrlInput` now calls
  too. Review found the normalizer's old test took any dotted word for a
  domain, so the fold would have dropped `v1.3` or `No.1` from a Search
  Intent. The one test now needs a host to end in an alphabetic (or punycode)
  top-level label, so a version stays a term, and typed into the address bar
  it is searched rather than opened as `https://v1.3`. Every dotted word the
  audit replays over the Baseline is a real hostname, so no Baseline number
  moves with it.
- A search that is nothing but scope is compared against the other search
  scope and all (both searches' raw tokens), so `site:rmg.co.uk` after
  `site:rmg.co.uk collections Harrison longitude watch` continues that streak
  (0.5) instead of starting its own, while `site:rmg.co.uk` after a search on
  other terms, or `site:nasa.gov`, does not.
- An operator's argument is the rest of its token, the whole quoted phrase
  when the token opens a quote (`intitle:"longitude watch"`), or the next
  token when the operator stands alone (`site: rmg.co.uk`). A leading `-`
  does not hide an operator (`-site:ebay.com` is scope).
- The head count is `searchLoopHeads` on an attempt's mechanical record,
  beside `rounds`, and `mechanicalSearchRounds` counts the union of the
  rewording rounds and the heads. A round's table row in the report carries
  `loop head by the streak rule`.
- Replayed over the three Baseline passes before #243: 6 rounds by the
  streak rule against the reviewer's 10 — Voyager baseline-1 rounds 2, 3, 4
  and watch baseline-3 rounds 8, 9, 10. Of the 18 digests only watch
  baseline-3's changed: the fold made its round 9 a rewording. The head count
  changed none, so Voyager baseline-1's cached judgement still stands.
