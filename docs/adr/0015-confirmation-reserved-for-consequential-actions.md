# ADR 0015: Confirmation is reserved for Consequential Actions

## Status

Accepted

## Context

Bing Bong is an AFK-first assistant: it acts for the user while they are away
from the keyboard. Yet since the on-screen switch (#83), every GUI search has
paused the Run for a Confirmation — the orchestrator prompt mandates typing a
query with a trailing newline into a real engine's box, real engines wrap that
box in a `<form>`, and the risk gate confirms any Enter-submit into a form
(`riskGate.ts`). Typing "weather tomorrow" into Google thus asks the user to
approve a form submission, times out after 60 s, and feeds the model "do not
retry". Non-consequential verification is counterproductive: every design
decision should maximize hands-free usefulness, asking only when an action is
critical to gate.

Subagents have it worse: their policy downgrades confirm-class actions to
deny, so subagents cannot GUI-search at all.

## Decision

- **Confirmation is reserved for Consequential Actions** — actions whose
  effects outlive the page or spend something: persisting or sending data,
  buying, downloading files, quitting the app. Credential and payment fields
  stay denied outright.
- **A search submit merely navigates and is never Consequential.** The
  exemption is structural, not an allowlist: it applies when the submitted
  field is search-flavored — `type="search"`, or name/id/aria-label/placeholder
  matching /search|query|^q$/i (catches Google's `name=q`, DuckDuckGo, Bing,
  and site-local search boxes).
- The predicate is symmetric across both submit paths: typing a trailing
  newline into a search-flavored field and clicking a form's submit control
  are exempt alike.
- The rule is always-on; there is no autonomy Setting knob. "Is this submit
  merely a search" is deterministic classification, not a preference.

## Consequences

- Plain searches — orchestrator and subagent alike — run without asking.
  Subagent GUI search becomes possible for the first time since #83.
- A bare "single text input" rule was rejected: a newsletter signup is a
  single-email-input form and would silently auto-send data. The
  search-flavored match keeps it confirmed.
- A domain allowlist of known engines was rejected: brittle, and site-local
  search has the same risk shape as Google.
- The consent-label exemption already in the gate is unchanged; this ADR adds
  the search family beside it.
