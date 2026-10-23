# ADR 0080: A ref's kind decides its ops, and a Hop asks whether it helped

## Status

Accepted on 2026-10-21 by the owner, grilled from the post mortem of the
11:50 live run that day (logs `decision-1792579864896`,
`asks-1792579859609`; the first live session on #370's action card).
Narrows ADR 0079's Capability: the ops a media element can take come from
the ref, not from the Player's list, and the list's retirement is #374. Built as two tickets in this order: the progress Noul (#373), then
the media ops (#372). The progress bar that reads the Noul is #375.
Amended on 2026-10-22 by the owner's ruling on #389, and on 2026-10-23 on
#398: a search box is a kind, and searching it is its op.

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
rate when not 1; `captions <lang>` when a text track is showing, `captions
off` when every track is disabled; buffering; failed. The same facts tell
"Done so far" what an op changed (elapsed moved from 0:16 to 0:26).
Autoplay, controls, source and size stay off the line.

**A media ref's line also carries its player's switches** (ruled on
#389). A switch is a two-state control (a button pressed or not, a
switch, a checkbox; never one choice among several) that sits with this
media and no other: the smallest part of the page holding both holds no
other video or audio. Each rides on the ref's line by its own label and
`on` or `off`, so Jev reads what it switches. The line names nothing
itself: a player that draws its own captions shows `"Subtitles/closed
captions unavailable" on`, and Jev reads that the captions are on. A
track in `hidden` mode says nothing, because a hidden track is on at
Vimeo and BBC but off at Plyr. The switches go on the ref's line only,
never on the `Playing:` line. Jev acts on a switch by clicking its ref,
so no new op is offered.

**Amended 2026-10-23 (#398): a search box is a kind, and searching it is
its op.** A ref is a search box when it is an editable field that declares
it (`type=search`, `role=searchbox`, `enterkeyhint=search`), sits in a
search landmark, or is named for it by its name, id, aria-label or
placeholder. A password or payment field never is one. Its line says
`searchbox` and what it holds; its form's submit says `button[submit]`.
Each box carries one Search Op, `search-N`, beside its `type-N`: the words
replace what it holds, then the box is submitted, by Enter or by the form
itself where Enter would not. Jev chooses it; the web search and its
`where` stay as they were.

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
- **A captions fact picked by a word list** (`captions on` from the
  control named caption, subtitle or CC; #389). It measured best on
  "disable captions" (0.95–0.98), but it is code deciding which control
  means captions. Rejected for the switches by kind, which measured
  0.82–0.95 on disable and 0.90–0.93 on enable (3 replays, 17 YouTube
  cases).
- **The button's `pressed=` alone** (Ref State). It left "disable
  captions" at 0.67–0.91 and the Verdict at 0.68–0.73.
- **Captions text drawn over the video.** Nothing is drawn between lines
  of speech: 12.5% blank during speech, and blank for the whole intro.
- **The switches on the `Playing:` line too.** One case failed and the
  Verdict dropped to 0.75–0.81.

## Consequences

- The card grows by eleven lines per media ref (thirteen with captions).
  #372's AC3 measures the cost on the captions and loop cases against the
  ~0.2 the menu lines cost (#370); `rate-N` and `restart-N` go first if it
  is more, never the pairs.
- A non-YouTube page with a native `<video>` joins the e2e fixtures, so
  the media ops are proven on a site the Player never touches. YouTube
  draws its captions itself, not through text tracks: its captions button
  rides on the media ref's line as a switch (#389), and the captions ops
  serve sites on the standard.
- ADR 0079's Capability narrows to the Player's own: a song to play, the
  Queue's walk, show. #374 retires the layer, the Player's own as Appliance
  Verbs.
- The glossary gains **Media Op**, **Amount** and **Progress**;
  **Capability** and **Set Aside** are reworded.
- The browser's `back` and `forward` lines are lures for "go back a
  minute" and "skip ahead"; a replay regression on them is a reading to
  fix in wording, measured, not a rule.

## Amendment 2026-10-23: volume and rate take Jev's direction (#408)

A volume or rate change is Jev's in direction and in size, as a seek's is:
code no longer reads up or down from the words. The op's shape is a tie
measured at build by the gate: either split ops (`volume-up-N`,
`volume-down-N`, `volume-set-N`, the same for rate) with the Amount Choice
read for them, or one op with the direction riding the Amount Choice.

Measured 2026-10-23 on `pnpm jev:gate` (Mammoth ∩ Elephant), the corpus
transformed for each arm, with the three ledger lines grown as cases
(cli-10/11/12-mvle*) beside "turn the volume down" (cli-5-mvh3klxs):

| Arm | Through on both models | Red | Direction cases |
| --- | --- | --- | --- |
| Untouched card (code read the words) | 133 / 156 | 19 | — |
| Split ops: `louder-N`, `quieter-N`, `volume-N` (and `faster`, `slower`, `rate`) | 136 / 159 | the same 19 | 4 / 4 |
| One op, the direction in the Amount Choice (`to`, `up-little` … `down-all`) | 136 / 159 | the same 19 | 4 / 4 |

A measured tie: both arms pass every direction case on both models and
lose nothing. The one-op arm landed, the cheaper to reverse: the card's
labels stay as they were, it adds no ops, and it is about 266 characters
shorter on a media card. Its margins (Mammoth / Elephant): "turn it down a
bit more" `volume` 0.98/0.96, `down-little` 0.88/0.72; "make it less
loud" 0.95/0.77, `down-little` 0.78/0.51; "a little louder" 0.99/0.96,
`up-little` 0.96/0.98; "turn the volume down" 0.94/0.93, `down-step`
0.52/0.67. The split arm's action margins were 0.92–0.99 on both models.
A seek's rung on a volume reads the most probable level rung Jev gave any
probability. The step each rung makes
on a volume or a rate (little, step, lot: 5, 10 and 25 points; 0.25, 0.5
and 1×; `all` to 100 or 0, 4× or 0.25×) is a guess, kept cheap to reverse: what "a little
louder" should mean only the owner's day can tell.

The op sets and reads the element alone. It does not call `#movie_player`'s
`setVolume` or `mute`, because a by-kind op names no site, and the level set
must be the level the next read shows (it was not: set 53, read 23%,
ledger cli-10/11/12-mvle*). The Player's exact lines keep their own
YouTube calls: the Player is YouTube by design.
