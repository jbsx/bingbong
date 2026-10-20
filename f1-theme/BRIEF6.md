# Round 6 brief — extend F1 Headline to the whole app

The owner picked **F1 Headline** for the Idle Screen:
`/tmp/bingbong-theme-mockups/round5/f1-headline.html` + `.png` (+ `-far.png`).

> i like f1 headline from round 5. i want to extend this theme to the rest of the app.
> take screenshots of the states the app can be in. i want a side by side comparison

Bing Bong is an Electron voice-first "agentic browser" on a 21" wall screen,
1920×1080, read from 2–4 m. Awake, it shows a web page in a pane with a top
toolbar and an Activity Feed on the right; idle, it shows the Idle Screen.

## The current app, every state (real screenshots, dark, 1920×1080)

`/tmp/bingbong-theme-mockups/round6/current/s-*.png` — LOOK at the ones for
your states before designing. Each mockup must show **the same content and the
same state** as its current screenshot (same feed entries, same words, same
page) so the two can be compared side by side — only the theme changes. You
may restructure layout where the theme calls for it, but never drop
information or a control.

## F1 theme tokens (carry these over exactly)

Read f1-headline.html's CSS and reuse its tokens:
- Flat near-black background `#07090d`; panels ~1.8% white with ~6% white
  hairlines; no gradients, no blur, no shadows beyond the barest.
- Inter (Google Fonts) for text, Inter 600 for headline numbers, JetBrains Mono
  for tabular/mono bits (times, calendar). Text never under 16 px.
- Quiet slate labels (small, uppercase tracking where F1 uses it), near-white
  primary text (not #fff).
- Peach accent (F1's clock colon / voice orb / today) = Bing Bong itself:
  voice state, the active thing, primary buttons.
- E4 rule: colour intensity = importance. Status colours only where they mean
  something: success green, failure coral/red, working = peach pulse,
  warning amber. Everything else neutral.
- The slim voice line from F1 (peach orb, `Say "Bing Bong" or start typing`,
  waveform, LISTENING) is the voice/command affordance — use it instead of a
  boxed input wherever it fits.
- Data colours stay: temp hue ramp, rain blue, Codex violet / Claude coral /
  Kaggle amber, Jaish teal / Barun magenta, weight down green / up amber.
- Two reading distances: the one thing that matters in each state (what Bing
  Bong is doing / just said) readable from 3 m; the rest is the quiet layer.

## The web page itself

The pane shows a foreign web page — do NOT restyle the page's content. Render
it as the current screenshot shows it (e.g. the fixture "The lighthouse" in
serif on its own background), inside the themed pane frame.

## Deliverable

Write into `/tmp/bingbong-theme-mockups/round6/`. One HTML file may render
several states (e.g. `shell.html#read-answer`); screenshot each state with
`google-chrome --headless=new --disable-gpu --hide-scrollbars --window-size=1920,1080 --virtual-time-budget=4000 --screenshot=<out>.png 'file://<html>#<state>'`
Name each PNG `new-<same suffix as the current shot>.png`, e.g. current
`s-09-read-answer.png` → `new-09-read-answer.png`. LOOK at every PNG; fix
clipping/overlap; iterate at least twice. For the states where distance
matters, also run `python3 -I /tmp/bingbong-theme-mockups/round5/far.py in.png out-far.png`
and look. Return: the files, the design decisions (2–5 bullets), anything in
the current state you could not map.

## CHANGE (owner): AI usage card from F2

> i like the ai usage card from f2 in round 5. retain everything else from f1 headline

Every Idle Screen in this round = F1 Headline with its AI usage zone replaced
by F2 Contrast's AI usage card (`/tmp/bingbong-theme-mockups/round5/f2-contrast.html`
+ `.png`): lift that card's markup/CSS as-is, restyled only where F1's tokens
differ. Everything else stays F1.
