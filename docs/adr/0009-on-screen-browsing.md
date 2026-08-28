# ADR 0009: On-screen browsing — every web read and write happens in a visible tab

## Status

Accepted

## Context

`web_search` (a Node-fetch scrape of `html.duckduckgo.com` with a static UA)
and `read_url` (a plain off-screen fetch) gave the model invisible web
channels that no one watching the dashboard could see. In runs 46/47 (both
failed at the 80-round limit) the model issued ~21 off-screen searches per
run against sites that had walled this machine, while the visible tab showed
Google `/sorry` pages and Reddit challenge walls. The app's premise is that
it mimics an actual user — think, decide, click, type, on a real screen —
and off-screen fetching both violated that premise and hid the walls that
should have triggered escalation. The subagent tooling encoded the opposite
design ("research: web_search + read_url, no tab").

## Decision

- Every web read and write happens in a rendered, visible tab. The
  `web_search` (DDG scraper) and `read_url` tools are deleted.
- Web search is visible search: either type into a real search engine's box or
  navigate the visible tab directly to rendered search results. The
  orchestrator may do this in the main tab for simple commands; subagents do
  it in their own visible tabs. No subagent fetches the web off-screen.
- First-party JSON, RSS, print, and reader representations are visible pages
  when rendered in the tab. They may support a concrete accessibility or
  extraction need, but never bypass authentication, access controls, paywalls,
  or challenges; the ordinary human page remains preferred.
- Subagent kinds collapse from three (research/browse/background) to two
  (browse/background): "research" was a tooling distinction (off-screen
  fetch) and dies with the fetcher.
- Link refs in the page snapshot carry their href (truncated), so the model
  can open results directly and never needs to guess a URL.
- Non-web infrastructure (LLM/vision APIs, weather, adblock lists, STT) is
  out of scope for this principle: it is not the web the user is watching.

## Consequences

- A walled search engine surfaces as a Blocker instead of being routed
  around invisibly — which is the point.
- Search costs a rendered navigation and observation instead of ~100ms;
  accepted as the price of being a real user. Physically repeating an engine's
  home-page, field-focus, and submit steps is not required when the same visible
  results can be opened directly.
- The search-loop rail re-targets from the `web_search` tool to the
  observable GUI signature: similar text typed into a search box, or a
  navigate to a search URL carrying a `q=` param, counts as one search
  observation.
