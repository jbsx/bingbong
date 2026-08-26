# ADR 0020: Appearance — a tri-state Setting with real dark tokens

## Status

Accepted — amends ADR 0012: the "hard light switch" stance is lifted; 0012's
palette bullets become the light-mode values of one token sheet.

## Context

ADR 0012 pinned a single light skin ("no dark mode, no toggle"). The app is
used at a desk for long browsing sessions: pages that respect
`prefers-color-scheme` darken themselves while the near-opaque white panel
stays the brightest surface on screen. Main also paints native view
backgrounds CSS cannot reach (pane, subagent panes, overlay background), so
a renderer-only toggle would leave native flashes of white.

Dark Reader was considered as the vehicle and rejected: it darkens pages
only (chrome stays light — worst of both), runs per-page style recalculation
against the Hardware Floor, and mutates page DOM — risking the mechanical
Blocker detection (ADR 0010) and Auto-vision click verification.

## Decision

- **Appearance is a Setting**: `system | light | dark`, default `system`,
  main-owned, persisted, voice-reachable (`set_setting appearance`). It
  resolves against `nativeTheme`; the resolved value drives both renderers
  and main's native view backgrounds. Manual choice wins over the OS signal.
- **Real dark tokens, not inversion.** The `:root` token sheet in
  `styles.css` gains a dark palette selected by the resolved appearance.
  The overlay already consumes those tokens (it links `styles.css`); dark
  tokens live only there — one source. Status colors and the code-block
  treatment get per-mode values, not computed inversions.
- **Pages receive the signal, never injected styles.** Resolved dark sets
  `nativeTheme.themeSource`, so every webContents on the browse partition —
  pane, subagent panes, Auth Popups — reports `prefers-color-scheme: dark`
  and dark form controls via `color-scheme`. Sites that ignore it stay
  light; the app never mutates page DOM to force it.
- **Test hooks are unchanged.** `.status-orb--*`, `.feed-surface` family and
  friends keep their names; surfaces re-skin, probes don't move.

## Consequences

- The `styles.css` "hard light switch" header comment is replaced by this
  ADR's pointer.
- `theme.e2e` keeps its light assertions as the `system`-default resolution
  (Xvfb reports no OS preference → light) and gains a dark pass asserting
  the dark tokens and the pane's `prefers-color-scheme` signal.
- Settings sanitization and the voice `set_setting` surface gain
  `appearance`; credentials-style restrictions don't apply — it is ordinary
  voice-reachable Settings territory.
- Kiosk renders whatever the resolved appearance is — no kiosk special case,
  same as 0012.
