# ADR 0050: A Not-found Landing is neutral, and a Composed Address is allowed once per site

## Status

Accepted on 2026-09-14 for #239, grilled from the Round Audit (#234, ADR
0045). Adds a recognition the app did not have, a rail beside the Search Loop
and Blocker rails, and a third neutral case to Progress. Closes the loss ADR
0048 accepted: a guessed navigate that lands on a 404 no longer resets a
Search Loop.

## Context

Nine navigates in the Baseline landed on a not-found page and were counted as
Acquisition with Progress, because the settled page moved. Seven were judged
Off-key. Six are one attempt: Voyager baseline-1 composed six slugs for
NASA's September 2013 release across jpl.nasa.gov, www.nasa.gov and
science.nasa.gov, two per host, in rounds 1, 5, 7, 9, 22 and 24, and reached
the June release only in round 15, by search. The model's own reasoning
named the pattern ("guessing release numbers is risky") and guessed. The
captures after #235 and #237 show more of it: composed Eurostar and Raspberry
Pi addresses land not-found in nearly every attempt, the model clicks on the
not-found page and stays there, one attempt returns to a dead address it had
already hit, and the reviewer flagged four times that a landing on nothing
should not read as Progress.

Nothing in the app recognises a not-found page. The Blocker classifier knows
three signals, none of them this. Electron's navigation event carries the
HTTP response code and the app's listener binds only the URL, so no status
reaches the outcome, the settled state or the Run Trace. The model sees a
title — "404 - Page not found: …", "Page Not Found - NASA", "Page not found –
Raspberry Pi", "Sorry, we can't find the page" — and a body that sometimes
never says 404. ADR 0048 could not see any of this and accepted that such a
navigate resets the Search Loop streak, naming this issue as the owner.

Two facts from the traces shaped the rule. The Voyager guesses alternate
hosts on one site, so a per-host allowance would catch three of six. And two
of the nine landings recovered on the very next navigate to the same host,
one inside the same round, so a rule that refuses the next navigate outright
would have refused the recovery.

## Decision

**A Not-found Page is recognised by status first and title second.** The
response code of the top-level navigation is bound from the event the app
already listens to and carried on the settled state; 404 and 410 are not
found. A title test in the Blocker classifier's style — "page not found",
"not found", "can't find", "couldn't find", "doesn't exist", a bare "404" —
catches a soft 404 served with 200. Every corpus page passes the title test;
the status is there because it is a fact the site asserted, not a guess at
its prose. Other statuses are other things and are not touched.

**It is not a Blocker.** A Blocker has content behind it and an Escalation
that reaches it; a Not-found Page has neither. The classification runs in the
same wrapper, after the same settle, and produces a sibling marker line,
`NOT-FOUND:<status|title> <host>`, followed by one sentence of advice. The
marker rides every action that settles on such a page — navigate, back,
forward, and click — because it is a fact about the page, like End of Page,
and belongs in the observation rather than in a Notice. The Notice entry is
untouched.

**A Not-found Landing is neutral to Progress.** Not Progress: the page carries
nothing. Not a no-Progress action: counting it would have exhausted two
Approaches and ended the Voyager Run around round 9, before its round-15
success. So it resets no accounting, and the audit's mechanical kind reads
Acquisition without Progress with the reason "landed on a Not-found Page",
which answers the reviewer's flags with one rule in one place.

**A Composed Address is allowed one Not-found Landing per site per Run.** A
gate refuses before executing and cannot know what the next address will
find, so it refuses a kind of navigate. The kind is the Composed Address: a
URL the model was not shown this Run. Offered is any href in a successful
result it read, any URL the Run landed on, and any source URL in Session
Evidence, matched by the URL fingerprint the no-progress rail already uses.
Searches, whether a q= navigate or a typed query, and clicks are never
refused by this rail. After one Not-found Landing by a Composed Address on a
site, every further Composed Address to that site is refused for the rest of
the Run. The count never clears: a not-found answer is evidence the model's
address knowledge for that site is wrong, and a later real page does not
restore it. A fresh Run starts fresh, like every rail.

**A site is a registrable domain.** The motivating case alternates
jpl.nasa.gov, www.nasa.gov and science.nasa.gov. The app has no public-suffix
list; the rule takes three labels when the second label is one of co, org,
ac, gov, net or com under a two-letter top level, and two otherwise, so
rmg.co.uk and musiciansunion.org.uk group correctly. It lives beside the
existing host helper.

