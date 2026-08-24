# ADR 0012: The Apple restyle — full-bleed pane, one toolbar, desk-distance type

## Status

Accepted

## Context

The gruvbox-light skin (#50) was calibrated for a 21-inch 1080p panel viewed
from ~2 m. The app is actually used at a desk, in front of a monitor: muted
gruvbox tiers over the translucent feed panel were unreadable there ("2 m
away? no chance"). Beyond readability, the design brief called for an
Apple-product feel: minimal chrome, edge-to-edge content, restrained neutral
palette, no bezels that don't earn their keep.

True frosted glass over the live page was considered and rejected as
physically unavailable: the feed panel is a separate native
`WebContentsView` above the browser pane (ADR 0004), and `backdrop-filter`
cannot sample across native view boundaries; OS-level materials (macOS
vibrancy, Windows Mica) don't exist on Linux. Reversing ADR 0004 to regain
DOM compositing would reintroduce the live-page reflow it exists to prevent.

## Decision

- **Near-opaque beats glass fiction.** The feed panel surface is white at
  0.97 with darker ink on the muted tiers — readability wins over
  translucency. Overlay and docked modes remain visually identical (the
  difference is what happens to the page beneath: covered vs narrowed).
- **One layout, full bleed.** The browser pane touches the left, right, and
  bottom window edges — no card border, no raised background, no radius.
  The old dashboard padding (28px) and workspace gap are gone. Kiosk has no
  special styles at all anymore: kiosk is fullscreen launch, pixel-identical
  to windowed (the `dashboard--kiosk` class survives only as an observable
  flag for tests).
- **One Toolbar replaces the header + browser-chrome bars.** A single slim
  reserved band above the pane — never overlapping it — carries the Status
  Capsule (orb + pill + run/voice hints collapsed into one control) on the
  left, navigation and the address field in the center, feed/settings
  toggles on the right. The "Bing Bong" title is deleted everywhere.
- **Hidden title bar, no window buttons.** `titleBarStyle: 'hidden'`; the
  Toolbar is the window's drag region (interactive controls opt out), and
  the idle screen carries an invisible top drag strip. Alt+F4 closes — the
  appliance commitment.
- **Neutral palette, Apple system status colors.** Canvas `#f5f5f7`, white
  surfaces, hairline `#d2d2d7`, ink `#1d1d1f`, muted `#6e6e73`, accent and
  thinking `#0071e3`; status purple `#af52de`, orange `#ff9500`, green
  `#34c759`, red `#ff3b30`. Inter stays (the SF Pro stand-in); the dark
  code-block treatment survives on white.
- **Type recalibrated for desk distance.** Root 22px → 17px (conversation
  ≈ 20px, labels ≈ 15px, detail ≈ 14.5px). The `--font-scale` knob and its
  rem-tier structure survive; the 2 m calibration comment was a false
  premise.
- **Motion boundary: text never travels.** Containers (cards, capsules)
  may animate opacity and subtle scale, never translation; new feed entries
  fade in where they land; streaming text grows in place. Orbs, loaders,
  and indicators may move freely. This sharpens #50's anti-motion stance —
  the objection was to moving text, not to motion.
- **Test hooks are load-bearing and preserved.** `.status-orb--*`,
  `.status-pill`, `.voice-hint`, `.settings-toggle`, `.feed-panel-toggle`,
  `.url-input`, `.chrome-button`, `.chrome-loading`, `.browser-viewport`,
  `.confirmation-*`, `.ask-*`, and the overlay's `.feed-surface` family
  survive inside the new chrome as observation points; only the pinned
  px/palette assertions (theme, conversation) were updated.

## Consequences

- ADR 0004 stands; only its semi-transparency premise is amended (see the
  note there).
- The footer's transient confirmation/ask cards keep their in-flow band
  below the pane (renderer DOM cannot float above the native pane) but read
  as a single centered floating card on canvas.
- `theme.e2e` now pins the neutral palette and the 17px scale; the h1
  label probe moved to `.status-pill`.
