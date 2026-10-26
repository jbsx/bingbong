# ADR 0026: A live Run is always covered

## Status

Accepted — amends ADR 0021's Peek Card lifecycle: the 8s answer linger is
gone, replaced by run-scoped coverage and a persistent answer. Amended by
#331 (the owner's ruling, 2026-10-18): at `done` a panel the human opened
stays open — the Answer lands in the panel, the surface already in front
of the reader, and the card's answer is retired as if the panel had just
opened over it. The auto-collapse was kept for a panel the system peeked
open; nothing on this branch opens one. Amended by #470 (the owner's
ruling, 2026-10-26: "i dont want the card to always be on the screen and
if i want to see the history i will use the activity panel"): the answer
no longer persists. The card goes 15 s after its sentence is spoken, or
after the Answer lands when nothing is spoken, a bar draining across that
time; a tap dismisses it sooner. The sentence stays on screen after it in
the Voice Prompt (#436), and the Feed Panel keeps the history. Over the
Idle Screen the card shows only a failed Command or "No response.", in
the AI Usage chart's place.

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
- **The answer lingers, then goes.** *(Amended by #470; was: the answer
  persists until the next Run, a panel open, or `session_ended`, with no
  time-based retraction.)* At `done` the card carries the Answer for 15 s
  past its spoken sentence, a bar draining across that time, then
  retracts; a tap, the next Run, a panel open or `session_ended` ends it
  sooner. 15 s is a guess, the owner's, that no measure in the repo can
  settle. A cancelled Run still hides the card promptly.
- **Every run end lands its outcome on exactly one visible surface.** At
  `done` with the panel open, the panel still auto-collapses and the card
  takes over the Answer. *(Amended by #331: a panel the human opened stays
  open at `done` and is the surface the outcome lands on; only a panel the
  system peeked open would collapse, and nothing opens one today.)* After `done`, opening then closing the panel does
  not revive the card — the obligation is Run-scoped, not Session-scoped.

## Consequences

- The panel-open dismissal is no longer sticky; the "stays dismissed when
  the panel closes again" branch reverses for live runs.
- `PEEK_CARD_LINGER_MS`, the linger anchor, out-of-turn announcement
  re-anchoring, and the hover pin are retired; their unit and e2e tests
  flip from retraction to persistence.
- A stale Answer may sit on screen up to the Session Window — accepted as
  the cost of a persistent ambient surface. *(Retired by #470: the owner
  found the always-on card annoying; a linger returns, timed from the end
  of the spoken sentence rather than from `done`.)*
