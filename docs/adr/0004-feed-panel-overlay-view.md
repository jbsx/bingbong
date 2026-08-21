# ADR 0004: The feed panel is a native overlay WebContentsView

## Status

Accepted — amended by #57: parked subagent thumbnail views deliberately stack *above* the overlay (they need unoccluded pixels for their first paint, and the overlay covers exactly the right edge where they park); the overlay is re-topped only when a pane is reopened into the main browsing area. The `onViewAdded` hook survives with that narrower meaning.

## Context

Issue #45 gives the activity feed panel (#44) its layout life: semi-transparent **overlay** above the browser pane by default — with no layout reflow beneath it — plus a **docked** mode that takes real layout space, a persisted choice (localStorage), auto-peek while a run is active, and a collapsed edge tab when idle.

The browser pane is a native `WebContentsView` stacked above the dashboard's DOM. Renderer CSS cannot composite above it, so a CSS-positioned overlay panel is physically impossible. Shrinking the pane's bounds to carve out a strip per run would visibly reflow the live page on every run start and end — exactly what "watching progress must not shrink what I'm browsing" forbids.

## Decision

- **The panel itself becomes a second `WebContentsView`** (`src/main/panel/createFeedPanelOverlay.ts`): transparent background, stacked above the browser pane, hosting its own renderer entry (`overlay.html`). The semi-transparency is the panel page's CSS surface over a `#00000000` view background — the live page shows through genuinely, because it is genuinely beneath.
- **The dashboard reports a slot rect, exactly like the browser viewport.** An invisible `div.feed-slot` marks where the panel sits: absolute/out-of-flow in overlay mode (no layout reflow beneath), a flex item in docked mode (real layout space), a slim absolute strip when collapsed. The slot drives the overlay view's bounds through the same `reportRect → setBounds` seam the pane uses (`BrowserPane.tsx` prior art).
- **Main owns one panel-state fold per window** (`src/core/panel/feedPanelState.ts`, pure and unit-tested): `command` peaks the panel, the run's `done` collapses it (busy rejections emit both, so the pair stays balanced); `toggleOpen`/`setMode` are the manual controls. State changes broadcast to both renderers over one IPC channel.
- **The mode persists in the dashboard's localStorage** — a view preference, not app settings (spec #42). The dashboard mirrors every broadcast mode into storage, so whoever switched it (header button, shortcut, or the panel's own dock control) persists the same way.
- **Subagent views stay below the overlay**: the pane pool gained an `onViewAdded` hook and main re-tops the overlay whenever a tab view is added, so dynamically spawned views never cover the panel.
- **Overlay-mode bounds never route through 0×0**: the slot's rect effect re-reports on (mode, open) key changes without an intermediate hide — a hidden-then-shown window makes Chromium reflow the overlay page against an empty viewport mid-transition, and clicks (real or synthesized) computed during that window land on stale element positions. Only a real slot unmount (idle screen) hides the overlay.

## Consequences

- The feed panel's DOM is not the dashboard's DOM: e2e feed assertions target the overlay target (`overlayEval`), and the dashboard's inline feed queries moved there with it.
- The panel keeps working unchanged in kiosk mode (the slot, not the window, defines it) and on the idle screen the overlay hides with the slot.
- Panel state and feed content ride the existing per-window channels (pipeline event channel forwarded, voice heard/error forwarded, history hydration pulled) — no new transport, one extra consumer per seam.
- The overlay view is an input surface (its edge tab, dock and collapse buttons); with `webContents`-per-target focus, synthetic e2e input must settle the view's viewport before clicking — encoded in the harness's `clickOverlayElement`.
- Future panel affordances (the typed steer box, #46) join the overlay's footer and inherit this whole mechanism for free.
