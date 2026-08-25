# ADR 0017: Renderer session re-adoption

## Status

Accepted

## Context

On 2026-08-25 a Session under five minutes old visibly lost its Feed while
its Run was still live. Forensics (history.db) showed no `session_ended` ever
fired — the designed wipe never ran. The visible Feed lives only in the
overlay's renderer; the overlay page had reloaded (renderer reload chords such
as Ctrl+R/F5 pass through `before-input-event`, and a dev-server reload or a
renderer crash does the same). Since #88 removed boot hydration, a fresh
projection starts with no session identity, and the projection's session gate
then silently rejects every subsequent event of the still-live Run — a
transient page loss becomes a permanent silent wipe that looks exactly like a
fresh boot. A dashboard-only reload has a delayed variant of the same
disease: the reloaded dashboard has no active session, so five idle minutes
later the idle screen hides the panel. Nothing watched for renderer death:
`render-process-gone` was unhandled and `crashReporter` was never started,
making crashes invisible by design.

## Decision

- **A renderer that loses its page mid-session re-adopts the live session.**
  On the overlay's (and dashboard's) `did-finish-load`, main re-sends the
  current session identity and folded panel state; the fresh projection
  accepts the still-live Run's subsequent events from that moment.
- **Re-adoption is forward-only.** Entries lost with the page are not
  replayed from Recorded History; they remain reviewable in the history view.
  This is identity recovery, not hydration — the glossary rule that Recorded
  History never hydrates the live Feed stands.
- **Renderer death stops being silent.** `render-process-gone` on the overlay
  and dashboard triggers reload and recovery via re-adoption;
  `crashReporter` runs so crashes leave evidence; reload chords are blocked
  in the overlay's `before-input-event`.

## Consequences

- Any overlay or dashboard page loss — crash, reload, dev-server churn —
  self-heals into a live feed instead of a permanent silent wipe.
- The delayed idle-screen bug after a dashboard reload is killed at the root:
  a reloaded dashboard knows its session is active.
- The no-hydration principle survives: nothing renders past entries that the
  page did not live to see.
