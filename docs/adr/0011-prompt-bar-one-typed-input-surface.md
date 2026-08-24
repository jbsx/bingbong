# ADR 0011: One typed-input surface — the Prompt Bar lives in the Feed Panel

## Status

Accepted

## Context

Typed input was split across two surfaces that were each enabled only while
the other was disabled: a CommandBox in the dashboard footer (submit while
idle; disabled during a run) and a SteerBox in the feed panel's footer
(steer during a run; disabled while idle). The split meant two components,
two stylesheets, two e2e selector families, and two definitions of "active"
that could disagree — and at any moment exactly one of the two boxes was
dead weight on screen.

Both IPC seams (`assistant.submit`, `assistant.steer`) already resolve the
owning window via `fromWebContents`, so either seam worked from either
webContents. The only real barrier to consolidation was presentation.

## Decision

- **One surface**: the Prompt Bar, rendered in the feed panel's footer.
  The dashboard footer carries no typed input at all; it renders only the
  transient confirmation/ask cards and collapses entirely when none are
  pending.
- **The verb follows the run-live signal at submit time** (the same
  run-progress projection that drives the header hint): "run" starts a
  command when no stage is held, "steer" directs the live run through the
  spoken-steering seam. Paused and speaking runs stay steerable. There is
  no latched verb and no disabled state — a `false` return from main (an
  aborting run) restores the draft instead of silently dropping it.
- **The stop button rides the bar's row** while a run is active, moving
  out of the dashboard footer: run-scoped controls stay together.
- **Opening the panel focuses the bar**; Ctrl/Cmd+Shift+F becomes typing's
  entry point. Voice remains the primary interface for everything else.

Alternatives considered: mirroring both behaviors into both surfaces
(two bars, twice the states, same disagreement), and keeping submission in
the dashboard footer with steering alone in the panel (preserves the
disabled-while-active dead zone this consolidates away).

## Consequences

- While the panel is collapsed there is no visible text input; typing
  requires opening the panel. Accepted: voice is primary, and the panel
  auto-peaks on every run anyway. For the same reason, a mid-run collapse
  also hides the stop button — reopening the panel (or voice) reaches it.
- A draft typed as a command can flip to a directive if a run starts
  mid-typing (and vice versa); the feed echo ("steer: …") makes what
  happened legible after the fact.
