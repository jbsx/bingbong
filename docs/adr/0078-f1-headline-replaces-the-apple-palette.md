# ADR 0078: F1 Headline replaces the Apple palette, and the Idle Screen's grid gives way to three Columns

## Status

Accepted on 2026-10-20 by the owner, after six rounds of mockups
(`/tmp/bingbong-theme-mockups/`, kept on the `issue-assets` branch under
`f1-theme/`). Supersedes ADR 0012's palette and its blue accent; keeps
ADR 0020's one token sheet with real light and dark sets. Replaces #352's
glass bento and Card Slot grid. Built for everything outside the Idle
Screen's layout in #359 (see the amendment below); the Columns are #360.

## Context

The appliance is a 21-inch 1920×1080 wall screen read from two to four
metres. The Apple palette (ADR 0012) was chosen for a desk: neutral greys,
a blue accent that marked anything interactive, colour wherever a control
lived. From across a room that reads as noise — the eye cannot find what
Bing Bong is doing among a dozen equally blue things. The #352 glass bento
put every card on equal footing in a 3×4 grid over a weather-tinted glow,
and the Timer, Now Playing and Up Next in a dock of chips under it; the
owner found it busy and the far view flat.

Round 5 offered three directions for the Idle Screen; the owner picked F1
Headline ("i like f1 headline from round 5") with F2's AI usage card, and
round 6 carried it to every state of the app, captured side by side with
the current screens.

## Decision

- **One ground, flat panels.** Near-black `#07090d`; panels a 1.8 % lift of
  white with 6 % hairlines; no gradients, no blur, no glow, at most the
  barest shadow. Radii and shadows become tokens beside the colours.
- **Peach is Bing Bong.** The accent is peach, spent only on Bing Bong
  itself: the voice state, the thing it is working on, the primary button,
  today, the Timer. Blue is no longer the accent.
- **Colour intensity is importance (E4).** Status colours only where they
  mean something — success green, failure coral, warning amber, working a
  peach pulse; data keeps its own colours (temperature hues, rain blue, a
  provider's tone, a Person's colour, weight down green and up amber);
  everything else is neutral, near-white text never `#fff`.
- **Two reading distances.** In every state one thing — what Bing Bong is
  doing or just said — is read from three metres: the Status Capsule, the
  newest Answer, the clock. Everything else is the quiet layer. Nothing is
  set under 16 px.
- **Inter and JetBrains Mono, both bundled.** Mono for times, dates,
  tables and timestamps. No font comes from the network.
- **The Voice Prompt replaces the boxed input** wherever it fits: orb,
  hint, waveform, the real voice state, the live words.
- **The Idle Screen is three Columns**, each card with one home, the clock
  and its Clock Lines in the middle. Showing a card is a set, not an
  order; nothing is sized by relevance.
- **Light follows.** The same token names get light values in the same
  pass; Appearance stays `system | light | dark`.

## Considered options

- Recolour only, keep every layout. Rejected: the round-6 screens the
  owner compared move information, and the far view depends on it.
- Keep the Card Slot grid under the new tokens. Rejected: the bento's
  equal cells are what made the far view flat.
- Dark only, drop Appearance. Rejected: two unrelated looks behind one
  toggle would read as a bug, and named tokens make a light set cheap.

## Consequences

The page in the pane is never restyled; only its frame is. The pane's
background colour in main mirrors the token by hand (`paneBackgrounds.ts`)
and has to move with it. `pnpm shot:states` replays the round-6 state list
so the look has a guard beyond the Idle Screen.

## Amendment 2026-10-20: the shell as built (#359)

- **Tokens.** `styles.css` carries F1's dark set as `shell-chrome.css` gives
  it and a light set under the same names (off-white `#f4f5f7` ground, a
  faint dark lift for panels, peach deepened to `#b4521f` so it clears
  contrast on white, the data colours at their light weights), with radii,
  shadows, the focus ring and the pause scrim as tokens too. The earlier
  sheet's names (`--panel`, `--text`, `--status-*` …) stayed as aliases on
  the F1 roles until #360 redrew the Idle Screen with the new ones; they
  are gone (only `--panel-peek` is kept, the Peek Card's own ground).
- **The pane's frame** is drawn in the dashboard and the native view is
  rounded to match (`View.setBorderRadius`, `PANE_FRAME_RADIUS`);
  `paneBackgrounds.ts` paints `--surface-solid`.
- **The Feed Panel's default width** is 536 px — round 6's 520 px panel
  plus the 16 px gutter its view now carries. A width already dragged stays
  as stored.
- **Peach beyond the short list.** Settings' controls are peach as round 6
  drew them: the index's marker and number, slider fills, checked boxes,
  and the Weight page's span switch. They are the control being set, read
  as Bing Bong's own; everything else follows E4. This goes past #359's
  list of where peach is spent and awaits the owner's ruling there.
- **The Voice Prompt** in the panel says `Say "Bing Bong" or type a
  command`, `Type a command` while a Command runs, and `Microphone off —
  type a command` with the orb grey. Its live words mark the Page Terms
  carried on each `voice:partial` (`terms`), main sending the ones in force.
- **The guard.** `e2e/stateShots.e2e.test.ts` replays the round-6 list on
  an Xvfb screen of its own at 1920×1080, dark and light, plus Settings
  section by section, the Weight page, a Weigh-in over the pane and an
  Utterance being taken, and fails on text under 16 px, clipped, squeezed or
  off-surface text, or `#fff` text — the Capsule's live words, which
  ellipsize by design (#331), excepted. It runs in every `pnpm test:e2e`:
  the owner ruled on 2026-10-20 that the e2e is the source of truth and no
  screenshot is reviewed by hand (`pnpm shot:states` runs it alone).

