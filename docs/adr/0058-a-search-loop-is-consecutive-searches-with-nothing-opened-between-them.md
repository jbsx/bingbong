# ADR 0058: A Search Loop is consecutive searches with nothing opened between them

## Status

Accepted on 2026-09-20 for #259, grilled from the fix-257 traces after #257
closed; the defect noted on ADR 0050 is #258.
Amends ADR 0048: the Search Loop rail's streak no longer asks whether two
searches share a Search Intent, only whether anything was opened between
them. Escape is unchanged (open a result, back, any successful call that is
not inspection), the nudge and refusal tiers (#74) are unchanged at 3 and 5,
Search Intent stays as the no-progress fingerprint and the audit's aid, and
the audit still replays the rail's own code. A defect found on the same
traces — a truncated href was never an Offered Address — is a note on ADR
0050, not a decision here.

## Context

The fix-257 capture (18 Runs, three passes on 5015f60) is the first family
whose Search Observations were read against the reviewer's loops end to
end. The rail recorded 103 searches and never reached streak 3: no nudge
and no refusal fired in any Run. The reviewer placed 47 rounds in Search
Loops over the same traces. Read round by round, the reason is not the
threshold ADR 0048 declined to tune but the rule itself: live rewordings of
one intent share few words. Voyager pass 2 rounds 2–4 searched `Voyager 1
has not yet left`, `Voyager 1 interstellar space 2013` and `NASA JPL June
2013 "Voyager 1" "has not yet left" press release`; rounds 16–19 pinned one
date with four queries whose only shared token was `Voyager`. Each scored
under 0.45 against its neighbour and started a streak of its own.

What the rounds have in common is not their terms but what did not happen
between them. Of 98 results-page landings in the capture, the next
non-inspection move was another search 48 times, opening a result 31 times
(20 clicks, 11 navigates to a shown href), and a navigate elsewhere 16
times. Search rounds are 93 of 337 orchestrator rounds and 814 of 3,512 LLM
seconds; a Run spends a median 28 s on them and the worst spent 246 s.
Replayed with the rule below, the same traces mark 50 rounds at streak 2
and 26 at streak 3, against the reviewer's 47.

## Decision

**A search after a search continues the streak.** The rail keeps its
classification of every call — search, inspection, escape — and drops the
same-intent comparison from the streak: a search observation that follows
a search observation with no escape between them is streak + 1, whatever
its terms, engine or surface. A search after an escape is streak 1. The
Search Observation on the Tool Round records the streak as before.

**Inspection and a Not-found Landing still do not break it.** ADR 0048 and
ADR 0050 stand: a read, a Look, a scroll or a landing on nothing has not
left the results.

**The tiers stay at 3 and 5.** Two searches in a row are free — a second
sub-question after a first is ordinary work. The loops that cost the
capture ran four and six rounds. ADR 0045's rule against tuning to the
data judged is why the thresholds are not moved.

**The nudge names the ref.** Its advice to "open a promising result by its
href" becomes "by its ref or its href": a click by ref is the move the loop
exists to provoke and works when the printed href is cut. No other prompt
text changes; the prompt-only lever saturated on #254.

**Search Intent stays where it is used.** `queryTokens` and
`similarQueries` still feed the no-progress fingerprint, so a `site:` swap
over the same terms is one Approach, and the audit still reports the
similarity beside the streak for the reviewer. The audit's replay imports
the rail's code, as ADR 0048 required, so its count moves with the rule.

## Considered options

- **Lower the threshold.** Rejected: the live rewordings score 0.1–0.3;
  a threshold that catches them catches everything, and ADR 0045 rejected
  tuning to the judged data.
- **A semantic similarity.** Rejected: a model call inside a rail, on
  every search, to decide what a counter can decide.
- **A containment or narrowing rule.** Rejected as insufficient: the
  Voyager loops are neither.
- **Rewrite a walled engine's search.** Deferred: google.com walled 5 of
  6 searches in the capture, 0.3 rounds per Run. Recorded below.
- **A results-page observation** (title, whole href, snippet per result).
  Deferred: measure the search-again rate after this rule and the ADR 0050
  note land, and grill it only if the rate stays near half.

## Consequences

- The glossary's Search Loop entry changes to consecutive searches with
  nothing opened between them; Search Intent says what it is still for.
- On the capture's traces the nudge would have fired in the loops that
  cost Voyager and the longitude watch their budgets; whether a live model
  opens a result when told is what the three-pass capture is for.
- The rail's refusal at 5 can now fire on searches with unrelated terms.
  A Run that has searched five times without opening anything is refused
  its sixth and told to open a result or ask; that is the intended
  behaviour, and the refusal text already says how to escape.
- The audit's `mechanicalSearchRounds` becomes a count of streak members
  by the new rule, so the number that measures this ADR is streak-rule
  rounds over the reviewer's loop rounds, 22/47 on fix-257.
- Voyager's fact-01 is out of reach of any rail: the June JPL page never
  appeared in a results list in any of the three Runs, because the model
  searched for a title it misremembered, in quotes.
- A walled search engine is a known cost: google.com walled 5 of 6
  searches in the capture and the model went on to Bing or DuckDuckGo. If
  it grows, the ADR 0055 shape — a walled engine's search rewritten to the
  Run's engine in the same round — is the candidate.
- The longitude watch's pass-1 loop typed one query three times into a
  site search box blocked by an overlay; that is a Held Page matter and is
  not addressed here.

## Relationships

Amends [ADR 0048](0048-a-search-intent-is-its-terms-and-inspection-between-searches-is-not-escape.md):
its Search Intent definition and inspection rule stand, its same-intent
streak is replaced. Keeps [ADR 0050](0050-a-not-found-landing-is-neutral-and-a-composed-address-is-allowed-once-per-site.md)'s
landing-as-inspection rule; that ADR gains a note on the truncated-href
defect found on the same traces. Follows [ADR 0045](0045-a-round-audit-is-counted-by-code-and-judged-by-a-model-that-is-not-measured.md)
on not tuning to the judged data.