**The refusal ends nothing.** The Blocker gate finalizes on its second
refused round because a wall leaves no move. This refusal leaves two: search
the site, or open a link. The audit already counts a refused round as a
Failed round; a Run that burns its budget on refused guesses is a later
issue's evidence, not this rule's.

**Both loops, per call, no special case for siblings.** The rail runs in the
Run loop and the Browse Subagent loop. Gates run per call in order, so a
round whose first navigate lands not-found and whose second is a Composed
Address to the same site has its second refused inside the round; the
recovery survives when the second address was offered, and is replaced by a
search when it was not, which is the rule.

**The Search Loop rail treats the landing as inspection.** Observed, never
resetting: a navigate that settled on nothing has not left the results any
more than a scroll has. ADR 0048's accepted loss is closed by this.

**The trace records it and the audit counts it.** The Run Trace carries the
landing the way it carries a wall, as a field on the call rather than text to
be parsed from a truncated result head. The audit gains a per-call field and
two lines per attempt: navigates that landed on a Not-found Page, and how
many of those the reviewer judged Off-key. The capture diffs against the
newest committed three-pass set at implementation time, with the Baseline
figure beside it, so the fix's own effect is what is read.

**One prompt line each.** The orchestrator and subagent prompts say to prefer
a link you were shown or a search of the site to an address you compose, and
that a not-found answer means the address was wrong, so search rather than
try another. Consistent with the refusal text; the rail does not depend on
it.

## Considered options

- **Status only.** Rejected: blind to a soft 404, and the corpus already
  holds a body that never says 404.
- **Title only.** Rejected as the sole test: a heuristic where a fact is
  available for one bound argument. Kept as the second test.
- **Make it a Blocker signal.** Rejected: Escalation would ask the user to
  clear a page that does not exist, and the Blocker gate's second-refusal
  Finalization is the wrong ending for a page with two open moves.
- **A Notice through the notices module.** Rejected: the landing is a fact
  about the page, the Blocker marker is the precedent, and the trace and the
  audit need the fact, not advice.
- **Count the landing as a no-Progress action.** Rejected: it would have
  ended the motivating Run before its success.
- **Refuse every non-search navigate to the site after the allowance.**
  Rejected: it refuses opening a result by its href, the very move the Search
  Loop refusal asks for.
- **Per host.** Rejected: three of six on Voyager.
- **Clear the count when the Run lands on a real page of the site.**
  Rejected: on Voyager the count clears at rounds 6 and 15 and the rule
  barely fires; the evidence a not-found answer gives does not expire.
- **An allowance of two.** Rejected: with no clearing it still catches four
  of six, but the issue's one is what the reviewer's reading of the traces
  asked for, and offered addresses keep the recoveries safe.
- **Diff the capture against the Baseline.** Rejected: #235 and #237 each
  moved the not-found count; the newest set isolates this fix.

## Consequences

- Three glossary terms: Not-found Page, Not-found Landing, Composed Address
  (with Offered Address defined inside it). Progress gains a third neutral
  case; Search Loop names the landing as not escape.
- The settled state and the Run Trace carry an HTTP status for the first
  time. Nothing else reads it yet.
- Changing the mechanical reason of the affected rounds re-keys the reviewer
  cache for the attempts that hold them; the judgements are expected to
  stand, as with #238.
- A model that composed a URL from memory and got it right is never
  refused, because the allowance is spent only by a landing on nothing.
- A model that composed a wrong URL on a site it will later need must search
  or click its way back; one search round replaces what was six guesses.
- A click that lands on a Not-found Page is told so but spends nothing;
  whether clicks on dead pages need their own rule is for the capture to
  show.

## Implementation notes

- The status enters through the navigation target's `did-navigate` binding,
  which today drops the event's arguments, and travels on the settled state
  beside the title.
- The classification is a sibling of `classifyBlockerPage` on the same page
  facts; the marker parser mirrors the Blocker marker's.
- The rail is fresh per executor like the others, keeps the offered set and
  the per-site counts privately, and reads the observation ledger for
  evidence source URLs.
- The audit's per-call record already carries `wall` from the trace; the
  landing goes beside it, not into `resultHead`, which is cut at 240 chars.
