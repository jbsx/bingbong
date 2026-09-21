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

**Note (#259 implementation, 2026-09-20).** For the count to move with the
rule on a capture already taken, the audit cannot read the streak off the
Search Observation, where ADR 0049 had it take the number the rail recorded:
fix-257's observations carry the same-intent streak. So the audit takes
from the observation what only the rail could know — which calls were
searches, their query and signature — and replays the streak by the rule
(`searchStreakAfter`, `searchStreakMoveOf` in `searchLoopRule.ts`, the same
functions the rail runs). On a trace the current rail wrote the two agree
(pinned in `audit.test.ts`); on fix-257 the replay is what recounts it. The
similarity rides beside the streak as `rewords` from streak 2, and the
Progress reason of a search at streak 2 or beyond names the rule: "a search
after a search with nothing opened between them", rewording noted when it
is one. The digest a reviewer is shown changes accordingly, so a cached
judgement of an old capture re-keys if that capture is ever re-audited. The
committed fix-257 audits are unchanged: the Fix Ledger recounts an audit
that predates the two new counters from its rounds, by the same replay, when
it reads it (`recountedStreakRoundsOf`), so the marginal against fix-257
compares the rule with itself; `mechanicalSearchRounds` stays as each audit
wrote it. The recount is pinned in `audit.test.ts`.

The recount on the audit's own population — the orchestrator's rounds,
which is what the reviewer's 47 loop rounds are over — is 37 rounds at
streak 2 or beyond and 22 at 3 or beyond, against 11 and 0 as written, and
52 Search Loop rounds by the rule (heads included) against 22. The 50 and
26 above counted the Browse Subagents' own rails with the orchestrator's;
the audit reads the orchestrator's rounds only (ADR 0049), so the gate for
#259 is read on 37 and 22.

**Note (#259 close, 2026-09-21).** The AC5 gate as written — streak-rule
rounds over the reviewer's loop rounds rising from 22/47 — fell on the
shared capture (`fix-258-259`, judged under `audit-p2`): 11 at streak 2 or
beyond and 4 at 3 or beyond over 24. It fell because the reviewer's
definition of a loop (rewordings of one intent, however far apart) stopped
matching this ADR's once the rail worked: it nudged four times, all in
Voyager pass 3, the model opened a result the round after every nudge,
no refusal fired, and search seconds per Run fell from a median of 28 s to
5 s. The owner closed on the mechanism and had the gate re-stated over the
reviewer's *consecutive* loop rounds. The Round Audit's reviewer prompt now
defines Search Loop membership as this ADR does (`audit-p3` in
`scripts/live-audit.ts`), and the same eighteen attempts were re-judged
under it — the digests are unchanged, so only the judgement moved. The
reading: the reviewer marks 23 loop rounds and the rule 17 (heads
included), every rule round inside a reviewer loop, 17/23 against the
issue's 22/47. The six rounds the reviewer counts and the rule does not are
three mechanisms, none a rewording the rule was built not to count: a site
search submitted by a path URL with no `q=` (rmg.co.uk
`/collections/objects/search/<terms>`, three rounds in the longitude watch
of pass 1), which the rail does not observe as a search; a click that
changed no URL and left the Held Page overlay in place, taken as an opening
between two blocked searches (two rounds, pass 2); and a navigate that
landed on a wall (the Internet Archive's offline page), taken as an opening
(one round, Voyager pass 2). Each is a candidate for an issue of its own;
none is a threshold matter. An `audit-p3` audit cannot be aggregated with an
`audit-p2` one, and the Fix Ledger marks the reviewer-prompt axis on a
marginal across the two; the fix-257 audits stay under `audit-p2` and were
not re-judged.

**Note (#261 grill, 2026-09-21).** The second of the three mechanisms named
above — a click that changed nothing under an overlay, two rounds in pass 2
— is not what the trace shows. The museum's collections page carried a
Cookiebot consent banner the snapshot did not detect as a dialog
(`dialogOpen=false`), so the Consent Dialog auto-dismiss never ran; the
first typed search of every longitude Run in the capture was blocked by its
underlay, and every Run then clicked "Reject all cookies" by hand. Pass 2's
round 3 is that click: it removed ten refs, shortened the page by 572 px and
made the collection search box reachable, and its outcome said `page
signature changed` because the page changed. Round 4's block had another
cause — ref 26 before the banner and ref 16 after it are one element, the
site header's "Search e.g. cutty sark" input inside a closed search drawer,
never reachable — and round 6's click on that drawer's "Close" was blocked
too. So the reviewer misread round 3, the rule's escape there was right, and
those two rounds are not the rule's to count: the 17/23 denominator is read
as-is, and the reviewer prompt is not changed for one misjudgement. What
survives is smaller and general. A Blocked Action — the port's `not clicked
— blocked by overlay` and `not typed — blocked by overlay` — and an inert
click (the concise line the controller returns when a click moved no URL,
dialog, element state or page signature) are `ok:true`, and the rail took
each as escape. One such reset exists across every live trace on disk: pass
2's round 6, streak 1 → 0. #261 is re-scoped to it. A Blocked Action or an
inert click holds the streak, decided by one helper beside
`landedOnNotFoundPage` that reads the port's fixed outcome heads (as
`browserTools.ts` already reads `urlChanged=true`), the heads owned in one
shared constant so the controller, its double and the helper cannot drift,
and replayed by the audit over the trace's full result text, which it
already holds. A blocked type into a search input stays a search: the gate
classifies before an outcome exists, and ADR 0049 observes a search
whatever its outcome. The audit counts Blocked Actions and inert clicks that
reset a streak (1 on fix-258-259), expected 0 on the shared capture with
#260 and #262, gated on nothing; the "2 → 0" the issue wrote cannot be met
by any rail rule and is dropped. The round cost in the capture is elsewhere:
the undetected consent banner, two rounds per longitude Run in all three
passes (#263), and the blocked outcome that names no cover, which sent pass
2 hunting for a dialog through rounds 6–8 (#264).
As built, the heads and the helper (`blockedOrInertAction`) live in
`src/core/browser/actionOutcome.ts`, beside `notFoundPage.ts`. The audit's
`blockedOrInert` counter records every Blocked Action and inert click, and
those met at streak 1 or beyond: under the current rule none of those
resets the streak, so on a new capture the counter says how often the hold
fired, not how often a reset slipped through (fix-258-259 reads 5 Blocked
Actions, 0 inert clicks, 1 inside a streak).

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
