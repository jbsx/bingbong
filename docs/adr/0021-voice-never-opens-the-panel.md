# ADR 0021: Voice never opens the feed panel

## Status

Accepted — amends ADR 0004's auto-peek fold (#45): the `command → open`
branch of the panel-state fold is deliberately gone.

## Context

Since #45, every accepted command peaks the full feed panel — an 880px
near-opaque slab covering most of the page for every trivial question. The
panel became a pushed surface; at a desk it was the most invasive element
on screen. The appliance pattern (Siri, Dynamic Island) is progressive
disclosure: the ambient state is tiny, the full state is summoned.

## Decision

- **A command shows the Peek Card, never the panel.** The panel-state fold
  (`feedPanelState.ts`) loses its `command → open` branch; `command` feeds
  the Peek Card surface instead. `done`/`session_ended` still collapse the
  panel, unchanged.
- **The panel opens only by human act**: edge tab, toggle control,
  keyboard shortcut, or clicking the Peek Card — which is its only
  interactivity (it reports; the panel acts).
- **Peek Card lifecycle**: appears at command time showing the live step,
  morphs into the Answer's Card rendering at `done`; a fixed linger
  (~8s) starts at `done`, hovering pins it, and new feed activity resets
  it. It is not a state of the Feed Panel; opening the panel dismisses it.
- **Confirmation and ask cards are unchanged** — they keep today's
  in-flow footer band; the peek carries no buttons.

## Consequences

- The model-invoked UI-control tools (ADR 0006) that open/dock the panel
  remain: the model may still *ask* for screen space on the user's behalf
  — but a plain command never takes it.
- E2e asserting command → panel-open must flip to command → Peek Card;
  `.feed-surface` hooks are untouched.
- Panel default width drops (880 → ~380px); persisted widths survive.
