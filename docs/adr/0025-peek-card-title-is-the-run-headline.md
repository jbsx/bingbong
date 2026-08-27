# ADR 0025: The Peek Card title is the Run Headline, not the command echo

## Status

Accepted — glossary term **Run Headline** (CONTEXT.md); amends the Peek
Card's live title (ADR 0021).

## Context

The live Peek Card's title is the `commandText` echo, set once by the
`command` event. Steering emits a `steer` detail event the Peek Card fold
ignores (`peekCardState.ts` handles only command/done/speak/display/error/
session_ended), so a spoken mid-run correction never touches the title:
the card keeps describing the misunderstanding it was just corrected from,
and — since voice never opens the panel (ADR 0021) — the user has no
visible signal that the correction landed until they manually open it.

## Decision

- **The live title is the Run Headline**: the orchestrator's one-line
  statement of what the Run is doing *now* — set at run start, revised
  whenever understanding changes, Directive or otherwise. It rides the
  pipeline event seam like every other observable.
- **The echo is the fallback, not the title**: it stands in until the
  first headline arrives; a later missing or invalid headline keeps the
  last good one and never fails the Run (the Memory Commit discipline).
- **The Feed keeps the raw echo** in the run's command entry — the Feed is
  the record of what was said; the Peek is the current state of what is
  being done. Directive echo lines in the Feed are unchanged.
- **The Answer confirms corrections**: its Spoken Rendering and Card lead
  with the corrected description, so the ear verifies what the eye may
  miss while the panel is Collapsed.

## Consequences

- The headline travels as a `report_headline` tool call riding any tool
  round — native tool calls are the one channel every round already
  speaks, so a steering correction's next round can revise the title; the
  pipeline re-emits changes as a `run_headline` detail event (no history
  entry, no Feed Entry).
- Model-synthesized text becomes the live progress surface. The echo
  (cheap, always truthful) was genuinely available; it is rejected because
  an echo cannot describe a corrected task, and a correction the user
  cannot verify is the failure being fixed.
- Coverage by panel state: Collapsed → headline title; Open/Docked → Feed
  directive echo; any state → spoken confirmation at `done`.
