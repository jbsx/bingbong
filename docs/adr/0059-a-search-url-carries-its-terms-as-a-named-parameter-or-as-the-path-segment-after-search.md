# ADR 0059: A search URL carries its terms as a named parameter or as the path segment after `search`

## Status

Accepted on 2026-09-21 for #260, grilled from the audit-p3 re-judgement of
the fix-258-259 capture that closed #259. Amends ADR 0058 on one thing only:
what a navigate has to look like to be a search observation. The streak rule
(a search after a search with nothing opened between them), escape,
inspection, the tiers at 3 and 5, and the Search Observation's two
signatures are unchanged. The Composed Address rail's rewrite engine (ADR
0055) is named here because the same test feeds it.

## Context

The GUI search signature (#82, ADR 0009) recognises a navigate as a search
when its URL carries a non-empty `q=`. That is the shape of every engine —
DuckDuckGo, Bing, Google, Mojeek — and of plain typed terms, which the
browser normalizes into one. It is not the shape of a site's own search.

On the longitude-watch hunt of fix-258-259 pass 1, the model typed into the
museum's search box and the site settled on
`www.rmg.co.uk/collections/objects/search/Harrison%20sea%20watch`. It then
navigated by hand to `…/search/Harrison` and `…/search/Harrison%20timekeeper`
with nothing opened between the three. The reviewer, defining a Search Loop
as the rail does, placed all three in one loop; the rail saw one search and
two successful navigates that were not searches, so each hand-composed
search was an *escape* and the streak reset to 0 on the call that continued
the loop. Three of the six rounds the rule missed on that capture (17/23)
are this.

A sweep of every live capture on disk (3,036 navigate calls over 36 Runs and
their reruns) shows the gap is entirely site search. `q=` is nearly every
engine search. Beside it the corpus holds one path form, the museum's
`/collections[/objects]/search/<terms>` (52 calls, and the only shape its own
search box ever settles on), and a handful of parameter names on real
results pages: `query` (rmg.co.uk, raspberrypi.com, nasa.gov, once spelt
`Query`), `keywords` (the Raspberry Pi forums), `kw` and `searchString`
(rmg collections), `search` (rmg objects), and WordPress's `s`. Two shapes
that look like searches are not: the Internet Archive's CDX API,
`web.archive.org/cdx/search/cdx?url=…&filter=…`, whose segment after
`search` is the endpoint name, and Bing's click redirect `bing.com/ck/a?…&p=…`,
whose `p` is an opaque token. No navigate in the corpus ends in a bare
`/search` section page with no terms.

The URL test is implemented three times: `searchQueryFromUrl` in
`progressFingerprints.ts` (the rail, the no-progress action fingerprint and
the Composed Address rail read it), `searchQueryOf` in the Round Audit
(`e2e/live/audit.ts`, which cannot import the fingerprints module under
plain Node and grew a copy for pre-observation traces), and
`isSearchResults` in `notFoundPage.ts`, which exempts a results page from
title-based Not-found classification. ADR 0048 already ruled that the audit
replays the rail's code rather than a copy; the URL half was never moved.

## Decision

**A search URL carries its terms in one of two places.** As a parameter
whose name is a word for terms — `q`, `query`, `search`, `searchString`,
`keywords`, `kw`, matched case-insensitively — or as the final path segment
after a segment named `search`, with no query string. The query the rail
records is the parameter's value or the decoded path segment. The path
form's two clauses are the CDX trap: an API call carries its request in
parameters, and a page whose terms are in its path carries none. A paged or
sorted path search (`/search/Harrison?page=2`) is therefore not observed;
the corpus holds none, and the loss is recorded here rather than left to be
rediscovered. `s` is left out: a letter is not a word, and on the sites
observed it is as likely a sort key as a search. Drupal's
`search_api_full_text` is left out: two calls on a site whose other four
spellings are caught.

**One function, in the browser's URL module.** The test lives in
`src/core/browser/urlInput.ts` beside `searchUrl` and `normalizeUrlInput` —
where a search URL is composed is where one is parsed — and it returns the
query and the form it matched (`q`, `param`, `path`). The rail's
`searchQueryFromUrl`, the audit's `searchQueryOf`, and the Not-found
detector's results-page exemption all call it, and `audit.test.ts` pins
that the audit and the rail agree, as it does for `similarQueries`. The
audit can load it: `searchLoopRule.ts` already imports `urlInput.ts` with its
extension under plain Node.

**The signature stays `url`.** A path search is a navigate to a search URL;
the glossary already separates the signature (navigate or typed) from the
surface (the engine or site). A third value would change the trace shape
and the audit's validator for a count the form on the function's result
already gives.

**The rewrite engine accepts only the `q` form.** ADR 0055 substitutes the
composed path's words as `q=` onto the origin and path of the Run's last
search. A site's `…/search/Harrison` or `…/search?query=…` must not become
that engine, or a rewrite would produce `…/search/Harrison?q=…`. The engine
is where `q=` goes; a site search box is a surface, not an engine.

**A search is not a Composed Address.** Once a path or `query=` navigate is
a search, the Composed Address rail no longer treats it as an address the
model composed: it spends no allowance, is never rewritten, and its landing
does not offer it. That is ADR 0055's rule (searches pass untouched) applied
to the search it did not recognise.

**The nudge and the refusal say the rule the rail runs.** Both notices still
read "a q= navigate or a search box query" and "reword one intent" /
"consecutive similar searches", which has been false since ADR 0058 dropped
the same-intent comparison. They now say a navigate to a search URL or a
search box query, and consecutive searches with nothing opened between
them. Correcting a false statement of the rule is not a prompt lever (ADR
0057's finding that the prompt-only lever saturated stands); it is not
measured.

## Considered options

- **The segment after `search`, unconditionally.** Rejected: the CDX API
  would be a search with query `cdx`, and the no-progress fingerprint would
  fold every distinct archive lookup on a Run into one Approach.
- **Learn the path shape per host from the typed search's settle URL.**
  Rejected: it catches exactly the observed rounds, but it is state where
  four consumers call a pure function, and the model composes the path
  form on a host it has not yet typed into.
- **`q=` and the path form only.** Rejected: the same capture's pass 3
  composed `www.rmg.co.uk/search?query=…`, a real site-wide search the rail
  missed; the names added are each a word for terms and each observed on a
  results page.
- **A third signature value `path`.** Rejected, above.
- **Leave the Not-found detector's copy at `q=`.** Rejected: a site's
  results page titled "No results found" is not a Not-found Page whatever
  form the search took, and a third copy is how the audit's drifted.

## Consequences

- The glossary gains Search URL, and the Search Loop entry names it in
  place of "a q=-carrying search URL".
- On the fix-258-259 pass-1 trace, rounds 4, 5 and 12 replay to streak 3 and
  the nudge fires at round 12; that replay is a unit fixture, since the
  capture's observations were written by a rail that did not see rounds 5
  and 12 and the audit replays only what an observation recorded.
- The next capture reports path-form and parameter-form observations by the
  form on the function's result, and the rule/reviewer ratio beside 17/23.
  Nothing is gated on it: a capture in which the model never uses a site's
  path search reads 0 of 0.
- A model that walks a site's search five times without opening a result is
  now refused its sixth there too, as ADR 0058 intends for engines.
- Three results-page shapes in the corpus are still not searches to the
  rail: fragment-routed catalogues (`#!/catlite#!/…`), the Wayback Machine's
  wildcard calendar (`/web/2013*/…`), and a search box that never fired
  under an overlay, which is #261's Held Page.

## Relationships

Amends [ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md)
on the search signature's URL half. Applies [ADR 0048](0048-a-search-intent-is-its-terms-and-inspection-between-searches-is-not-escape.md)'s
rule that the audit replays the rail's code to the half it missed. Names
the boundary of [ADR 0055](0055-a-composed-address-after-the-allowance-is-rewritten-into-a-search-of-the-site.md)'s
engine. Follows [ADR 0045](0045-a-round-audit-is-counted-by-code-and-judged-by-a-model-that-is-not-measured.md):
the recognition rule is shaped by an observed trap, not tuned to judged data,
and the tiers do not move.
