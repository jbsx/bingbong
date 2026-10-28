# ADR 0097: A line given while another runs is read against it, and the running Command's Fate is Jev's

## Status

Amended 2026-10-28 by #494: the running Command's lines sit right after
the words, not after the state's own lines (measured on the Overlap Jev
cases, the row-8 Fate at the runner's 0.7); and a joined line is the line
it joins, on its Task, reaching one that already fired and ended — a joined
reading of what that line fired, or of nothing, stands on it, any other is
its next hop (CONTEXT.md, Fate). The numbers are on #494.

Accepted 2026-10-28. Landed on the orchestrator's word for the owner,
2026-10-28, with the run of record: full overlap:gate 17/25 through at
4ec5948b (3/24 at 919f058f), full jev:gate Mammoth 379/430, Overlap 9/9.

Proposed 2026-10-28, from #489's grill (note 4103422937, Q15) and the
orchestrator's rulings (note 4103441871); drafted on the issue in note
4103742129. Built 136cb98b..66a29c97 on main. It amends ADR 0076 (the next
Utterance ends a Task; a superseded Task says nothing) and ADR 0096 (one
more question on the Appliance Card while a line runs).

## Context

Until #489 a line's arrival ended the line before it, before it was read
(`submitted`, ADR 0076 "Superseding reaches the reading"). Whatever the
new line turned out to be (a remark, a timer, a question about the wait,
a correction), the running Command ended `cancelled`, its Answer
"Stopped: a later Command came first." shown grey and never said. Whether
the first line survived was a race between its landing and the new
line's read. The first measure of the Overlap (#486, `pnpm overlap:gate`
at 919f058f) put 3/24 Sequence Cases through on Mammoth and 2/24 on
Elephant. The Appliance Card never showed the running Command, so Jev
read each line alone: `no, by coldplay` played Meghan Trainor's "No".

## Decision

- **Arrival ends nothing.** A line given while another runs (CONTEXT.md
  Overlap: read, fired and not landed, a Task between hops, an Errand)
  is read against it. Only a Fate that ends or joins, a `stop`, an abort,
  or an exact line that takes the pane ends the running Command. A
  partial's reading still goes stale on the next submission (#326).
- **The Appliance Card carries the running Command** while one runs,
  after the state's own lines: its words on a labelled line of their own,
  with how long before the line being read they were given; its stage in
  the Status Capsule's words (#428); its Task's actions so far; the media
  it is opening, named before it exists. Measured (T1, below).
- **One more question, the Fate**, after the action (T2): `ends` (a new
  request or a stop), `joins` (it finishes or corrects the running line),
  `waits` (it acts on what the running line is opening), `goes_on`
  (something else, a question about the wait, a remark or noise). A
  `page` or `none` action keeps the Fate it picked. An idle line's card is
  unchanged byte for byte; a unit test holds it.
