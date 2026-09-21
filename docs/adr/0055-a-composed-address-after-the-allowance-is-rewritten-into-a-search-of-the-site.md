# ADR 0055: A Composed Address after the allowance is rewritten into a search of the site

## Status

Accepted on 2026-09-15 for #255, grilled from the Round Audit of the Run
Plan rung capture (#252, `fix-252-1..3`). Amends one sentence of ADR 0050:
after a site's one Not-found Landing, a Composed Address to that site is
rewritten into a search of the site instead of refused. The recognition of a
Not-found Page, its neutrality to Progress, the one-landing allowance and
the site as a registrable domain all stand.

Note (2026-09-21, #267): ADR 0064 is this rewrite's sibling for a search's
terms — a quoted phrase the Run was never shown is unquoted before the
search runs, and the outcome's first line says so in the same form.

## Context

ADR 0050 refused the second and later Composed Addresses to a site on the
reasoning that the refusal "leaves two moves: search the site, or open a
link". In fix-252 the model took a third, another composed address: 26
navigates were refused (5 in fix-250, 10 in baseline2), 25 of them whole
rounds in which every call was refused, about 1.4 per Run, on top of 12
Not-found Landings of which 9 were the Run's first action. With the opening
round at `medium` (#252) the guessing tripled. Each refused round costs the
provider floor and then a further round to do what the refusal asked; the
refusal text already says what to do, and the model does something else.

## Decision

**The call is rewritten in the same round.** After a site's allowance is
spent, a Composed Address to that site becomes a search of the site: the
composed path's segment words, with numeric-only tokens and file extensions
dropped, plus `site:<site>`. The engine is the origin and path of the Run's
last q= search with the query substituted; a Run that has not searched yet
uses the search builder the app already applies to typed words.

**The model is told.** The result opens with one line saying the address was
rewritten into that search and why, then the ordinary navigate outcome. The
results' hrefs are Offered Addresses from then on.

**It is a search to every rail.** The Search Loop rail sees a q= search — a
streak, and escape by opening a result — and the Composed Address rail's own
accounting treats it as one. Both loops, per call, as before.

**The trace and the audit carry it.** The Run Trace stamps the call as
rewritten beside its wall and not-found fields; the audit counts rewritten
Composed Addresses per attempt and population, with how many of those rounds
the reviewer judged Off-key. A rewritten round is an acquisition round, never
a Failed round.

**The allowance stays.** The first composed address to a site is often right
— a documentation root, a product page — and only a landing on nothing
spends the allowance.

## Considered options

- **Keep refusing, carry a ready-made search href.** Rejected: it still
  spends the round.
- **Remove the allowance and rewrite every Composed Address to an unvisited
  site.** Rejected: it rewrites the composed addresses that are right.
- **Build the query from the objective.** Rejected: the rail does not know
  the objective, and the path words are what the model was reaching for.

## Consequences

- A gate transforms a call for the first time instead of passing or refusing
  it. The model asked for one URL and gets another's outcome; the result's
  first line is what keeps that honest, and the trace stamp is what keeps it
  auditable.
- The Composed Address glossary entry changes "refused" to "rewritten into a
  search of that site". The prompt lines from ADR 0050 stay: a shown link or
  a site search is still the better first move.
- The measurement (#255) gates on rounds of refused Composed Addresses (25
  in fix-252) at zero and reports the rewritten rounds with their Off-key
  share, so a rewrite that lands the model on useless results is visible.
