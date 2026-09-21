# ADR 0060: An Unavailable Landing is neutral, holds a Search Loop, spends no allowance, and is not a Blocker

## Status

Accepted on 2026-09-21 for #262, grilled from the audit-p3 re-judgement of
the `fix-258-259` capture (#259, ADR 0058). Adds a second landing kind
beside ADR 0050's Not-found Page, with the same shape and one deliberate
difference: it spends no Composed Address allowance. Amends nothing; ADR 0050
gains a cross-reference note. The Search Loop tiers (#74) stay at 3 and 5.

## Context

The Search Loop rail ends a streak on any successful call that is neither a
search nor inspection, unless the call landed on a Not-found Page (ADR 0050).
On the Voyager hunt of `fix-258-259` pass 2, round 21 navigated to a Wayback
Machine address and settled on a page titled "Internet Archive: Temporarily
Offline": three refs, all links to the archive's social accounts, and a
four-line body saying the services are offline. The call succeeded, so the
rail took it as escape and the streak went 1 (round 20), 1 (round 22), 2
(round 23); the reviewer under ADR 0058's definition placed rounds 20, 22
and 23 in one loop, and the rule placed 22 and 23. The Round Audit read the
landing as Acquisition with Progress, "moved to a page this Run had not
acquired". It is one of the six rounds the reviewer counted and the rule did
not on that capture (the gate's 17/23).

The issue as filed called the landing a wall and offered two seams: a
Blocker signal in the classifier, or the rail's `consumed` reading the
Blocker marker. The glossary's Blocker is something with content behind it
and an Escalation that reaches it; an outage page has neither, and the user
cannot bring a site back online. Had the page been a Blocker, the gate
would have armed on `web.archive.org`, refused the next same-host navigate,
and ended the Run for `blocker` on the second refused round (ADR 0037), the
ending ADR 0050 rejected for a page with open moves. A retry a minute later,
a Mirror or another source are all open after an outage.

A sweep of every live capture on disk (104 captures, 1,339 successful
landings) found four unmarked landings of this kind: the two Internet
Archive offline pages, both in the `fix-258-259` set on one day; Eurostar's
"Sorry, something went wrong." served on the site's own `/search/uk-en?q=…`
results address; and a Cloudflare "Origin DNS error | … | Cloudflare" page
(Error 1016) in front of the museum's collections host. Each had two or
three refs and a one-paragraph body. Only the round-21 landing functioned as
a Search Loop escape; the Eurostar landing was a Search URL and so counted
as a search whatever its page. Two facts shaped the recognition: the CDP
controller already reads the top-level HTTP status of a landing, since
#239, and feeds it to the classifiers; and the trace never records that
status, so a status rule can be run live and pinned by its marker basis but
never checked retrospectively on the captures already taken.

## Decision

**An Unavailable Page is recognised by status first and title second.** A
top-level response status in the 5xx range is Unavailable, whatever the
title. A title test catches the ones served with 200: "temporarily offline",
"temporarily unavailable", "service unavailable", "something went wrong",
"bad gateway", "gateway time-out", "internal server error", "origin dns
error", "connection timed out", "web server is down", "under maintenance",
and Cloudflare's error-page title suffix `| Cloudflare`. A bare "error" is
not a signal: GitHub's loading widget put "there was an error" into ten
content digests in the corpus. 403 and 429 are not Unavailable: 403 is the
Network Block's territory, and 429 is nothing the corpus has seen. No ref
count enters the rule.

**A Search URL is exempt from the title test, not the status test.** ADR
0059 exempts a results page from the title-based Not-found test because its
title echoes the query; the same exemption applies here. A 5xx on a results
address is unambiguous and is marked.

**It is not a Blocker.** It is a sibling landing kind: the classification
runs in the same wrapper as the Not-found one, after the same settle, and
produces a marker line, `UNAVAILABLE:<status|title> <host>`, where the basis
is the actual status number (`503`) or `title`, followed by one sentence of
advice naming the site: the site could not serve this page right now; retry
it once later, or use a different source or a Mirror; it is not evidence the
address is wrong. The marker rides every action that settles on such a page:
navigate, back, go_forward, and a click that left the page. Precedence at
the choke point: a Blocker verdict wins over both landing kinds; between the
two, status decides first, then the Not-found title test, then the
Unavailable title test. One landing classifier beside `classifyNotFoundPage`
in the browser layer, one marker-parser shape.

**It holds a Search Loop.** A search, an Unavailable Landing, a search is two
searches with nothing opened between them, which is ADR 0058's definition.
The rail's `consumed` excludes it as it excludes a Not-found Landing and a
Blocked Action (#261). Holding does not punish the move the nudge asks for:
the streak stays where it was, and the next search counts toward the same
tier.

**It is neutral to Progress.** Not Progress: the page carries nothing. Not a
no-Progress action: counting the site's outage against the model's Approach
ends Runs for the site's fault. The audit's mechanical kind reads Acquisition
without Progress with the reason "landed on an Unavailable Page". A second
landing on the same Unavailable Page by the same Observation Producer is a
repeat under the existing Progress rule and so a no-Progress action: one
retry is the advice, and grinding on an outage is the no-progress rail's
business.

**It spends no Composed Address allowance.** ADR 0050 spends the allowance
on evidence that the model's address knowledge for the site is wrong. An
outage says nothing about the address. The landed URL becomes an Offered
Address as every landing does, so a retry is never refused or rewritten.

**No prompt line.** The advice rides the marker; the prompt-only lever
saturated on #254. The tool descriptions of the navigation verbs and click
name the marker beside the two they already name.

**The trace records it and the audit counts it.** A sibling field
`unavailable` on the trace call, beside `notFound`, carrying basis and host,
so every trace written before it reads unchanged and the marker lines map to
fields one to one. The audit's replay of `consumed` excludes it, read from
the field and never from `resultHead`. Per attempt and over the population:
Unavailable Landings, and how many were followed by a search as the next
non-inspection call.

**The Fix Ledger recounts fix-258-259 by the rule.** The marginal for the
shared capture is read against `fix-258-259`, whose audits carry no
Unavailable field. As ADR 0058's note did for the streak, the ledger recounts
an audit written before the counter when it reads it: Unavailable Landings by
the title rule over the round titles the audit holds, and the streak replayed
with those landings as hold, so the marginal compares the rule with itself
and the old ratio is restated (17/23 becomes 18/23 if round 21 joins). The
committed fix-258-259 audits stay as written and are not re-judged: #259
already re-judged that capture once, and the recount gives the comparable
number without spending a re-judgement on two rounds. A capture re-audited
under the new digest re-keys the reviewer cache for the attempts holding
such rounds, as ADR 0050 recorded.

## Considered options

- **A Blocker signal.** Rejected: no content behind it, no Escalation
  reaches it, and the gate's second-refusal Finalization would end a Run on
  a transient outage.
- **The rail's `consumed` reading the Blocker marker, without detection.**
  Rejected as insufficient on its own: nothing marks this page, so the rail
  cannot see it; and with detection as a Blocker it inherits the gate.
- **Widen Not-found Page to "a page that carries nothing".** Rejected: the
  allowance decision differs. A not-found answer is evidence about the
  address; an outage is not.
- **Title only.** Rejected: the status is a fact the site asserted and is
  already read at the choke point; the title test is for the ones served
  with 200.
- **Ref poverty as a second required signal.** Rejected: all four corpus
  pages had at most three refs, but the rule would then miss a richer outage
  shell and adds a threshold to tune.
- **Keep escape, since the model did try to open a result.** Rejected: hold
  does not punish the attempt, and the alternative leaves the rail blind to
  a loop the reviewer sees.
- **A status class in the marker (`5xx`).** Rejected: the number is the
  fact; the parser accepts `5\d\d|title`.
- **One `landing` field carrying a kind.** Rejected: a sibling field mirrors
  the marker lines and leaves older traces readable unchanged.
- **Re-audit fix-258-259 under the new digest.** Rejected: the recount gives
  the number; the re-judgement was spent on #259.

## Consequences

- Two glossary terms: Unavailable Page, Unavailable Landing. Progress gains a
  fourth neutral case; the Search Loop entry names the landing as not
  escape; Not-found Page loses "error page" from its Avoid list; Composed
  Address says the landing spends nothing.
- The Blocker gate is untouched: an outage never arms it.
- On the capture's traces, round 21 would have held the streak at 1, round
  22 reached 2 and round 23 reached 3, the nudge tier.
- The measurement on the shared capture with #260 and #261 reports
  Unavailable Landings and the reviewer loop rounds the rule misses for this
  reason (expected 0), beside the ratio; nothing is gated on one capture. A
  capture in which no site is down reads 0 of 0.
- The 5xx status rule cannot be evaluated on any existing capture: the trace
  never held a status. Its first evidence is the marker basis on the next
  capture.
- A site that answers 200 with an outage title outside the list is a known
  miss until a capture shows it; the list is the corpus's four pages plus
  the standard server-error phrases, not a guess at every host's prose.
- The Wayback Machine's outage was transient and appeared twice on one day.
  Whether the assistant's reliance on `web.archive.org` as a Mirror needs a
  rule of its own is a later capture's evidence, not this ADR's.

## Relationships

Sibling of [ADR 0050](0050-a-not-found-landing-is-neutral-and-a-composed-address-is-allowed-once-per-site.md):
the same recognition shape, marker shape, neutrality and rail treatment, and
a different allowance decision; that ADR gains a note. Closes the third of
the three mechanisms named in [ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md)'s
#259 close note; the first is [ADR 0059](0059-a-search-url-carries-its-terms-as-a-named-parameter-or-as-the-path-segment-after-search.md)
and the second is the #261 note on ADR 0058. Keeps [ADR 0010](0010-mechanical-blocker-detection-gate.md)'s
Blocker signals as they are, and [ADR 0037](0037-keeping-at-a-blocker-ends-the-run.md)'s
ending for a wall only. Follows [ADR 0045](0045-a-round-audit-is-counted-by-code-and-judged-by-a-model-that-is-not-measured.md):
the recognition is shaped by observed pages, the tiers do not move, and the
recount, not a re-judgement, makes the marginal comparable.