- **A fact Appliance Verb, `say_doing`**, offered only while a line runs:
  its option carries the sentence it says ("Still opening “let down by
  radiohead”: loading youtube.com."). Picking it goes on.
- **Unsure is `goes_on`.** A Fate under the Appliance Card's bar (0.7), a
  missing one, or a failed host: a wrong goes-on costs one `stop`, a
  wrong end loses the person's first line (ui.md 3).
- **The runner acts on the Fate, never on timing.**
  - `ends`: the running line ends, its action in flight cancelled, its
    Errand ended; an ended `play` stops the pane's load and pauses it,
    and its song's start is never pressed after nor its consent wall
    cleared (a clear already out holds the page paused for a self-start's
    bound), unless the line that ended it takes the pane. Then the new
    line fires.
  - `joins`: the running line gives way, and the two lines' words, in
    order ("play yellow, no, by coldplay"), are read again as one line on
    one more ask (T3, arm J1). That ask never offers Steps: the joined
    line takes one step, never a second on the bare correction.
  - `waits`: the new line waits until the running line ends, however it
    ends (every runner wait is bounded), and is read again against what
    is there.
  - `goes_on`: the new line fires; the running one keeps its own end.
- **Exact lines keep firing on their words**, no ask (ADR 0096). What they
  do to the running Command is by kind: a Command that takes the one pane
  (navigate, search, back, forward, reload, resume, a `play` that opens
  now) ends it; `stop` ends it; a control on media a `play` is still
  opening waits for it; any other exact line goes on beside it. An Early
  Fire is a submission and follows the same rule. A Jev-read Command that
  takes the pane ends the running line too, unless its Fate joins or
  waits: the pane is one.
- **Every Fate ends said** (ui.md 2, 9, 10; reliability.md rule 5):
  - an ended line says "Stopped <its Acting stage>." ("Stopped playing
    let down by radiohead."), ahead of the new line's own sentence, as one
    utterance; no model writes it;
  - `stop`, `never mind` and an abort say "Stopped.";
  - `joins` says the joined line's outcome;
  - `waits` says the add-on's own result once it applies;
  - `goes_on` says the new line's result, and the running line says its
    own end as it would have.
- `BINGBONG_APPLIANCE_CARD=off` keeps the road before this ADR: no card,
  no Fate, so arrival supersedes as ADR 0076 had it.

## Measured

The ties were measured on the Overlap Jev cases (`pnpm jev:overlap`, 9
cases grown from the kept 919f058f runs and the kiosk's split line
`turn-mvphyqdu-vl`), Elephant then Mammoth, through = both; deterministic
gate models, one run each, never Jev. The measure was named in the grill
before any arm was built. (From 2026-10-28 the owner's ruling puts every
gate on Mammoth alone; the ties were settled before it.)

- **T1, the running Command's wording.**

  | arm | Elephant | Mammoth | through |
  |---|---|---|---|
  | A, labelled lines | 9/9 | 8/9 | 8 |
  | B, compact two lines | 7/9 | not run (lost on the weaker model) | ≤ 7 |
  | A + the running line's rest "when it was cut off" in `joins` | not run | 8/9 | ≤ 8 |
  | A + the gap (how long before it the running line was given) | 8/9 | 9/9 | 8 |
  | A + "(a remark, noise)" in `goes_on` | 8/9 | 8/9 | 8 |
  | **A + the gap + "(a remark, noise)"** | **9/9** | **9/9** | **9, the winner** |

  The gap is a fact by kind (each live line keeps its Endpoint), not a
  timing rule: the new goal `open the weather`, given 0.86 s after, still
  read `ends` on both models. The losing arms left the tree.
- **T2, the Fate question before or after the action.** Before: Elephant
  9/9, Mammoth 8/9; after: the same. A measured tie at equal length goes
  to the arm cheapest to reverse: **after**, built, keeps the action
  question first as on the idle card that ADR 0096 measured.
- **T3, how a join is read.** **J1** (the two lines' words read again as
  one line, one more ask) is built. **J2** (the ask that picked `joins`
  also picks the Slot from both lines' words) is named and left unbuilt:
  its Slot spans would carry the running line's words on every Overlap
  ask, a lure on `ends` and `goes_on` lines, and spans that grow with the
  square of the joined length against the 255-option cap, for one ask
  saved (p50 0.2–0.3 s on the gate models). **This is a guess**, taken as
  the arm cheapest to reverse (no CONTEXT Slot change). What settles it:
  the `joins` lines' Felt Reaction in the kiosk perf logs. Past Quick's
  p95 (4 s) with the joined ask as the cost, J2 is the next arm. On the
  run of record the joined line fired at p50 2.3 s from its Endpoint
  (n = 8, both asks inside it); what came after was the song's landing.

The run of record, on Mammoth, 3 points, seed 1: the full overlap:gate
17/25 Sequence Cases through at 4ec5948b against 3/24 at 919f058f; the
full jev:gate 379/430 through, Overlap 9/9, every other case replaying
its stored ask byte for byte, so nothing that passed before was lost.

## Consequences

- A remark, a timer or a question about the wait no longer ends a Task.
- A `joins` pays one more ask; a `waits` lands after the line it waits on.
- The card grows by the running lines and one question only while a line
  runs; the page card is unchanged.
- ADR 0076 is amended: "the next Utterance … end[s] a Task as [it ends] a
  Command" now reads "a Fate that ends or joins, a `stop`, Escape, the
  Abort Head or an exact line that takes the pane end a Task as they end a
  Command"; "a superseded Task says nothing" now reads "an ended Task says
  it stopped, naming what it was doing".
- ADR 0096 is amended: while a line runs, its Appliance Card carries the
  running Command and asks its Fate.
