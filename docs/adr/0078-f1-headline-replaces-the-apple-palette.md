# ADR 0078: F1 Headline replaces the Apple palette, and the Idle Screen's grid gives way to three Columns

## Status

Accepted on 2026-10-20 by the owner, after six rounds of mockups
(`/tmp/bingbong-theme-mockups/`, kept on the `issue-assets` branch under
`f1-theme/`). Supersedes ADR 0012's palette and its blue accent; keeps
ADR 0020's one token sheet with real light and dark sets. Replaces #352's
glass bento and Card Slot grid. Not yet built.

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
