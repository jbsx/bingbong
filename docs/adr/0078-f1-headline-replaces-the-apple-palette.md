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

## Amendment 2026-10-20: the middle Column's two homes (#365)

- **Now Playing is a card, not a Clock Line.** The middle Column has two
  homes under the clock and its Clock Lines — `music` over `usage` — drawn
  as one panel of bands parted by a hairline, as the right Column is. The
  Clock Lines are the Voice Prompt, Up Next and the Last Page.
- **The middle Column runs through `columnBands`** like the right one,
  replacing the hand rule that stepped the AI Usage down under a Timer and
  four lines. Its room is the Column less the clock row (or the Timer's)
  and the Clock Lines shown. Now Playing asks 280 px full or 120 small and
  never grows; the AI Usage asks its rings over a 240 px chart, or its rings
  alone, and takes the spare. So the chart goes before the card steps down,
  and the spare height goes back to the chart. The heights are measured
  from `styles.css` (`core/idle/columns.ts`); the mockup's 290 px card came
  down to 280 so a song with the Last Page keeps its full card.
- **The rings draw smaller under the card.** With one or two providers the
  rings are 228 px, too tall to sit under a full card in the owner's usual
  Column; in the AI Usage's smaller form, and in a short chart's, they are
  drawn at three providers' 184 px. Nothing they show is dropped. The
  chart's last values keep their least distance apart in pixels, so a
  shorter chart parts them further.
- **No peach on the card.** The song's picture is its only colour, as data
  (E4); the music is not Bing Bong itself.

## Amended 2026-10-25: the full-contrast dark set

Owner ruling 2026-10-25, built on main 9d81986f: the max-contrast Idle
Screen became the dark set for every surface.

- **The ground is `#000`**, replacing the Decision's near-black `#07090d`
  (the pane's native ground in `paneBackgrounds.ts` too). Panels no longer
  lift off it and cast no shadow.
- **Text is three opaque steps, `#fff` / `#bdbdbd` / `#858585`**, replacing
  E4's "near-white text never `#fff`" and the #359 amendment's `#fff`-text
  check. In dark, the guard now fails on any opaque surface larger than a
  control that is not pure black.
- **Colours run at full brightness** at their own hues, and the usage chart
  fills solid. Light is untouched.

## Amended 2026-10-26 (#437, #446, #448, #449): the dark set clears 7:1, and the accent marks only what is live

Ruled by the orchestrator on the owner's behalf under `docs/agents/ui.md`
(principles 5, 8, 9), newer than this ADR.

- **The quiet grey is #959595.** `--fg3` and `--idle` in the dark set
  (`styles.css`, the dark `:root` block) move from #858585 to #959595:
  7.01:1 on #000, where #858585 was 5.69:1. #858585 was the owner's pick
  of 2026-10-25, made before the 7:1 rule; the rule wins, and the owner
  may veto. The dark text keeps three opaque steps (`--fg`, `--fg2`
  #bdbdbd, `--fg3`). Light is unchanged.
- **The accent is for what is live, and nothing else.** It stays on the
  voice orb and the voice state, a running Task, a live Weigh-in, the
  primary buttons, a focused control, and a ringing Timer. It left the
  clock colon; today's date, weekday and square; the Settings index mark,
  toggles and sliders (this settles the #359 amendment's "Peach beyond
  the short list" against them); the Timer while it runs; Up Next's time;
  the Last Page's go mark; the Weight range chip; the Idle Prompt reply's
  rail; and an unknown usage provider. Each takes white or a quiet
  layer. This replaces the Decision's "today, the Timer".
- **A ringing Timer is live (#446); a running one is not.** Ringing, it is
  the one thing on the Idle Screen asking for the person's act: "Time's
  up", its ring, and the Toolbar Timer's mark and words take the accent.
  The countdown stays white.
- **Data series do not count toward the five meaningful colours**
  (principle 8), provided none sits in the accent's hue band or the
  failure's. The weather, usage and weight series keep their hues. Three
  hues moved out of the bands: Claude #ff8f74 → lime #b8f27c, Barun's ▲
  (`--up`) #ffae65 → #ffd166, and the sunset mark #ff7a4d → #ffb340. The
  temperature scale's heat stops at amber (hue 44° at 25 °C, 36° from
  35 °C) instead of running to red. A guess, the arm cheapest to
  reverse (the other jumped to magenta past about 28 °C); a hot day in the
  owner's eye settles it. The band's width (14°, `HUE_BAND`)
  is a guess too.
- **One rest hint.** "Say “Bing Bong” or start typing" (`REST_HINT`,
  `core/voice/voiceHint.ts`) is the resting line on the Idle Screen, the
  Status Capsule, the Voice Prompt and the empty Feed. It replaces the
  #359 amendment's `Say "Bing Bong" or type a command`. Ctrl+Space is
  named in Settings › Voice, not in the hint. The Voice Prompt's other
  field lines stand.
- **Native controls inherit the app's font and colour**, so Inter and
  JetBrains Mono stay the only faces.
- **The live tint is one class.** Every surface washed in peach carries
  `.live-tint`: the working or listening Status Capsule, the working Feed
  bubble, the live run's summary and the live ear's Voice Prompt. The
  class carries the wash (`--accentq`), and in dark it sets `--fg3:
  var(--fg2)`. No wash keeps #959595 at 7:1, because #959595 clears 7:1
  on pure black and nothing darker; measured on the live Voice Prompt
  (#448):

  | wash (peach, alpha) | #959595 on it |
  | --- | --- |
  | 0.14 (shipped) | 5.77:1 |
  | 0.06 | 6.57:1 |
  | 0.02 | 6.87:1 |
  | 0.005 (rgb 1,1,1) | 6.97:1 |
  | 0.14, quiet text at `--fg2` #bdbdbd | 9.20:1 |

  The ruling preferred a thinner wash, with #bdbdbd only if none
  cleared. None does, so the fallback holds, by class and not per surface
  (#449). Light is unchanged.
- **The colour floor is the standing measure.** `e2e/colourFloor.ts` runs
  in every `stateShots` state, dark and light, and in every state
  `shot:idle` holds. It fails on any of these:
  - own text under 7:1 over its composited ground in dark (a fade in
    flight excepted);
  - a face other than Inter or JetBrains Mono;
  - the accent at rest outside the live list above;
  - a colour other than the accent, the failure colour and the failure
    text inside either hue band;
  - an `--accentq` wash without `.live-tint`, or a dark `.live-tint`
    whose `--fg3` is not `--fg2`.

  `stateShots` also asserts one rest hint on all four surfaces, and
  `e2e/colourFloor.chrome.test.ts` guards the check itself.
