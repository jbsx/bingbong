# ADR 0080: A ref's kind decides its ops, and a Hop asks whether it helped

## Status

Accepted on 2026-10-21 by the owner, grilled from the post mortem of the
11:50 live run that day (logs `decision-1792579864896`,
`asks-1792579859609`; the first live session on #370's action card).
Narrows ADR 0079's Capability: the ops a media element can take come from
the ref, not from the Player's list, and the list's retirement is #374,
parked. Built as two tickets in this order: the progress Noul (#373), then
the media ops (#372). The progress bar that reads the Noul is #375.

## Context

"Skip 10 seconds ahead." had no right answer on the card. The Player has
no seek op; the browser's `forward` is history. Jev tied the media
element (click-7) and the time display (click-10) at 0.31, fired click-10,
and re-chose it with rising confidence (0.61, 0.86, 0.84, 0.91) to the
five-action cap: clicking the time display flips YouTube's remaining-time
readout, so every "Done so far" showed the label change, #336's unchanged
rule never tripped, and the Verdict's not_yet — right every time — only
fed the same click again. The old factored card read `forward` 0.63–0.69
and would have fired one no-op. Neither card could do it. "Turn on ambient
mode." read `none` 0.51 over the Settings gear 0.33 on both cards.

The owner's rule, 2026-10-21: "adding a capability is specific to this
scenario. i want the app to be smarter and more capable than having to
manually add capabilities … the app should be dynamic not static." Jev
chooses and generates nothing, so "smarter" cannot mean a better guesser:
it means widening what reaches the card by rule, and widening what a Task
does with what it learns. The card already derives ops from a ref's kind —
an input gets `type-N`, a link `open-N` — and a media ref got only
`click-N`.

Measured during the grill (re-asks ×3 on the logged YouTube card):

- Offering only the op the state allows (`unmute-7` on a muted element,
  "Mute the video.") does not make Jev pick the inverse (≤0.03); it sends
  Jev to the page's own toggle button (0.61–0.65), which would unmute.
  Offering both reads `mute-7` 0.73–0.79 on a muted element: idempotent.
- With a `forward-7` line on the card, "Skip 10 seconds ahead." reads it
  at 1.00. "Go back a minute." reads `back-7` 0.54–0.57 over the browser's
  `back` 0.32–0.36: that verb's "go back to the previous page" is a lure.
- The page's own button outranks the op line where both fit (click-9
  "Mute" 0.71–0.76 over `mute-7` 0.24–0.29): #370's "a ref that names what
  the words name is the page's own control" doing its job. The op lines
  matter most where the page shows no control, which is the seek case.

## Decision

**A media ref carries the media element's ops on the action card, always.**
Every `<video>` or `<audio>` ref (`RefKind` 'media') offers, on every site,
`play-N`, `pause-N`, `forward-N`, `back-N`, `restart-N`, `volume-N`,
`mute-N`, `unmute-N`, `loop-N`, `unloop-N`, `rate-N`, each a whole action
with its own line, regardless of the element's state: an op that changes
nothing (mute on a muted element) is harmless and the next Hop's Verdict
ends it. What is withheld is by ability, never by state: a
`captions-N`/`uncaptions-N` pair only on an element with text tracks;
`forward-N`, `back-N` and `restart-N` only on one with a seekable range,
so Jev is never offered a line that would fire nothing. Each op is one
evaluate on that element through the browser controller, beside click and
type; the Player is untouched, and its exact typed lines keep their path
until #374. No grammar line is added: "skip ahead" is Jev's to read.

**Jev chooses the amount.** One `amount` Choice rides on every ask that
offers a media ref, on the same call as the action, read only when the
action is a seek: `words` (the number the words carry, seconds or minutes
as they say), `moment` (a hundredth of the duration), `little` (a
twentieth), `chunk` (a tenth), `lot` (a quarter), `half`, `end` (the start
when going back). No per-product constant: the code is the rung list and
the arithmetic, and the record keeps the rung so a bad one is a reading in
the ledger. A live stream maps the fractions onto its seekable window.

**A media ref's state rides on its line.** playing, paused or ended;
elapsed/duration, or `live`; volume as a percentage, or `muted`; loop;
rate when not 1; `captions off` or `captions <lang>` when the element has
text tracks; buffering; failed. The same facts tell "Done so far" what an
op changed (elapsed moved from 0:16 to 0:26). Autoplay, controls, source
and size stay off the line.

**Several media refs: each its own lines, Jev picks the element.** Two
playing videos mean `pause-7` and `pause-12`, each line naming its title
and state. A bare verb over two playing elements fires Jev's top pick, a
Misfire the next Command recovers, as ADR 0076 has it for every ambiguity.
The card orders refs, then media ops, then `menu-N` under the 255 cap, so
menus give way before ops. While any media ref is on the card the Player's
song-ops Capabilities (loop, loop_off, restart, pause, unpause, louder,
quieter, mute, unmute, volume) are withheld, so one thing never has two
lines; its `Playing:` line stays, naming its own song.

**A Hop past the first asks whether the last action helped.** Beside the
Verdict, one Noul: did the last action bring the page closer to what the
words ask, judged by "Done so far" and the page now. At or under 0.3 — the
mirror of the 0.7 bar — the action is set aside; between 0.3 and 0.7
nothing happens, so a genuine intermediate step (open the menu, then click
the item) is not punished; the Verdict alone ends the Task, and a sure yes
ends it done whatever the Noul says. Two no-progress Hops in a row end the
Task unsure, said so: #336's two-strikes shape, sharing its mechanism.

**A set-aside is keyed by the action's card label.** `click-10`,
`forward-7`, `loop`: a ref's set-aside today becomes the label form of the
same thing, and an op or a ref-less verb can be set aside too.

## Considered options

- **A seek Capability.** The scenario fix, one more line in a hand-grown
  list. Rejected by the owner: dynamic, not static.
- **Ops offered by state** (only `unmute-N` while muted). Measured:
  Jev falls to the page's toggle, not to the inverse op, and the toggle
  undoes what was asked. Rejected; ability gating kept.
- **A fixed step in seconds.** Every candidate is a product's convention
  (YouTube 5/10, Netflix 10, iOS 15, podcasts 30). Rejected: the only
  quantity the media gives is its duration, and the rung is Jev's to pick.
- **No default, or asking "how far?".** ADR 0076 forbids the question;
  a wordless seek that fires nothing is the failure seen. Rejected.
- **A rule about repeated clicks** (a Hop never re-clicks the ref the last
  Hop clicked). Single-case by construction, and wrong for a toggle that
  registered nothing (#367's fresh-profile effect). Rejected for a
  question Jev answers.
- **Progress acted on under the 0.7 bar.** Would set aside every
  intermediate step reading 0.5. Rejected for the sure-no at 0.3.

## Consequences

- The card grows by eleven lines per media ref (thirteen with captions).
  #372's AC3 measures the cost on the captions and loop cases against the
  ~0.2 the menu lines cost (#370); `rate-N` and `restart-N` go first if it
  is more, never the pairs.
- A non-YouTube page with a native `<video>` joins the e2e fixtures, so
  the media ops are proven on a site the Player never touches. YouTube
  draws its captions itself, not through text tracks: its captions stay
  the page's button, and the captions ops serve sites on the standard.
- ADR 0079's Capability narrows to the Player's own: a song to play, the
  Queue's walk, show. #374 retires the layer once #372 is read live.
- The glossary gains **Media Op**, **Amount** and **Progress**;
  **Capability** and **Set Aside** are reworded.
- The browser's `back` and `forward` lines are lures for "go back a
  minute" and "skip ahead"; a replay regression on them is a reading to
  fix in wording, measured, not a rule.
