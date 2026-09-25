# ADR 0066: A search runs on the Run Engine, and a search composed on another Web Engine is rewritten to it

## Status

Accepted on 2026-09-25 for #270, grilled the same day with every
recommendation taken (the decision is the issue comment of that date).
Amends [ADR 0055](0055-a-composed-address-after-the-allowance-is-rewritten-into-a-search-of-the-site.md)'s
engine clause. Takes the candidate [ADR 0058](0058-a-search-loop-is-consecutive-searches-with-nothing-opened-between-them.md)
deferred ("rewrite a walled engine's search") and makes it general.
[ADR 0064](0064-a-quoted-phrase-the-run-was-never-shown-is-searched-unquoted.md)'s
rewrite now composes on the Run Engine.

## Context

The `todo` file said "always use google as the search engine unless
explicitly overridden by the user". The app composes DuckDuckGo for typed
words (`searchUrl`), and the model typed whatever engine it liked. Over the
orchestrator's navigates in baseline3, fix-263-264 and fix-265-267 (11
passes):

| engine the model typed | navigates | walled |
|---|---|---|
| DuckDuckGo (typed URL) | 77 | 0 |
| plain terms (app composes DuckDuckGo) | 16 | 0 |
| Bing | 12 | 0 |
| Google | 4 | 4 |

Every Google search landed on a Challenge (`BLOCKER:challenge
www.google.com`, the landed URL still `/search`), each inside a Search Loop
the audit counted. ADR 0058 had recorded 5 of 6 on fix-257 and deferred the
rewrite. Every Google landing came from a typed Search URL, none from the
engine's home page and its search box. No hunt prompt, grading key or
grader names an engine.

Two rails inherited the model's engine: the Composed Address rewrite (ADR
0055's engine was the Run's last `q=` navigate) landed on Bing twice, and the
Unseen Phrase rewrite re-ran a search on Google straight into the wall. The
last-`q=` rule also mistook any site's own `q=` search for an engine.

The engine was a variable no capture held fixed, and #268's model comparison
needs it held.

## Decision

- **The app composes DuckDuckGo.** `searchUrl` stays. Google walls every
  search an embedded Chromium sends it ([ADR 0018](0018-auth-host-identity-and-popups.md)
  documents that posture), and a Setting would add a knob no capture can
  hold fixed.
- **A Web Engine is one of a fixed list, by registrable domain**: Google,
  Bing, DuckDuckGo, Yahoo, Yandex, Baidu, Brave Search (search.brave.com
  only), Startpage, Ecosia, Mojeek, Qwant, Kagi. One constant in one module
  (`src/core/pipeline/webEngine.ts`). A Search URL on any other site is a
  site search and passes untouched, so a museum's own `q=` search never goes
  to DuckDuckGo. This is a vendor list on purpose: [ADR 0061](0061-a-consent-wall-is-recognised-by-position-and-its-controls-not-by-role-or-vendor-and-dismissed-where-it-is-met.md)
  refused vendor matching for consent walls because their shape is the
  concept; here the set of vendors is the concept, and no shape separates an
  engine's search from a site's. An engine missing from the list is a
  capture finding, not a bug.
- **The Run Engine** is the engine the user named in their own words this
  Run — the command or a Steering directive, the last one named — else
  DuckDuckGo. The same source rule as the Unseen Phrase: the user's words.
  Per Run only; a follow-up starts at DuckDuckGo again.
- **The Engine Rewrite.** A model search on a Web Engine other than the Run
  Engine is rewritten in the same round to the Run Engine's Search URL with
  its terms kept, and the outcome's first line says so, in ADR 0055's form:
  `Rewritten — this run searches on DuckDuckGo, so the Google search ran
  there with the same terms: "…". Search with plain terms or a DuckDuckGo
  address.` Bing's results are given up knowingly (ADR 0048 recorded one
  better Bing hit, on the rail's audit, not an Answer).
- **A wall on the Run Engine stays a Challenge** — a Blocker, the gate armed
  on the host, Escalation (ADR 0009, 0010, 0037). No DuckDuckGo wall exists
  in any capture; if one appears, that capture grills a fallback engine. The
  Search Loop half of the question was already settled: ADR 0058 counts a
  walled search navigate as a search, never escape.
- **The rewrite chain runs engine first.** Engine Rewrite, then the Composed
  Address rewrite, then the Unseen Phrase rewrite, each seeing the call the
  one before produced. When two apply to one call, each adds its own line,
  the engine's first. ADR 0055's "last `q=` engine" clause is dropped and
  `engineOf` is gone: the Composed Address rewrite composes on the Run
  Engine.
