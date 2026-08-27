# ADR 0026: A live Run is always covered

## Status

Accepted — amends ADR 0021's Peek Card lifecycle: the 8s answer linger is
gone, replaced by run-scoped coverage and a persistent answer.

## Context

ADR 0021 made the Peek Card transient: it reported the run, lingered ~8s
past `done`, and retracted — and once the panel had been opened, the card
stayed dismissed after the panel closed ("the user already saw the answer
up close"). Two gaps followed: closing the panel mid-run left the run
unreported, and the answer vanished from the screen after eight seconds
even though the Session — and often the reader's need for it — outlived
that window.

## Decision

- **While a Run is live — a Pause included — exactly one of the Feed Panel
  or the Peek Card renders.** Any open→false transition (header toggle,
  keyboard shortcut, edge tab, model-invoked `toggle_panel`) summons the
  card at its live phase. Explicitly summoned views (Settings, history)
  are exempt.
- **The answer persists.** At `done` the card carries the full Answer Card
  rendering until the next Run, a panel open, or `session_ended` — no
  time-based retraction. A failed Run persists the same way; a cancelled
  Run hides the card promptly.
- **Every run end lands its outcome on exactly one visible surface.** At
  `done` with the panel open, the panel still auto-collapses and the card
  takes over the Answer. After `done`, opening then closing the panel does
  not revive the card — the obligation is Run-scoped, not Session-scoped.

## Consequences

- The panel-open dismissal is no longer sticky; the "stays dismissed when
  the panel closes again" branch reverses for live runs.
- `PEEK_CARD_LINGER_MS`, the linger anchor, out-of-turn announcement
  re-anchoring, and the hover pin are retired; their unit and e2e tests
  flip from retraction to persistence.
- A stale Answer may sit on screen up to the Session Window — accepted as
  the cost of a persistent ambient surface.
