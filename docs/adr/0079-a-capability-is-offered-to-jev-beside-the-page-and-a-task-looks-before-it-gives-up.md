# ADR 0079: A Capability is offered to Jev beside the page, and a Task looks before it gives up

## Status

Accepted on 2026-10-20 by the owner, grilled from the post mortem of the
19:30 live run that day (logs `decision-1792521023837`,
`asks-1792521271251`). Amends #343's ruling 1 (the Player's lines are the
grammar's alone and Jev is never offered them) and ADR 0076's Local
Match (a `play <words>` line now reaches Jev). The Steps decision from the
same grill is ADR 0076's second amendment. Built as three tickets:
Capabilities (#362), Look-then-act (#363), Steps (#364).

## Context

With a song playing, four plain-English lines — "start the song from the
beginning and put it on loop", "put the song on loop and start from the
beginning", "loop the song" twice, "loop the video" — all failed. The
Player already does both things: `loop` sets the video element's `loop`
flag, which is what YouTube's own right-click "Loop" ticks, and `restart`
seeks to 0. They were reachable only through the exact phrases in
`musicWords.ts` ("loop", "loop this song", "from the beginning"), read by
the grammar before anything else; by #343's ruling Jev was never told the
Player existed. So the one reader that handles plain English chose among
the browser's fifteen verbs and the page's visible refs, and clicked the
time label (0.27) and the Settings gear (0.27). Each Task then read
`not_yet` with no next step and ended `unsure`, leaving the Settings menu
open under the next Command. The first line was asked on zero refs: under
the Idle Screen the pane's view is 0×0 and the collect's visibility rule
drops every element. Nothing split "X and put it on loop" into two.

Four structural gaps, none about "loop": the appliance's own actions are
invisible to Jev; a compound line is one ask; a dead end ends the Task
instead of changing the plan; a hidden page is a blind page. The owner's
intuition for the human path — right-click the player, see what it
offers, take the one that fits — had no verb and no loop to live in.

## Decision

**A Capability is an action the appliance itself can take, offered to Jev
as a verb beside the browser's.** While there is a song to act on — the
Player's, playing, paused or ended, or the video or audio the page itself
carries, whoever started it (amended 2026-10-21, below) — on any page and
under the Idle Screen, the verb Choice carries every Player op but search — loop on and off, restart, pause, unpause, skip, previous,
louder, quieter, mute, unmute, volume N (the Slot carries N), show — each
with a one-line description, in the same Choice as `click` and
`scroll_down`, not behind a second question. A Capability Command fires
the Player's op, answers the Player's line ("Looping."), and ends the Task
there: no hop, no Verdict. The option text says the page's button is
meant when the words say click, press or tap; Jev decides, no hard rule.
The exact phrases still settle in the grammar first and are the only
reading when Jev is unavailable.

**The grammar settles only exact whole lines and numbered refs.** Every
line with free words goes to Jev with the full option set — `play
<words>` included, which costs one Jev call on a line that needs the
network anyway. The Local Match's address-with-words rule is unchanged.

**`menu` is a browser verb: open a ref's right-click menu to see its
options.** For the user (`menu 7`, "right-click the player") and for Jev,
which may choose it when nothing visible fits the words. The options
revealed are the next hop's refs. The appliance's own right-click never
pops Electron's native menu. A `menu` that reveals nothing is a hop that
changed nothing and is set aside (#336).

**A dead end is undone and the runner-up tried once.** A hop read as
`not_yet` with no next step, after a hop that opened something on the same
page (the address unchanged, refs appeared), closes it — Escape, then the
same ref again if it is still open — and fires the previous reading's
runner-up target once, within the five-action cap. The end line names the
words: "I couldn't find *loop* here."

**A playing media element's state is in the ask.** "Playing: *title*
1:02 / 2:04, loop on, muted" rides in every Command and hop state while a
`<video>` or `<audio>` plays, so a Verdict can see a change the DOM does
not show (Loop ticked, the song restarted) and such a click is not read
as "nothing changed". No new Verdict outcome is needed.

**A hidden page is collected at its real size.** The pane under the Idle
Screen keeps an off-screen rect of the dashboard's size, not 0×0; a
Command typed over the screen reads the page as it is, with no automatic
resume.

## Considered options

- **More phrases in the music table.** The scenario fix; the next line
  not in the table fails the same way. Rejected: the owner asked for a
  smarter shell, not a longer list.
- **A second "which op" question after a `music` verb.** One more Jev
  call per music line. Rejected: the Choice already holds fifteen
  options; a dozen more cost nothing.
- **Every line to Jev, no grammar.** The widest net for the reading path,
  but the grammar's exact lines ("stop", "scroll down", "pause") fire in
  ~1 ms against Jev's ~250 ms, cannot be compounds, cannot be misread, and
  are the only reading when Jev is down. Rejected for exact lines; taken
  for lines with free words.
- **Driving YouTube's right-click menu for loop.** Slower and
  YouTube-shaped; the element's `loop` flag is the same thing. Not taken
  for music, but the `menu` verb stays, as the general path to anything a
  page hides behind a menu.
- **A "right page, not done" Verdict outcome.** Not needed once the media
  state is in the ask: a yes is a yes.

## Consequences

- Two routes to one end, which generalise differently: a Capability
  covers any media element on any site in one call; `menu` plus the undo
  covers anything hidden behind a menu on any site in a few hops. A
  Capability wins when both fit.
- The grammar's `play <words>` head moves to Jev; `WHOLE_LINES` keeps its
  exact phrases. The Jev corpus (`fixtures/jev-cases/`) gains the new
  options in its asks and must replay.
- The glossary gains **Capability**, **Menu** and **Step**; **Local
  Match**, **Task** and **Player** are reworded.
- The Timer is the next Capability; nothing here is music-shaped.

## Amendment: a song on the page is enough (2026-10-21)

The song's ops were offered only while the Player's queue held a current
song. Live runs on 2026-10-20 and 2026-10-21 found two ways a song plays
on the watch page that the Player does not own: `resume` brings the Last
Page back with its song still going, and `skip` with nothing queued clears
the current song and pauses the video where it is. On both, "loop the
song" read `none` and "start it from the beginning" read `play <words>`,
searching YouTube for a song by that name, because no song op was on
offer. The ops themselves act on the page's video element whatever the
queue holds.

**The song's ops are offered while a song is on: the Player's current
song, or a media element the page has started, playing or paused.** The
page's media is what #363 already reads into the ask's `Playing:` line, so
the ask that shows Jev a song also offers what can be done to it. With no
song anywhere, only a song to play is offered, as before. (Owner's standing
rule: cast the widest net; not a fix shaped by the two cases seen.)

The ops reach the song Jev was shown. The control script drives YouTube's
`#movie_player video` first, else the page's own media element as the
collect picks it — the one playing, else the first that started — so a
Capability chosen for a song on any page acts on that song rather than
failing with "Nothing is playing." ADR 0076's line stands for what the
user did not ask of that page: a `stop` with nothing in flight and a
`skip`'s own pause reach YouTube's player alone, never another site's
video. The Player's queue is unchanged: a song it never started stays off
the Now Playing card and is not remembered.