- **An engine's home page, then a typed search, is left alone** — the rail
  never observes typing. The capture gate counts Google landings by any
  path, so the case is measured rather than built for.
- **Subagents get the rewrite through the shared Tool Round**, like every
  rail.
- **The trace and the audit carry it.** The Tool Round stamps
  `engineRewrite: { from, to, query }` on the `tool_result` event from its
  own field; the Round Audit counts Engine Rewrites per attempt, per
  population and by hunt beside `unseenPhraseRewrites`, with how many the
  reviewer judged Off-key. Never read from the line's wording.
- **The `todo` line is deleted.** This ADR is the record.

## Considered options

- **Google as the composed engine.** Rejected: 4 of 4 walled.
- **A Setting.** Rejected: a knob no capture holds fixed.
- **Rewrite only after a wall** (ADR 0058's candidate as written). Rejected:
  it still pays the first wall per Run.
- **A Google-only rewrite.** Rejected: a one-vendor rule, where the general
  one costs the same.
- **A neutral, Unavailable-style landing for an engine wall.** Rejected:
  there is no instance to design for.

## Consequences

- The engine is held fixed across captures unless a command names one; no
  corpus command does.
- The Composed Address rewrite can no longer land on a site's own search
  page mistaken for an engine.
- Measured by a 3-pass `fix-270` capture on the landed commit, before #268's
  model comparison. Gates, mechanical: model searches that landed on a
  non-Run engine 0; Google walled rounds 0 by any path. Reported beside
  fix-265-267: verified initials, Search Loop rounds, pooled Run median,
  Engine Rewrites and their Off-key count. The Fix Ledger's Reference stays
  baseline3 by its existing rule.

## Relationships

Amends ADR 0055's engine clause. Takes ADR 0058's deferred candidate. ADR
0064's rewrite composes on the Run Engine because it sees the Engine
Rewrite's call. Follows ADR 0018 on Google's posture toward an embedded
Chromium, and ADR 0009/0010/0037 on a Challenge.

## Notes

- 2026-09-25, implementation (#270). The calls the grill left open:
  - **Naming an engine takes a search verb.** An engine's name counts as
    the user naming it only as the object of a search verb (`search google`,
    `use DuckDuckGo`, `try yahoo`, `switch to Bing`), at the end of a phrase
    a search verb opens, within four words (`find the price on Bing`, `look
    it up with DuckDuckGo`), or as the verb itself (`google it`, `a google
    search`). Any other mention is what the command is about — "What did
    Google announce", "a Google Pixel 9", "Google's antitrust case",
    "latest news on Google", "compare Bing with Google" — and never an
    engine; setting the Run Engine to Google on those would walk every
    search into the wall this ADR removes. The code review of the first
    draft found a bare preposition ("on Google") let company mentions
    through, and the verb is now required.
  - **Plain terms follow a named engine.** The browser composes DuckDuckGo
    for plain terms; when the user named another engine, those terms are a
    DuckDuckGo search on another engine than the Run's and are rewritten
    like any other — that is what "every search of a Run composes on" the
    Run Engine means. With no engine named nothing changes for them.
  - **A Subagent's Run Engine is handed down.** A worker's brief is the
    orchestrator's words, not the user's, so it can never name one; the
    spawning Run's Run Engine rides the spawn as a live read, like the
    shared deadline, and a worker spawned outside a Run is on DuckDuckGo.
  - **Each engine carries its own terms parameters** — Yahoo `p`, Yandex
    `text`, Baidu `wd`, Startpage `query` — read before the rewrite, so a
    Yahoo `p=` search keeps its terms. ADR 0059's Search URL parser is
    unchanged; the audit's streak replay reads a rewritten call's terms
    from the stamp.
  - **Only an engine's web search is a search on it.** Each engine names the
    subdomains and path its web search answers on — Google, Bing, Ecosia,
    Mojeek and Kagi `/search` on the bare or `www` host, Yahoo `/search` on
    `search.` (and a country's `uk.search.`), Baidu `/s`, Startpage
    `/do/search` and `/sp/search`, Qwant the root, DuckDuckGo every host and
    path. Its other pages carry a terms parameter too and are left alone:
    `finance.yahoo.com/quote/AAPL?p=AAPL`, Scholar, Books, Maps. An image
    search on the web search's own endpoint (`/search?tbm=isch`) is still
    one. An engine page with no terms is none.
  - **The gates are counted at the capture**, not by the audit: the audit
    cannot load the Web Engine list under plain Node (the rail modules'
    imports need the app's resolver), and a second copy of the list would
    break the one-module rule.
