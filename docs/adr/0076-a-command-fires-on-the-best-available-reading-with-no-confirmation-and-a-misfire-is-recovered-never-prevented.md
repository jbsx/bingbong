# ADR 0076: A Command fires on the best available reading, with no confirmation, and a Misfire is recovered, never prevented

## Status

Amended on 2026-10-20 (see "Amendment: a line is Steps" below): Jev is
asked at hop 0 where a second Command starts, and each Step runs as its
own Task in order. ADR 0079 moves `play <words>` from the Local Match to
Jev and offers the appliance's Capabilities beside the page.

Amended on 2026-10-18 (see "Amendment: one Utterance is one Task" below):
an Utterance is a Task of one or more Commands, and a landing is the page
gone DOM-quiet, not the load event.

Accepted on 2026-10-17 for the `kachow` branch, grilled the same day from
the branch at f4d323b and the measurements in `docs/moonshine-ab.md`, with
every recommendation taken. Increment 1, the plain loop this decision
shapes, is built (#324, see the implementation notes); its Reaction
distribution is the baseline the later increments are measured against.

## Context

The branch's one aim is a browser the user would rather speak to than
click in. The mouse's Reaction is tens of milliseconds; the loop on this
branch at f4d323b released an Utterance about 2.4 s after the user stopped
talking (900 ms endpoint delay and a 1,500 ms resumption-merge hold), then
decoded it, and had no reading of plain English at all. Moonshine
transcribes a command-length Utterance in 100–270 ms and produces a partial
every 500 ms that nothing read; Jev answers a Choice in ~220 ms and
generates nothing; every browser action slept 300 ms of pacing before
looking at the page.

Every way of being right before acting costs the one thing the branch is
for: a confirmation step is a round-trip, a longer endpoint is dead air, a
re-decode after the Endpoint is a wait, a generating model is seconds.

## Decision

Speed over accuracy. A Command fires on the best reading available at the
moment one exists:

- the Local Match when the words and the page settle it alone, with no
  model asked;
- else Jev's top Choice, acted on at any confidence, refused only when
  Jev reads the Utterance as no Command for the page;
- as an Early Fire on a partial transcript once the words so far read as
  a complete Command, the Endpoint then only closing the Utterance;
- at the Endpoint otherwise, released 300 ms into silence with no merge
  hold, so a pause mid-sentence makes two Commands;
- with the browser's pacing sleeps removed and typing inserted whole.

Nothing asks "did you mean". A Misfire is recovered by the next Command
("back", "clear", "escape", a scroll the other way) and is counted, with
its reading, its confidence and whether it was a Local Match or an Early
Fire, so accuracy can be worked on from data once Reaction is won. The
Reaction target is p50 under 500 ms and p95 under 1 s on the development
machine; the Hardware Floor waits.

## Considered options

- **Confirm below a confidence bar.** Rejected: the bar would be guessed
  before any Misfire had been seen, and every confirmation is the
  round-trip the branch exists to remove. Confidence is logged, not acted
  on.
- **Keep the resumption-merge hold.** Rejected: 1.5 s of waiting for the
  user to possibly resume is the single largest cost in the loop; a split
  command is one Misfire, recovered in one word.
- **A generating model for intent.** Rejected: the owner buys no more
  compute, and a generating round costs seconds where Jev costs a fifth of
  one.

## Consequences

- Misfires will happen and are the design working, not failing. The
  Misfire log is the dataset the accuracy work starts from.
- Bot detection gets likelier on sites that read human pacing; accepted.
- Jev is asked up to a few times per Utterance under Early Fire, at
  $0.042 per million input tokens: cents a day. The rate cap in the
  TypeSafe console is the limit to watch, not the bill.
- Every later lever (Hot Listen, persistent Piper, Early Fire) is measured
  against the plain loop's Reaction distribution before it stays.
- The Decision Model is pinned to `jev-1.14.0`, not the `jev-1.13.0` the
  adapter inherited, by the owner's ruling on 2026-10-17: no confidence bar
  is tuned on this branch, so nothing holds the old pin, and 1.14 is the
  release whose Box question can locate a target in a screenshot, the one
  door left open to grounding a Command on the page's pixels later. Both
  releases accept images behind the `TypeSafe-Danger-Zone-Images` header;
  nothing on this branch sends one yet.
- Typed lines in the Prompt Bar and the CLI harness are Commands read the
  same way as spoken ones; the old CLI grammar survives only as what the
  Local Match recognises first.

## Amendment: one Utterance is one Task (2026-10-18)

Grilled on 2026-10-18 from the question "how does the shell take 'pull up
the latest Elon Musk tweet'", which increment 1 answers with one DuckDuckGo
search and then waits for the user to say "open the first result" and
"read". Jev is a Decision Model — Choice, Noul and Score, nothing
generated — so it cannot compose a plan or a URL; it can choose the next
step on the page it is shown. The amendment lets the shell keep showing
it the page until it says the task is done.

### Decision

**One Utterance is one Task of one or more Commands**, each fired on the
best available reading, none confirmed. The first Command (hop 0) is read
exactly as before. A Task **continues after a Command Jev read and ends
after one the Local Match settled**: the Local Match settles only the
grammar and exact labels ("scroll down", "click 3", "open youtube"), which
are whole by construction; plain English, which is where "and then" lives,
went to Jev. No verb, no scenario and no Route table decides this. "Open
youtube and search for lofi" is not address-shaped and "click settings and
turn on dark mode" matches no one label, so both go to Jev and continue.

Every hop after the first is read by Jev alone, against the full
transcript, with the same three Choices as hop 0 and one more option:

- the verb Choice gains **`done`**, "this page is what the user asked for,
  nothing more to do"; it is offered at hop 0 too, where it fires nothing
  and the Feed shows the words greyed as `already here`;
- the target Choice offers the refs in view and, on a search landing, the
  whole page's result links (the links whose host leaves the engine, the
  Local Match's own Nth-result rule), since results start below the fold;
  links out of view on other pages are reached by a `scroll_down` hop;
- the Slot Choice stays over the transcript's word spans: a hop types only
  words the user said, and a hop that would need unsaid words is `none`;
- the state carries the hop number, the addresses visited and the actions
  taken so far; a page already visited in this Task is never offered.

A hop's typed or search Slot passes the Name Match against the landing's
Page Terms as hop 0's does.

**Continuing verbs** are open, click, type, press, scroll_up, scroll_down,
back, forward and `reload` (new to the vocabulary and the CLI grammar).
**Terminal verbs** are read (it holds the floor while it speaks), stop,
clear, none and done.

**A Task ends** on `done`, on `none` at hop 1 or later (a dead end: the
page stays as it stands, nothing is spoken, the Feed shows `no next step`
greyed), on the **cap of five actions** including hop 0 with scrolls
counted (it stops where it stands, as `done` would), on a wall (a Blocker,
consent wall, not-found, unavailable or empty landing speaks its failure
line as today), when a hop's Jev call is unavailable (hop 0's best guess is
hop 0's alone; a hop never guesses), and when it is superseded: the next
Utterance, Escape and the Abort Head end a Task as they end a Command,
abandoning a hop whose read is in flight. There is no retry-with-exclusion
of a candidate on this increment. (Amended by #336: a hop that changed
nothing sets its target aside, and two in a row end the Task; see below.
Amended by ADR 0082: at hop 0, a `none` reading asks where first, and
only a second `none` ends the line.)

**Early Fire**: a hop 0 that fired on a partial does not continue until the
Endpoint; the hops read against the final transcript. An Utterance that
never reaches an Endpoint ends after hop 0.

**The Hot Listen's silence clock restarts when the Task ends**, so the user
has the full `hotListenSilenceMs` after the final page, not what was left
after the hops.

**A landing is the page gone DOM-quiet, not the load event.** One landing
wait serves navigate, back, forward and a click that leaves the page: from
the navigation's commit, `dom-ready`, then 250 ms with no DOM mutation in
the main document, or the load event if it comes first, whichever is
earlier; capped at 3 s from the commit, after which the page is taken as it
stands and the record says the landing was `capped`. The 30 s bound stays
only as the hard error for a navigation that never commits. The landing
classifiers run on that same collect. In-page actions keep the 150 ms
readiness wait. This replaces increment 1's "the load's own end is the
wait", and speeds hop 0 of every Command, since on a slow connection the
refs are there long before the last tracker has loaded.

### Considered and rejected

- **The shell decides what is a Task by verb** (an `open` whose Slot is
  not address-shaped opens a Goal). One rule, but a guess about where
  multi-step tasks start; it misses "open youtube and search for lofi".
- **Every Command continues, Local-Matched ones included.** Rule-free, but
  it adds a page collect and a Jev call after every "scroll down" and a
  new Misfire class on the half of Commands the Local Match settles (19 of
  35 in the first logs). Following the reading instead keeps the
  continuation to the Commands that were plain English.
- **Jev asked up front whether the words need more than one step.** A
  reading that can misfire before anything has happened.
- **A Route table** (tweets by a person, videos by a channel). Fast and
  deterministic, but every site needs a recipe. Not taken; a Task reaches
  the same pages through the search engine.
- **A generating planner.** Still rejected on compute.

### Consequences

- Every `command` event carries `task: { id, hop }`; a one-Command
  Utterance is a Task of one hop. One decision record per hop; the last
  carries `ended: done | none | cap | wall | unavailable | superseded |
  local_match | terminal | unchanged` (`unchanged` from #336). A `task` span runs from the Endpoint to the
  Task's end. The Reaction stays hop 0's.
- A new Misfire signal, **`overrun`**: Escape, "stop" or any new Utterance
  within 3 s of a Jev-read hop firing, counted against that hop's reading.
  "back" within 3 s of a hop counts as today. Overruns per hop number are
  the figure that decides whether a filter in front of the continuation
  ever comes back.
- `pnpm perf:report` prints one Task line: counts by `ended`, hops p50,
  overruns per hop.
- Jev calls per Utterance rise by one per hop. Still cents a day; the
  TypeSafe rate cap remains the limit to watch.
- X hides timelines from logged-out visitors, so the example this was
  grilled on will end on a wall until the pane's profile holds a session.
  That is a site problem the Task surfaces cleanly, not a reading problem.
- The hop reading is written fresh in `src/core/command/`, borrowing the
  result-link rule the Local Match already has; the orchestrator's Result
  Pick (deleted at f4d323b) is not ported.
- The glossary gains **Task** and **Hop**; **Command** no longer says a
  task that needs several steps is several Commands.

## Implementation notes

Increment 1 (#324) built the plain loop on 2026-10-17. Where the issue
left a reading open, the build took these, each a Misfire the next
Command recovers rather than a question asked:

- **A verb-less Utterance's best guess is a DuckDuckGo search.** The Local
  Match settles nothing without a verb; when Jev is unavailable, the words
  are searched. The one exception is a bare word with no dot or space,
  which `open` sends to `https://<word>.com`.
- **"open <label>" clicks the ref that carries the label** when exactly one
  does. Otherwise the Local Match settles an `open` alone only when its
  words are shaped like an address (a bare word, a host, "youtube dot com",
  a URL); words about the page ("open Elon Musk's latest tweet") go to Jev
  with the refs, and are searched only as the best guess. The first AC8
  capture (2026-10-17) showed why: "Open the first result" was searched
  verbatim, with Jev never asked.
- **"the first result" is the Nth result on a search page.** An ordinal
  and a noun ("first result", "second link", "top one") after `open` or
  `click` on a search results page (any engine `parseSearchUrl` reads) is
  the Nth link whose address leaves the engine's host, or the engine's
  redirect to one; the engine's own links (home, settings, ads) are not
  results. Off a search page the ordinal is Jev's. The same capture had
  Jev read "click on the first link" as ref [1], the engine's home logo.
- **Jev's `open` with a ref as its target is a click** when the Slot is not
  address-shaped: the words name an element on the page, and opening it is
  clicking it, the Local Match's own rule for a label one ref carries.
- **A `none` reading records a decision record but no `reaction` span.**
  Nothing fired, so there is no Reaction to measure; the Feed shows the
  words greyed and the `command` event carries `dropped`. It does not
  become the Command the next Misfire signal is read against: a "back"
  after "um, never mind" counts against the Command that fired before it.
- **Superseding reaches the reading, not only the action.** A Command
  still waiting on Jev when a later Command arrives — or when Escape is
  pressed — is abandoned when its answer comes: its decision record is
  written (the reading is data), the Feed shows its words greyed with
  why it was abandoned — `abandoned: stopped` (Escape, the Abort Head,
  `stop`) or `abandoned: a later Command came first` — filed where it was
  given, before the Commands given after it (#330), and nothing fires. Otherwise a slow Jev read would fire
  after, and cancel, the faster Command that came later.
- **The ref flashes after the action lands, never in parallel with it.**
  The flash is a DOM change of the app's own making; started alongside the
  click it could be the first mutation the readiness wait and the Reaction
  observed. It follows the action's result instead, well inside the next
  Command's time.
- **A prepared page is one Command's and lives 30 s.** The page collected
  at speech start goes to the next Command whether it needs the refs or
  not — "scroll down" lets it go — and one older than an Utterance can be
  (the 30 s cap) is discarded for a fresh collect: it belonged to speech
  the VAD let go, and the page may have moved on.
- **`read` closes its Reaction on the Card.** Nothing speaks on this
  branch's increment 1, so the issue's "first TTS sample played" has no
  path; a Page Read's first observable effect is its `display`.
- **A truncated Utterance** (the 30 s cap) is recorded on its decision
  record and never shown as an error.
- **`screenshot`, `help` and `resume` stay grammar-only verbs**: Jev is
  offered the spoken vocabulary without them (`GRAMMAR_ONLY_VERBS`).
- **The post-action wait is readiness, capped at 150 ms**, on an injectable
  clock: a DOM mutation, an input event, a scroll or the document going
  ends it early. A click's own scroll-into-view is none of these: the
  click preparation scrolls instantly and tells the armed watch where it
  moved each scroller to, and the first scroll event that finds its
  scroller still there is ours, so a click closes on what it did to the
  page (#335). What a page does in answer to that scroll (a virtualized
  list swapping rows, a sticky header restyled) is still a mutation and
  still closes it. The landing poll after `ERR_ABORTED` keeps one 100 ms
  clock wait (the `browser-settle` sub-span); everything else is
  readiness-driven (`browser-ready` sub-spans).
- **Jev is pinned to `jev-1.14.0`** in the decision adapter, as decided
  above; one call per unsettled Command, the port's 800 ms timeout, no
  retry.
- **The CLI harness prints what the runner publishes** for its line's
  turn — the action's outcome line, a Page Read, a failure as `error: …`,
  a dropped Utterance as `not a command: …` — and keeps `help` and `quit`
  to itself.
- **`pnpm perf:report`** reads the `decision-*.jsonl` family beside the
  perf log and prints the Reaction p50/p95/max per verb (from `reaction`
  spans, overall row first) and one decisions line: Jev's share of
  Commands and its latency p50/p95, the readings, the Misfires by signal.

- **A Slot may be carried in the page's spelling** (ADR 0077, #325): the
  Name Match reads a spoken search or type Slot against the Page Terms and
  the Learned Terms by sound after the reading, and what was heard stays
  on the decision record. The one amendment to "never composed".

Not built in increment 1: Early Fire, Hot Listen, the persistent Piper.
The Reaction distribution this increment measures is their baseline.
- Moonshine Small stays the default STT tier until increment 1's replay
  of the same utterance dumps gives Small and Base a p95 to compare.

Increment 2 (#326) built Early Fire and the Hot Listen on 2026-10-17.
The readings it took:

- **A bare verb phrase that heads another is held, with no one asked.**
  A partial "scroll" Local-Matches as scroll down, but it heads "scroll
  up": a partial whose words are a whole verb phrase heading a longer one
  of another kind (`headsAnotherVerb`) waits for more words and makes no
  Jev call. "read", which heads "read the page", is the same Command and
  fires. Without this, every "scroll up" would Early Fire as scroll down.
- **The Local Match fires a partial only when it carries no Slot still
  being spoken**: never `open`, a search, `type` or `screenshot`. `press
  <key>`, `click` of a label one ref carries and the Nth result fire.
  Every other partial is one Jev call — the three Choices and the Noul
  "Is this a complete command, with nothing still to be said?" — firing
  when the Noul clears 0.7 and the verb is not `none`. The Name Match
  reads an Early Fired Slot as it reads an Endpoint one.
- **One partial call in flight; the newest partial waits.** A partial
  heard while one is being read replaces any already waiting, and is
  read when the call returns, unless a partial has fired, the Endpoint
  has come or another Utterance has started. A partial identical to the
  last one considered is skipped.
- **An Early Fire is a submission.** It supersedes the Command in flight
  and any reading still under way, like a Command read at the Endpoint;
  its Feed line carries the partial's words. Its turn id is its own,
  minted when it fires: the Endpoint's turn keeps the `stt` span.
- **Its decision record is written at the Endpoint**, with the final
  transcript, `earlyFire: { partial, leadMs, noul? }` and `partialCalls`
  (the Jev calls this Utterance's partials made, fired or not — the
  record of an Utterance read at the Endpoint carries them too). An Early
  Fire whose Utterance never reaches an Endpoint (the Listen closed under
  it) is recorded at the next speech start, without `leadMs`.
- **The Reaction of an Early Fire** keeps its meaning — Endpoint to first
  effect — closed at 0 when the effect came first, written at the
  Endpoint with `earlyFire: true` and `leadMs` in its detail.
- **The Hot Listen is the wake's Listen only**; the hotkey's stays
  single-shot. `hotListenSilenceMs` (default 8 s, 2–60 s, live) of silence
  after the last Endpoint closes it, counted on the session's clock and
  stopped by speech. A dropped or empty Utterance restarts it as an
  Endpoint does.
- **The monitor hears a Hot Listen on the listen's own VAD scores.** The
  wake monitor is fed the same frames once the Listen is hot, with the
  probabilities the listen already scored: Silero carries state, so the
  one instance is never scored twice. The abort head therefore closes a
  Hot Listen — whether or not a Command runs, aborting it when one does.
  A wake inside one stops any speech and lets the monitor's latch go, and
  changes nothing else: no chime, the Listen is not reset.
- **Escape closes a Hot Listen** (from the dashboard and the pane, beside
  aborting the Command); a hotkey Listen is closed by the hotkey.
- **The mic takes no Utterance while a line plays.** Speech that starts
  while the speaking gate reports a line in flight, or that a line starts
  under, is not transcribed — no `begin`, no partials, no speech start,
  no page prepared — and is dropped at its Endpoint. A Hot Listen's
  silence clock waits out the playback and restarts when it ends.
- **`pnpm perf:report`** splits the Reaction table by Early Fire, and
  prints the Early Fire share of spoken Commands, the lead p50/p95, and
  the Jev calls per spoken Utterance (the Endpoint's and the partials').
- **`BINGBONG_STT_SCRIPT` entries may carry `partials`**, emitted one
  every two pushed frames, for the e2e suite.
- **An Utterance let go before its Endpoint takes its partials with it.**
  The voice session tells the runner (`dropPartials`) when a capture under
  way is dropped — a blip, a line starting under it, the Listen closing
  under it (disarm, the abort head, Escape) — so a partial still waiting on
  Jev fires nothing after the user closed the ear.
- **The wake phrase said inside a Hot Listen is dropped** like speech over
  a playing line: it is no Command and costs no Jev call.
- **The one-call guard covers the reading, not the action.** Once a
  partial fires, its action runs outside the guard, so the next
  Utterance's partials are read while a slow navigation lands.
- **A typed line leaves an Early Fire waiting for its Endpoint**: the
  Endpoint still only closes the Utterance.
- **Left as they are:** an early `press <key>` fires before a count is
  said (the spoken reading takes no count today); the monitor hears a Hot
  Listen one STT window late, since its frames queue behind the listen's;
  and an Early Fired `read`, which speaks since increment 3 (#327), mutes
  the rest of its own Utterance, so its record is written at the next
  speech start without `leadMs` and its Reaction is not measured.
Increment 3 (#327) built speech for `read` and for failures on 2026-10-17.
The route and the readings it took:

- **The persistent Piper runs in `--output-dir` mode.** One WAV per stdin
  line, the line delimited by the path piper reports as it finishes: the
  Python piper on the development box (piper1-gpl) logs `Wrote <path>` on
  stderr, the C++ piper prints the bare path on stdout, and either is read.
  `--output-raw` was not taken: the Python piper reports no per-line sample
  count, so its raw stream cannot be cut. On the box, one process answered
  a second line 48 ms after the first, against ~1.2 s for a cold spawn. The
  WAVs land in a temp dir and are removed once read.
- **The process starts at app start**, prefetched like the Moonshine
  models, and exits with the app (its stdin closes). A changed voice
  Setting kills it and starts the new voice's at the next line.
- **A process that dies before any piper has answered a line could not
  start** (no piper, or one without `--output-dir`; a prefetched one that
  died counts, and is not spawned again): every line from then on goes to
  the per-line spawn, with no error surfaced. Once a line has been
  answered, a process that dies crashed: it is restarted at the next line,
  a line it died under is retried once on the new one, and a line the
  retry also dies under fails alone — the next line restarts piper again.
  A line unanswered in 20 s kills the process. The WAVs are removed as
  they are read; the temp dir itself stays.
- **Sentences are cut after the markdown is stripped**: each line of the
  text is a block, a block without a sentence end is a sentence, and a
  sentence ends at `.`, `!`, `?` or `…` before whitespace — not after an
  initial, a dotted abbreviation (`e.g.`) or a short list of common ones.
- **Synthesis runs ahead of playback.** The first sentence goes to the
  player as soon as it is rendered and the next is synthesized at once;
  every sentence's samples are written into one `aplay -t raw` reading the
  voice's format, so playback never waits once it starts unless piper is
  slower than speech. A stop discards the sentence being rendered, and the
  ones after it are never sent to piper. A sentence in another format (the
  voice changed mid-text) plays through a second aplay once the first has
  drained.
- **What `read` speaks is the Page Read's text**, after its `page text:`
  heading and before its part line — never the head, the refs or the
  reports. A read with no text speaks "This page shows no text." The Card
  is shown first, as in increment 1, and holds part 1; the Feed hides the
  `speak` entry of a turn whose Card rendered.
- **"Until the end" reads on through the parts.** A page longer than one
  part (12,000 characters) speaks part 1, then reads part 2 once part 1
  has been spoken to its end, and so on; each further part is its own
  `speak` event. A part cut short ends the reading: the speaker's outcome
  now says `stopped`, so a wake-word barge-in, which stops the speaker
  without the runner, also ends it.
- **A spoken `read` stays the Command in flight until its text ends**, with
  status `speaking`: the Abort Head (gated on the run state) and the next
  Command reach it, and either stops the speaker, which kills the stream.
  The voice is one queue, so a stop also cuts a download announcement.
  The speaking gate's `inFlight()` answers true from a text's first
  sentence to its last; #326's Hot Listen is what will read it.
- **The Reaction of a spoken `read` closes on `effect: 'spoken'`**, when the
  first sample is written to aplay's stdin — the "handed to the player" of
  the issue; aplay's own device open comes after, so this and
  `tts-first-sound` read low by aplay's start-up — and a page mutation
  during the read does not close it. When nothing was spoken — the voice failed, or
  was cut first — it closes on `display` at the moment the Card was shown.
- **A failure's line is not waited on.** The turn ends `failed` (or `done`
  for a landing) at once and the line plays after; the runner counts it as
  its own speech, so the run state stays `running` while it sounds, and
  the Abort Head or the next Command silences it. Its Reaction stays the
  action's.
- **The failure table** (`src/core/command/spokenFailure.ts`): an action
  that threw; a Blocked Action (its target Covered or Not Shown); a consent
  wall, a Blocked Action whose outcome carries a dismissal that left the
  target covered or was not retried; a Blocker (challenge, network block,
  login wall); a Not-found, Unavailable or Empty Landing. The page classes
  read the landing line's address and title (the tab's for a click that
  arrived) with no response status, which this branch does not collect, so
  a not-found or unavailable page is recognised by its title. An inert
  click stays silent: it is no Blocked Action.
- **`tts-synthesis` carries `{ index, spawns }`**: the sentence's index and
  the synthesizer processes started so far, the per-line process count
  AC7 asks for. `tts-first-sound` runs from the speak call, queue wait
  included, to the first sample written. `pnpm perf:report` prints a spoken
  read as `read (spoken)` beside `read`, and `tts-first-sound` as a row
  under the Reaction table.
- **Every hermetic e2e launch speaks through the scripted piper and aplay**
  in `e2e/bin` (`BINGBONG_PIPER_BIN`, and `BINGBONG_APLAY_BIN`, new), so no
  e2e run loads a voice or reaches the sound card; `e2e/tts.e2e.test.ts`
  reads what they were given.

Increment 4 (#328) built the Task and the DOM-quiet landing on 2026-10-18.
The readings it took:

- **A hop is one reading.** Each hop mints its own turn id and publishes
  its own `command` event, and writes its own decision record. The Task's
  id is hop 0's turn id. A reading that fires nothing is a hop too: a
  `done`, a dead-end `none`, a read Jev did not answer, and a read
  superseded in flight. So the issue's example, a search, a result, a ref
  on the landing and then `done`, writes four records. AC1 counted three,
  the actions; AC3 and AC5 number a reading that fires nothing as its own
  hop, and the build follows them.
- **A record is written once nothing can change it.** A hop that ends the
  Task on a verb that leaves no page (read, stop, clear, none, done) is
  recorded before it fires, as before. A hop whose verb lands is recorded
  once its action settles, carrying `landing` and, when the Task ends
  there, `ended`. That includes a Local-Matched `open`.
- **`ended` readings:** a best guess at hop 0, and a Task with no Decision
  Model configured, end `unavailable`; `none` at hop 0 ends `terminal`
  (`none` is `none` only past hop 0); an action that throws ends `wall`
  beside the Action Outcome classes, since it speaks its failure line as
  a wall does. The cap counts actions that fired, scrolls included: the
  fifth ends the Task `cap` once it lands, unless it met a wall.
- **The Feed's hop lines:** a hop that fires nothing is published
  `dropped`, its action naming what it came to: `already here` (`done` at
  hop 0), `done`, `no next step`, `not read` (Jev unavailable), or
  `abandoned: stopped` / `abandoned: a later Command came first`
  (superseded, #330). Only hop 0 has a `reaction` span. The `task`
  span sits on hop 0's turn, carrying `{ ended, hops, actions, source }`.
- **Result links are offered as `link-N` targets**, after the refs and
  only on a search landing (`parseSearchUrl`). They come from the whole
  page's links (`pageLinks`), filtered by the Local Match's own result
  rule (`resultLinksOf`). A link is never offered twice, nor when a ref in
  view already carries its address. A `link-N` has no ref to click, so a
  `click` or `open` of one opens its address.
- **A hop past hop 0 never searches the words again (#332).** Hop 0 has
  acted on the transcript, so an `open` whose Slot is words, not an
  address, opens the offered target to which Jev's target answer gives
  the most probability, `none` set aside: a ref is clicked, a `link-N`
  opened at its address. With no offered target in the answer, the hop
  is `none` (`no next step`). An address-shaped Slot still navigates.
  Since #342 this fallback fires only on a search landing; off one the
  hop is `none` (the 2026-10-19 #342 amendment below).
  One exception since #341: on a site the Task has not searched, a hop
  asks `where`, and `open` + `where` = `site` searches that site once
  (the 2026-10-18 #341 amendment below); `page`, `web` and a site
  already searched keep this rule.
  There is no probability floor: a wrong pick costs a `back`. Seen
  2026-10-18: "Open elon musk's latest tweet" read `open` + the words +
  target `none` on all five hops and ran the same DuckDuckGo search five
  times to `cap`, with the x.com result at 0.17 on hop 1.
- **What counts as visited:** the page the Task started on (never
  `about:blank`) and each hop's landing. Two addresses are the same page
  when they agree after the engine's redirect is followed to its target
  (`uddg`, `url`) and the fragment, a trailing slash, `www.` and the
  host's case are set aside (`pageAddressOf`). A visited ref or link is
  absent from the hop's targets. The state Jev reads adds two lines: "This
  is step N of the task. Done so far: …" and "Pages visited: …".
- **Each hop collects the landing afresh**; the page prepared at speech
  start stays hop 0's.
- **An overrun counts against the last Jev-read hop that fired**, at any
  hop number, verb or Task state. That includes an Escape a second after
  the Task's `done`: the Task did more than the user wanted. Each hop
  counts at most once, and a Command read otherwise lets it go. It is
  checked at a new Command (spoken or typed), at an Early Fire, and at an
  abort (Escape, a "stop" heard while running, the Abort Head). An
  abort's record carries no `signalTurnId`; every overrun carries `hop`,
  so the report keeps hop 0 apart.
- **Hops past hop 0 raise no back, clear, escape or opposite-scroll
  Misfire against the hop before.** They are the Task's own steps, not
  the user's recovery. The user's next Command is read against the last
  hop that fired, as before.
- **Early Fire:** the Endpoint of an Utterance whose hop 0 fired on a
  partial waits for that action to land, then goes on with the final
  transcript. An Utterance that never reaches its Endpoint is recorded
  at the next speech start. It ends `superseded` when Jev read a hop
  that would have gone on, and otherwise as its reading ends.
- **A Task holds the Hot Listen's clock, and its end restarts it.** The
  runner's `run` resolves when the Task ends. The voice session keeps the
  clock stopped while any submitted Task is under way, as it does through
  playback, and starts it at the Task's end, unless an Utterance is being
  captured. So a Task longer than `hotListenSilenceMs` never closes the
  Listen under it. The runner's waits are all bounded, so a Task always
  ends.
- **The landing wait lives in the pane's navigation surface**
  (`paneNavigation.ts`), on its injectable clock, beside the commit and
  stop watchers it builds on. The quiet window runs in the page over CDP
  (`Runtime.evaluate` of `domQuietScript`), because Electron's
  `executeJavaScript` waits for the very load it replaces. The constants,
  `LANDING_QUIET_MS` and `LANDING_CAP_MS`, sit beside `READINESS_CAP_MS`.
  AC10's "controller's unit tests on a fake clock" are that surface's
  tests; `e2e/landing.e2e.test.ts` covers the real page.
- **`did-stop-loading` ends a landing as the load event does.** A navigate
  resolves at its landing. A history step and a reload resolve at their
  commit, and the controller's arrival watch that follows is the
  landing. A click's arrival waits up to the 10 s bound for a commit,
  then lands; the cap counts from the commit, so the action's own
  readiness wait is not counted twice. A `capped` landing rides the
  outcome line as an Unfinished Load and reaches the runner through
  `ActionEffects.landed`. An `ERR_ABORTED` after the commit is the site
  moving the tab on, and the landing goes on; before the commit it keeps
  the settle poll it had.
- **`reload`:** the CLI grammar's `reload`, and spoken "reload",
  "refresh", "reload the page" or "refresh the page". It lands like a
  history step, its line opening `reloaded:`, and its landing is read
  for walls as a navigate's is.
- **`resume` (2026-10-18, the Last Page):** the CLI grammar's `resume`, and
  spoken "resume", "continue", "where was I", "last page" or "pick up where
  I left off". The Idle Screen names the Last Page — the page the pane last
  showed, persisted in userData's `last-page.json` across restarts — and
  this is the way back to it. The runner decides once, before the
  `tool_call`: a pane still on a real page (the Idle Screen only ever hid
  it) performs nothing and its line opens `resumed:`; a pane that boots
  blank after a restart navigates to the Last Page, and the Feed names that
  tool `navigate` with the address, so its landing is read for walls as any
  navigate's is. A tap on the Idle Screen's card submits the same `resume`
  line. It is a Local Match, so it ends its Task at once, and it is never
  offered to Jev: it reads nothing off the page.
- **The CLI harness prints every hop of its line's Task**, following the
  turns whose `command` event names the line's turn as `task.id`; a hop
  that fired nothing prints `<what it came to>: "<words>"`.
- **`pnpm perf:report`** prints one Task line under the decisions:
  `tasks: N | ended <how> <count>, … | hops p50 P, max M | overruns by
  hop: hop H <count>, …`. A Task is the decision records sharing an id,
  and its hops are its highest hop plus one.
- **Left as they are:** AC13's capture, deferred under the standing
  ruling; a Task's hops are read with no Early Fire of their own; and a
  hop's typed Slot comes only from the transcript, so a task that needs
  unsaid words ends at `none`.
- **A page still loading (#330).** Chromium holds every page evaluation
  until a navigation under way commits, then runs it on a document not yet
  parsed; so the controller waits for that navigation's Landing (or the tab
  stopping) before it evaluates anything, and a navigation that never
  commits fails with that reason. Stop — Escape, the Stop button, the
  Abort Head, `stop` — ends the pane's load too (only while it is loading),
  and custody lets it through while an abandoned action withholds the page.
  An in-flight Command a later one supersedes keeps its entry and its
  `cancelled` stage; it carries no reason of its own.

## Amendment: a Task copes with an unmoved or covered page, and is one Feed Entry (2026-10-18, #336)

Grilled on 2026-10-18 from two live sessions. In "Open Elon Musk's latest
tweet", hops 2–4 clicked X's pinned post three times (ref 21, 20, 20) under
the logged-out sheet. Each click came back "no observable change", which
counted as landed, so the same target was offered again until `cap`, and
the Feed showed six bubbles repeating the words. In "Exit out of this",
said of the login pop-up, Jev read `back` and the tab left x.com for the
blank start page Resume had opened it from. The snapshot knew a dialog was
open, but `CommandPage` dropped it, and nothing dismissed a dialog that was
not a consent wall.

### Decision

- **A hop that changed nothing sets its target aside.** It made no
  landing, and the click's own outcome is "no observable change" (an
  inert click, `blockedOrInertAction`). Its target is never offered again
  in that Task. It is matched by label and address (the link's own, or
  the page's for a control that has none), never by ref number, since
  refs renumber between hops. This replaces "there is no
  retry-with-exclusion".
- **Two hops in a row that change nothing end the Task**, with the new
  end reason `unchanged` on the last hop's record.
- **"Done so far" carries each action's result**, with the target named
  by its label: `click "Pinned Elon Musk…" (nothing changed)`, `open
  latest elon musk tweet (opened duckduckgo.com/?q=…)`, or `(the page
  changed)` when the page moved but the tab stayed on the same address.
- **No click special case.** Continuation still follows the reading; the
  results line is what brings "click on this tweet" to `done` on hop 1.
- **`CommandPage` carries the dialog**: its text and the refs in its
  layer, absent when none is open. When one is open, Jev's state gains
  `A dialog is open: "<its text>"`.
- **The dismiss rule is decided before Jev and settled like the Local
  Match.** With a dialog open, a dismiss phrase (exit, close, dismiss, get
  rid of, go away, cancel, x, no thanks; alone or with "this", "that",
  "it", "out of this", "the pop-up", "the popup" or "the dialog") clicks
  the dialog-layer control labelled close, ×, ✕, dismiss, not now, cancel
  or no thanks. It never clicks a link, so it never navigates, and with no
  such control it presses Escape. The Answer is "Closed the pop-up.". If
  the dialog is still open afterwards, the failure line is "The pop-up is
  still open.". With no dialog open, the same words read exactly as
  before ("cancel" is still `stop`).
- **`back` never leaves a real page for the blank start page.** When the
  history entry before is not a real page (the one the Idle Screen or
  `resume` opened from), the step is refused, the tab stays put, and the
  Answer is "There's no page to go back to.". A step back with no history
  says the same.
- **No verb/target override.** A target-free verb still ignores the
  target answer.
- **A Task is one Feed Entry.** Its words appear once. Hop 0's action is
  the first line, and each later hop that fired adds one line beneath it.
  Every hop's tool lines and stages fold into one Run Detail, keyed by
  the Task's id. The Task has one Answer, the latest hop's, which replaces
  the one before. A closing hop past 0 that fires nothing (`done`, `no
  next step`, `not read`) adds nothing. An abandoned one adds a greyed
  last line. A hop that met a wall is the last line, in the failure
  colour, and its failure line is the Answer. Hop 0's `already here`
  keeps its greyed bubble, and a one-hop Command looks as it did.
- **The Peek Card keeps the last hop that fired.** Only the reported
  run's own `done` moves the card, and a hop past 0 that fires nothing
  never takes the card. That holds whichever Task the hop belongs to, so
  an older Task's hop abandoned after a later Command's words leaves that
  Command's card alone.

### Not in scope

"Pinned" is not "latest", and no label rule says so. Jev misreads go
through the replay corpus (#338).

### Implementation notes

- The set-aside list and the unchanged run live on the runner's `Task`.
  The offered refs filter them in `jevReading.ts` (`offered`, through
  `HopContext.setAside`), so the targets offered and the reading's
  fallbacks agree. `doneLine` writes each "Done so far" entry. A hop's
  `FireResult` carries `unchanged`, set only when no landing came.
- `commandPageOf` (core/command/command.ts) builds the page off a
  snapshot, dialog included. `dismissDialog.ts` holds the phrase grammar
  and the close-control rule. The runner checks a dismiss phrase before
  the page-free Local Match shortcut (`readDismissal`), so a phrase
  collects the page even when no dialog turns out to be open. The one
  exception is a phrase the Local Match reads as `stop` ("cancel"): a
  `stop` never waits on a page collect, since it is what ends a page
  still loading (#330). It closes a dialog only when the page collected at
  speech start has already arrived, and otherwise stops at once. An Early
  Fire's partial reads the same rule. Whether the dialog closed is read
  off a fresh collect. A close control drawn as a link is never clicked,
  and the dialog then takes Escape.
- The back guard is in `paneNavigation.goBack`, reading
  `navigationHistory.getActiveIndex`/`getEntryAtIndex`. The Toolbar's own
  back button is untouched. `failureLineOf('back', …)` tells any
  "cannot go back" refusal as "There's no page to go back to.".
- The Feed projection maps each hop's turn to its Task. A `command` past
  hop 0 folds into the Task's entry as `hopLines`, and `tool_call` and
  stage lines take the Task's id as their `runId`. Entries keep their own
  turn's `turnId`, so the Peek Card still reads one turn's Answer.
- `e2e/collectPageScript.chrome.test.ts` serves an X-like modal sheet.
  Its controls arrive in the dialog layer, and "exit out of this" reads
  its close control. In a real Chrome the close button's label is
  "Close ✕" (aria-label plus text), which the normalized label match
  takes.


## Amendment 2026-10-18 — what Jev was asked is recorded and replayable (#338)

- **Every Jev call writes its whole ask** (the state text and the questions
  with their options) to `asks-*.jsonl` beside the decision log, once the
  answer is in, so the write never costs the round: hop 0 (`command`), a
  later hop (`hop`), an Early Fire partial (`partial`). A hop's ask id is its
  turn id; a partial is asked before its turn exists, so its id is its own.
  Each decision record names its ask (`ask`), and the Utterance's partial
  asks (`partialAsks`), whether one fired or not, so the decision log stays
  small and no ask is out of reach.
- **The Jev corpus** (`fixtures/jev-cases/`) holds recorded asks with the
  answer each question should get, a label (`target=ref-27`) or an exclusion
  (`target!=ref-21`). `pnpm jev:candidates` lists the asks a misfire or
  overrun pointed at; `pnpm jev:case` promotes one; `pnpm jev:replay` asks
  the real Jev every case again and exits non-zero on any failure (it needs
  the key and is not part of `pnpm test`). Nothing is committed to the corpus
  automatically: asks carry page text from real browsing.
- **A misread is fixed by wording, checked against the whole corpus**, never
  by a rule for the one case (the owner rejected a "Pinned is not latest"
  label rule). A change to the state text or question wording is accepted
  only when it passes its own case and no other case gets worse.

## Amendment 2026-10-18 — an `open` spoken on a site is looked for on that site (#340)

On x.com, "go to donald trumps profile" read as `open` with the Slot
"donald trumps profile": no address, no ref, so hop 0 searched the whole web
and the later hops picked among Wikipedia, Truth Social, Instagram and X.
The page the words were spoken on is the context the earlier Command left
behind, and nothing read it.

- **The reading stays one Jev call read as a tree.** Its layers are asked in
  parallel and read together; the tree lacked one node, "on this site but not
  on this page". A sequential tree (ask `where`, then the rest) was rejected:
  answered calls run p50 218 ms, p90 292 ms in the decision logs, and a second
  round doubles that for every Command.
- **The `where` Choice** — `page` (a ref), `site` (a page, a person, a post,
  a section of it), `web` (another website, or the whole web) — is asked
  beside the verb, the target and the Slot at hop 0 only, and only when the
  Utterance was spoken on a site: a real `http(s)` page whose host has a dot
  and that is no Web Engine's web search — its front page or results, on its
  own host; its maps, finance or docs pages are a site (`src/core/command/siteScope.ts`,
  which keeps the glossary's engine list since the orchestrator's copy left
  the branch). It
  was not asked at a later hop, which never searched (#332), until #341
  (below): a later hop asks it on a site the Task has not searched. An Early Fire
  partial is a hop-0 reading and asks it too. The question set is a union —
  three, or three and `where` — never an optional key, so it stays the port's
  `DecisionQuestions` record.
- **The reading.** `open` + a ref chosen is a click, as before; `open` +
  search-term Slot + no ref + `where` = `site` is a Command with a Site Scope
  (`site: 'x.com'`, `search: true`), the Slot kept as the user's words;
  `page`, `web` or no `where` reads as before. A Local-Matched `open` (an
  address, "search for …", "look up …", "google …") and the best guess are
  never scoped: the words, or the lack of a reading, say web.
- **A Site Scope is a DuckDuckGo `site:<host>` search**, not the site's own
  search box: one navigation, the same hop-1 picking among results as any
  search, no per-site knowledge (owner's choice). The site is the host
  without `www.`, not the registrable domain.
- **A wrong `where` is a Misfire** like any other reading: no confidence
  bar, no word list, recovered by the next Command and counted. A misread
  `where` is promoted as a Jev case (#338), never answered with a rule.
- **Surfaces.** The Feed's action line names the site (`open donald trumps
  profile on x.com`); the Answer is `Searched x.com for “donald trumps
  profile”.`; the decision record's Jev detail carries `where`'s confidence
  and probabilities beside the other three, and omits them when it was not
  asked; the ask sidecar carries the fourth question as it does the others.
- **Not in scope**: a later hop searching the site (#341); the site's own
  search form; scoping a `type` Slot.

## Amendment 2026-10-18 — a site and a thing on it in one Utterance (#341)

"Go to twitter and open donald trumps profile" could not be one Utterance.
The words past "go to" are not an address whole, so hop 0 went to Jev; and
even once twitter.com had landed, a later hop's `open` never searched
(#332), so the profile could only be found among the landing's own refs.

- **A later hop may search once, on a new site.** At hop 1 and after,
  `where` is asked when the hop's page is a site (as #340 has it) that the
  Task has not searched. An `open` + search-term Slot + no ref + `where` =
  `site` is a Site Scope search of that site, performed as hop 0's is. On a
  Web Engine's page, on a site the Task has searched, and for `where` =
  `page` or `web`, #332 stands: the most probable offered target is opened
  (since #342, only on a search landing) and the words are never searched
  again. The Task records the sites it
  has searched (`searched`, carried to each hop's reading), hop 0's scoped
  search among them, so a second search of the same site in one Task is
  never offered; a different site it lands on may still be searched once.
- **An address with words past it goes on.** The Local Match reads an
  `open` whose words start with an address followed by a joiner ("and",
  "then", "and then") and another of its own verb phrases as the address
  alone: "go to twitter and open donald trumps profile" opens twitter.com,
  "open youtube and search for lofi" youtube.com. Such a Local-Matched
  `open` goes on to hop 1 instead of ending `local_match`; the address
  alone ("go to twitter") still ends the Task. The hop reads the whole
  transcript on the landing, as every hop does. The second clause is not
  parsed: the joiner and verb phrase only mark where the address ends.
  The guard exists because a bare word is address-shaped — "open the
  menu" and "open settings menu" would otherwise open the.com and
  settings.com — and anything it lets through goes to Jev as before, whose
  hop 0 goes on anyway; it costs speed, never the Task. For the same
  reason a span that shares a word with a ref's label on the page is the
  page's word, not an address ("open settings and click save" beside an
  Account settings link goes to Jev). An Early Fire never
  fires an `open` on the Local Match, so only the Endpoint reads this.
- **The guards stay**: the five-action cap counts the search as an action;
  the set-aside rule and the two-unchanged-hops rule apply unchanged.
- **Not in scope**: two unrelated Commands in one Utterance ("scroll down
  and read"); a route table; remembering earlier Utterances.

## Amendment 2026-10-19 — off a search landing, a hop with no target named ends the Task (#342)

#332's fallback made a Task overrun the page the user asked for. In two
live runs on 9167c0a (real Jev, logged out) the Task reached
x.com/realDonaldTrump, and the next hop read `open` over `done`
(0.77/0.22 and 0.60/0.35) with target `none` at 0.99 and 0.97. The
fallback then clicked "DonaldJTrump.com" (p 0.01) and "Search" (p 0.02),
and both Tasks ended on a wall.

- **The fallback fires only on a search landing.** That is a page that
  `parseSearchUrl` reads as a search, the same test `resultLinksOf` uses
  to offer result links. It includes a site's own search page
  (`x.com/search?q=…`). There, Jev often tops `none` over the right
  result (none 0.63, the result 0.17), and opening the best result is
  still right.
- **Off one, the Task ends where it stands.** At a hop past 0, an `open`
  with search-term words and no target named (top target `none`, or a
  label that resolves to nothing offered) is `none`: a dead end, "no next
  step" in the Feed. It is not `done`, because Jev did not say `done`.
- **A named target is unchanged.** A ref that Jev gives as its top target
  is clicked on any page, as before. A result link is opened as before; it
  is offered only on a search landing, so off one there is none to name. So is the
  Site Scope search of #341, and so is an address-shaped Slot.
- **Still no probability floor.** A bar tuned to these two cases (0.17
  against 0.01–0.02) would contradict "the top Choice acts at any
  confidence". The page decides, not a number.
- **Not in scope:** promoting the two profile asks to the Jev corpus as
  `verb=done` cases (the owner's call); rewording the questions so Jev
  says `done`; a search landing read before its results render.

## Amendment 2026-10-19 — music is YouTube in the pane, the Queue and the verbs in main (#343)

The owner listens to unreleased songs on YouTube and asked for voice
control: "play …", "loop", "skip", "play from the beginning". The
consultation on 2026-10-19 settled the shape, and the owner ruled "all
recommended" on its five decisions.

- **The player is YouTube's watch page in the pane.** A Player in main
  owns the one Queue and drives `#movie_player`'s `<video>` with one CDP
  evaluate per verb (play, pause, `loop`, `currentTime`, volume, muted).
  YouTube's own queue, its Autoplay toggle and its Loop menu are never
  touched. Rejected:
  - The IFrame embed: unreleased uploads are the ones that disable
    embedding.
  - Audio extraction (yt-dlp style): it breaks monthly and needs cookies.
  - Clicking YouTube's chrome: the controls are revealed on hover, and
    each verb would cost a read and a click.

  The pane already has the adblocker (uBlock's hourly quick-fixes list
  among its lists) and the consent handling every navigation gets.
- **A music line is one Command like any other.** It is Local-Matched,
  fires with no confirmation, and leaves one `command` event, one Answer
  and one decision record (verb `play`, and the `video` it opened or
  queued). The search pick is the first plain video, with no Jev call. A
  wrong pick is a Misfire that the next line recovers, never prevented.
  Correction lines and remembered picks are #345.
- **Ruling 1: `play` is a Player verb, grammar-only like `timer`.** Jev is
  never offered it. No partial fires it, and none is asked of Jev. "click
  play" and "press play" stay the page's button. A partial that heads a
  music line of another kind waits for its Endpoint: "go back" may be "go
  back a song", "stop" may be "stop looping". A partial "stop" still fires
  at once while something is in flight, because it is only an abort then.
- **Ruling 2: `stop` with nothing in flight pauses what plays,** as it
  silences a ringing Timer: every playing media element in the page's
  top frame (#376; at first YouTube's player alone), and in every
  Reachable Frame since ADR 0081 (#377). With a Command in
  flight, being read or sounding, `stop` stays the abort and the media
  plays on.
- **Ruling 3: `back` and `resume` are untouched.** Music goes back with
  `previous` ("last song", "go back a song") and on with a bare `play`.
- **Ruling 4: with an empty Queue the song ends and the Player stops.**
  YouTube's Autoplay never runs: it wanders into reaction videos. Holding
  the `ended` event from YouTube's handlers was not enough. Live, at a
  song's real end, YouTube loaded an ad into the element and then
  Autoplayed another video either way, because its player state moves on,
  not the element. So a capture-phase `timeupdate` listener pauses a song
  that is not looping in its last second, through the player's own
  `pauseVideo()` and the element's `pause()`, and notes that as the song's
  end. A capture-phase `ended` listener remains as the fallback. An end while
  `#movie_player` carries `ad-showing` is the ad's: it passes through and
  advances nothing.
- **Ruling 5: three tickets.** #343 is the Player, its verbs and the
  Queue. #344 is the Now Playing card, keepsIdle and ear ducking. #345 is
  "not that one" and remembering songs.

### Implementation notes (#343)

- `core/music/`: `musicWords` (the lines, read by `parseCliCommand` before
  its verbs), `queue` (pure state), `youtubeSearch` (the pick off
  `ytInitialData`, the addresses). `main/music/`: `player`, its page
  scripts, and `attachPlayer` (the 1 s poll, and results fetched with
  `pane.session.fetch`). The browser port gains `evaluate`.
- `play <words>` navigates to the results and reads `window.ytInitialData`
  rather than the rendered cards. It is there at the landing, and it names
  each item by its renderer. `queue <words>` fetches the same page with
  the pane's session and parses the same data, so the song playing is
  never navigated away from. A song queued with nothing playing plays at
  once.
- A landing counts only as the requested watch page with its player's
  video, showing no `.ytp-error`. Anything else is a failed Command
  ("“…” can't be played.") and opens the next queued song in the
  background.
- AC6 ran live on 2026-10-19 (`BINGBONG_YOUTUBE_E2E=1`,
  `e2e/music.e2e.test.ts`, muted). `play` took 4.5–5.6 s from line to
  video playing, including both page loads. The suite also checks that a
  song's end opens the queued one, and that with nothing queued it stays
  paused at the end, with no ad and no other video, 12 s on.
- The control script acts on `#movie_player`'s video alone. A `skip`
  never pauses another site's video. A `stop` with nothing in flight
  pauses every playing top-frame media element since #376, and every
  Reachable Frame's since ADR 0081 (#377).

## Amendment 2026-10-19 — verbs are actions, not words: `open` is gone, the Local Match keeps fixed phrases, nothing guesses (#353)

On x.com/ElonMusk, "Open the tweet." went to DuckDuckGo. The Local Match
passed it (no address, no ref labelled "the tweet"). Jev answered verb
`open` 0.76, target `none` 0.67 over the top post at 0.17, and `where` =
`page` 0.64 — "it is on this page" — and the reading's `open` fall-through
searched the web for "the tweet" anyway, then hop 1 opened the X account
named "@tweet". The verb word carried no information and let Jev echo it:
the transcript said "Open", so Jev chose the option called `open`, whose
definition ("go to a website or address, or search the web for the words")
then forced a search against Jev's own `where` answer. In the logs, 59 of
146 Commands were Local-Matched, nearly all control words, Music, Timer
and addresses; Jev's median latency was 218 ms.

- **A verb is an action the browser can take, never a word the user
  said.** `open` leaves the Command verbs and Jev's verb Choice. In its
  place: `navigate` (an address — a site's name, a host, a url) and
  `search` (words, on the web or scoped to the site by `where`); the
  `search` flag and `open`'s dual reading are gone, and `site` belongs to
  `search`. The transcript is just words; Jev decides whether "open the
  tweet" is a click, a search or a navigation, with nothing to echo. The
  call is unchanged: one parallel call, verb, target, Slot and `where`.
- **Words that point at this page are never searched.** A `search`, or a
  `navigate` whose Slot is no address, with no ref named and `where` =
  `page` opens at hop 0 the most probable ref Jev gave any probability,
  `none` set aside (#332's rule), and is no Command when it gave none any.
  `where` = `site` is the Site Scope search as before; `web` or no `where`
  searches the web at hop 0; later hops keep #332 and #342 as they are. A
  bare word Jev reads as a `navigate` is an address whatever `where` says:
  Jev said so.
- **The Local Match keeps fixed phrases only.** The CLI grammar; the
  control words; the Timer's and the Player's lines; the dismiss phrases;
  the `open`/`go to`/`visit` family for an address-shaped Slot, or an
  address with words past it (#341); and the exact-label click and type,
  which never guess. The search phrases ("search for", "look up", "google",
  "find") leave it: search terms always go to Jev, whose `where` scopes
  them — one call (~220 ms) per search line, accepted. They stay in the
  list of clause heads #341 uses to find where an address ends, so "open
  youtube and search for lofi" still opens youtube.
- **The lenient best guess is gone.** No ref by shared words, no first
  text field, no words-with-no-verb-as-a-search. When Jev is unavailable or
  does not answer, what fires is the Local Match — which already settled
  nothing, or Jev would not have been asked — so the line is no Command:
  one greyed Feed Entry, `ended: unavailable` on its record. A Misfire that
  leaves the site is costlier than a Command that does nothing. The
  `best_guess` reading kind stays on the record to name a Jev that could
  not be asked.
- **Surfaces.** The Feed's action line reads `open youtube` for a
  `navigate` and `search donald trumps profile on x.com` for a scoped
  `search`; the Answers are unchanged ("Opened YouTube.", "Searched x.com
  for …"). The help text drops `search for <words>` as a grammar line. The
  CLI grammar's `navigate <input>` is a `navigate` of an address and a
  `search` of anything else. The corpus case's recorded questions still
  carry `open`; the replay sends them unchanged, and its expectations
  (target, `where`) do not name the verb.
- **Not in scope:** tagging posts so the Local Match can see "the tweet"
  or "the post" without Jev; a Jev case for the logged turn (the owner's
  call); the typed grammar gaining a `search` line.

## Amendment 2026-10-19 — a Task steps aside from the pop-up in its way, once per Obstacle (#354)

"Open Elon Musk's latest tweet" (2026-10-19, decision-1792444477389)
searched, opened the profile and clicked the top post; logged-out X raised
its "Don't miss what's happening" sheet instead of the post, and hop 3's
Verdict read `in_the_way` 0.93. The Task ended `wall` with "A pop-up is in
the way." over a sheet whose `Close` button was ref 1. Jev's own next
step on that hop was the same post again, under the sheet: left to the
reading, the Task would loop as the #336 grill saw it loop.

- **Step Aside.** A hop whose Verdict is a sure `in_the_way` over an open
  dialog does not end: the runner fires the #336 dismissal as that hop —
  the dialog-layer close control, never a link, else Escape — and the
  Task goes on from the page it leaves. No Jev call decides to close; Jev
  was asked once, read the wall, and the runner steps past it. The hop's
  record keeps Jev's reading (`jev`, `ask`) with the dismissal's verb and
  target and `stepAside: true`; the Feed line is the dismissal's (`click
  [1] "Close"`); "Done so far" tells the next hop `click "Close" (the
  pop-up closed)`.
- **Once per Obstacle.** An Obstacle is a dialog known by its text and
  the labels of its controls, however its refs are numbered. The Task
  notes each it steps past; the same one raised again is the wall, ended
  as before with "A pop-up is in the way.". A cookie bar and a sign-in
  sheet are two Obstacles, each passed once.
- **The door is set aside.** When the action before raised the pop-up
  over a clear page ("the address did not change; a pop-up appeared"),
  its target joins the #336 set-aside list as the Task steps past, so
  the next reading is not offered it by ref or by result link.
- **The close must work.** A dialog still open after the dismissal is a
  wall: "The pop-up is still open." (#336's line), `ended: wall`.
- **Close only, never through.** No sign-in, sign-up or accept control is
  ever clicked, and a close control drawn as a link is never clicked.
  Consent walls are the controller's to dismiss, reject first, as before.
- **Every other guard stands.** The dismissal counts toward the five
  actions; two inert hops still end `unchanged`; a later Utterance,
  Escape or the Abort Head still supersedes; a sure `in_the_way` with no
  dialog open still ends `wall` with "Something on the page is in the
  way."; Blockers, not-found, unavailable and empty landings are walls as
  before.
- **What it buys on logged-out X** is one more hop: after the close the
  profile shows with the post set aside. A hop that takes the post's
  timestamp link (its status address) may reach it; one that clicks
  another post raises the sheet again and ends a hop later than today.
  X stays partly walled until the pane holds a session.

## Amendment 2026-10-19 — the Step Aside walks a Dismissal Ladder, Jev choosing the rung (#354 follow-up)

"Open Donald Trump's truth social profile" (2026-10-19,
decision-1792446164303) landed on the profile under Truth Social's TCF
cookie sheet, which drew after the landing had settled. Hop 2's Verdict
read `in_the_way` 1.0; the Step Aside pressed Escape, because its close
control was labelled "Close this consent banner Close this consent banner"
and the dismissal matched a close only by a whole label of close, dismiss,
not now, cancel or no thanks. The sheet ignores Escape; the Task ended
`wall` with "The pop-up is still open." — over a dialog whose Reject
Non-Essential and Close buttons were both on the page. The owner's ruling:
always cast the widest net for Jev to pick the best option; no more edge
cases from hand lists.

- **The dismiss Choice.** A hop read over an open dialog asks Jev one
  question more, in the same call as the verb and the Verdict: which
  control closes the pop-up and leaves the page as it was. Every control
  of the dialog's layer a dismissal may click is offered — a button that
  is no link, no field and no way through (sign in, sign up, subscribe,
  accept, agree, allow, install…) — beside `escape`. The record keeps
  the answer (`jev.confidence.dismiss`, `jev.probabilities.dismiss`).
- **The Dismissal Ladder.** The Step Aside no longer fires one dismissal:
  it fires the rungs of a ladder in turn until the dialog closes. The
  rungs, best first, each once: the consent policy's control (reject
  first, accept second — the controller's own Tier-1 rule, ADR 0061, now
  judged in core over the dialog's labels); Jev's choice when sure; a
  control whose label *begins* as a close does (close, dismiss, cancel,
  skip, not now, maybe later, no thanks, not interested, continue
  without, got it, ok, ×…), wherever the label goes on from there; Jev's
  choice when unsure; Escape. A rung that leaves the dialog open is an
  action taken ("Done so far" says `click "Close" (nothing changed)`),
  nothing is said of it, and the next fires. The dismiss phrase (#336)
  fires the first rung.
- **The close must still work, and the guards hold.** A dialog still
  open after the last rung is the wall as before: "The pop-up is still
  open.", `ended: wall`, said once. Each rung counts toward the five
  actions, so the ladder stops where the cap would; once per Obstacle
  stands (the ladder is one Step Aside); no link, field or way-through
  control is ever a rung, whoever chose it.
- **A consent wall is cleared where the page is read.** The controller's
  `collectPage` — what every hop and every Command is read against —
  dismisses a Tier-1 consent wall first and collects the page behind it,
  as a landing and a Page Read already did. A cookie sheet that draws
  late is gone before Jev sees the page, costing no hop and no call.

## Amendment 2026-10-20 — the Endpoint waits 700 ms, not 300

The Decision's "released 300 ms into silence … so a pause mid-sentence
makes two Commands" is reversed in its number. In use, 300 ms is shorter
than a breath: every logged Utterance on 2026-10-19 ended exactly 320 ms
into silence, and "Open Donald Trump's truth social profile" came as
"Opened onal cramps" and "Good social profile", 0.5 s apart, two
Commands, both misheard — a half sentence decodes worse than a whole one,
so the split costs the words as well as the Command. The recovery the
Decision counts on ("recovered in one word") was the whole sentence again.

- **The endpoint delay defaults to 700 ms**; the slider keeps its
  200–1,500 ms range and the merge hold stays off (a hold is the same
  wait spelled twice).
- **The Reaction pays it only where nothing fired early.** An Early Fire
  still fires a complete Command on its partial before the Endpoint; the
  extra 400 ms lands on the Commands that wait for the words to stop.
- A stored `endpointDelayMs` keeps its value; a profile that holds the old
  300 is changed by hand.

## Amendment 2026-10-20 — a turn check decides the Endpoint, under a 2 s pause cap (#357)

The 700 ms amendment above moved the number and kept the timer. The owner
still had to pace themselves: a pause to think ended the line, and
hurrying to avoid pausing hurt the transcript. A person knows from the
sentence that you haven't finished; a silence timer can't. All audio stays
local (ADR 0019, owner ruling 2026-10-20), so the check is a local model.

- **The turn check.** At ~200 ms of silence the Endpoint asks Smart Turn
  (pipecat-ai's open end-of-turn model, v3.2 CPU export, int8, ~8 MB, on
  the app's onnxruntime-node) whether the Utterance so far reads finished:
  the last 8 s of its audio, pause included, as Whisper log-mel features
  computed in core (`src/core/voice/smartTurnFeatures.ts`). A probability
  of 0.5 or more is finished, a constant and not a Setting. Finished fires
  the Endpoint there; unfinished keeps listening, and speech resuming
  continues the same Utterance. One check per pause.
- **The pause cap: 2 s** (owner ruling 2026-10-20). Silence that reaches
  it fires the Endpoint whatever the check said. The endpoint-delay
  Setting becomes the cap (`pauseCapMs`, range 200–4,000 ms); a saved
  `endpointDelayMs` carries over, except the 700 of 847d039, which reads
  as 2,000 once. Saved under the new key, any value stays.
- **A missing or failing model** falls back to the plain silence timer at
  the cap, with a fault reported (`voice.vadEndpointing.turnCheck`). The
  model is fetched once on demand into `<userData>/models/smart-turn`, a
  partial file refetched, like Moonshine's. A check never waits on the
  fetch or the load: until the model is in, it fails at once and loading
  goes on, so the cap stays a bound on a first boot or offline.
- **The transcriber gets at most 640 ms of trailing silence**, what the
  700 ms Endpoint left it, so a cap that fires at 2 s does not hand it 2 s
  of nothing.
- **The `stt` span says what fired the Endpoint**: `endedBy` (`turn`,
  `cap`, `max`), `silenceMs`, and the last check's `turnVerdict`,
  `turnProbability` and `turnScoreMs`. `pnpm perf:report` prints the
  counts and the check's p50/p95.
- Unchanged: the 30 s hard cap, the disarm Endpoints, Early Fire (#326)
  acting on partials before the Endpoint, the merge hold (still 0; a
  finished turn waits it out like any Endpoint when it is set), and the
  Hot Listen's silence clock starting at the Endpoint.

Replayed over the 31 dumps in `~/.config/bingbong/audio-dumps`
(`pnpm turn:replay`): 29 fire on the turn check at the final pause, 192 ms
after the last speech; none reach the cap; two read finished at an earlier
pause. One is a real split ("Open your latest tweet." cut after "Open", at
p 0.77 over a 0.5 s pause); the other is "Go back." ending before trailing
noise that transcribes empty. A check takes p50 76 ms on the dev machine;
the first takes ~1 s while the model loads. Speed on the Kiosk
(i3-7100U) is not measured: ship, and deal with it if it is an issue
(owner ruling 2026-10-20).

## Amendment: a line is Steps (2026-10-20)

Grilled with ADR 0079 from the 19:30 run that day: "start the song from
the beginning and put it on loop" was one ask, one verb, and the second
half was lost. The first amendment rejected "Jev asked up front whether
the words need more than one step" as a reading that can misfire before
anything has happened; that objection was about *continuing* a navigation
Task. A split only changes which words each Command reads, and today the
second half is lost anyway.

### Decision

**At hop 0, a fifth Choice — `steps` — asks where a second Command
starts.** Its options are the transcript's conjunction boundaries ("and",
"then", "and then", a comma) and `none`. `none` is one Command, read as
today. Otherwise the line is Steps: each Step runs as its own Task in
order, on the page the last one left, with "Done so far" carrying the
earlier Steps. A line splits only at the Endpoint, never on a partial.
Step 2 runs only if Step 1 ended `done`; otherwise the Task stops and
speaks Step 1's failure. A line the grammar settles whole ("scroll down")
cannot be Steps; a `play <words>` line reaches Jev (ADR 0079), so "play
highs and lows and loop it" is Jev's to split — or not, when the "and" is
the title's.

### Consequences

- One Jev call at hop 0 carries the fifth Choice; no extra call.
- The decision record's `task` names the Step (`step: 1 of 2`); `pnpm
  perf:report` counts lines that split.
- The glossary gains **Step**.

## Amendment 2026-10-21 — a sure target outvotes an unsure ref-less verb (#367)

(Superseded by the #370 amendment below: Jev reads the Command as one
whole action, so there is no verb and target to arbitrate between.)

Two live sessions on a YouTube watch page, seven readings of "enable /
show / disable captions" and "i dont want to see the captions", and none
toggled the captions. In every one the target Choice named the captions
button at 0.74 to 0.94, and the verb Choice's winner was under 0.7 and took
no ref: `show` (a Capability), `done`, `none`. The reading took the verb
first and heard the target only for a verb that takes one, so the least
grounded answer overruled the most grounded one. The verb Choice's options
are abstract words; the target Choice is the one that sees the page. A
`done` at hop 0 was the worst case: it ended the Task "already here" on a
0.34 answer that a 0.90 answer said was one click away.

### Decision

**When the target Choice names an offered ref at the Choice bar (0.7) and
the verb Choice's top is under it and is not `click`, `type` or `menu`,
the target decides.** A text field with a Slot is typed into, the Slot's
words as ever; anything else is clicked. It holds for every ref-less verb,
`done` and `none` included, and every Capability — the #353 rule (a
`navigate` or `search` whose target names a ref is a click) widened from two
verbs to all of them, and gated on sureness so a sure verb with a stray ref
(`play` 0.97, a ref at 0.8) is left alone. The ref is the target's top
label among the refs the hop offers, never a fallback's (#332, #342). The
questions and the call are unchanged.

**A sure Verdict that the Task is done is not outvoted.** At a later hop
whose `outcome` is a sure `yes`, the rule stands aside: the ref the target
names there is often the toggle the last hop flipped, and clicking it again
undoes the Task (hop 1 of the 22:58 run, whose corpus case expects `yes`).
This is no Verdict-before-verb precedence, which stays deferred to #366's
data: a reading the rule does not touch reads as before.
(Superseded by the #369 amendment below: a sure `yes` at a later hop now
ends the Task before any verb fires, so the reading no longer stands
aside for it.)

### Consequences

- A sweep of the 239 logged readings (2026-10-17 to 21) fires the rule on
  nine: the seven captions misreads and two `open` lines that already
  clicked under #353. `open` 0.73 over ref-3 0.99 stays with the verb.
- The corpus gains a ceiling expectation, `verb<0.7`: the six hop-0
  captions asks are cases expecting `target=ref-12>=0.7 verb<0.7 verb!=type
  verb!=menu`, the answers that make `click ref-12`. "show captions" reads
  `show` at 0.69 to 0.76 on replay, straddling the bar, so its case fails
  about half the time: the rule as decided does not reach a `show` that
  comes back sure.

## Amendment 2026-10-21 — a sure yes ends the Task before any verb fires (#369)

#366 made "Done so far" tell what the last action did to its target, and
its live run (AC8, 2026-10-21) showed the Verdict right and sure: `yes`
read 0.87 to 0.99 at the hops where the target changed the way the words
asked, and 0.01 to 0.09 where it changed the other way. The Task still
fired. The runner heard the Verdict only when the verb read `done` or
`none`. In three of the four sure-yes hops the verb read `click`, and the
click re-toggled what the user had asked to open: the "Code" menu on the
Electron repository shut twice, and the Task ended at the cap.

### Decision

**A Task also ends on a sure `yes` Verdict at any hop past the first,
whatever the verb.** "Sure" is the Choice bar (0.7). The end is the one a
`done` verb takes: a page that moved under the reading is read again
once, and a pop-up that opens within the late pop-up watch is read again
and stepped past, not ended on. A sure `in_the_way` keeps Step Aside.
`not_yet`, or a Verdict under the bar, leaves the verb to decide as
before. Hop 0 carries no Verdict and is unchanged. The rule is mechanical:
no verb, site or element in it.

### Consequences

- The decision record of the ending hop keeps the Command the reading made
  and says `ended: done`; the Feed shows `done`.
- The #367 reading's sure-yes guard is gone: no sure-yes hop reaches the
  verb.
- A no-repeat guard, a mechanical done on an expected Ref State change and
  the joint action Choice stay deferred. Each matters only under the bar.
  (The joint action Choice landed with #370, below.)

## Amendment 2026-10-21 — Jev reads a Command as one whole action (#370)

#353, #367 and #369 were three arbitration rules for one disagreement.
Jev's reading was factored: a verb Choice of sixteen abstract words with no
page element in them, a target Choice among the refs, a Slot, and at later
hops a Verdict, each argmaxed alone and recomposed by precedence. Where the
verb and the target disagreed, code decided which won, and each rule was
written after the failure that exposed it. The confidences it compared are
not comparable — a verb at 0.43 of sixteen and a ref at 0.93 of sixty
answer different questions — and the verb question asked again at every
hop "which verb did the user ask for", so `click` stayed the answer after
the click had worked.

### Decision

**One `action` Choice replaces the verb and the target.** Every option is a
whole action: `click-N` for each ref the reading offers, shown as its ref
line; `type-N` for each text field; `open-N` for each link further down;
`menu-N` (a right-click) for each ref while the card has room; the ref-less
verbs (`navigate`, `search`, `scroll_up`, `scroll_down`, `back`,
`forward`, `reload`, `press`, `read`, `clear`, `stop`); the Capabilities on
offer (ADR 0079); and `none`. Under the 255-option cap the clicks come
first, then the types, the opens, and the right-clicks.

**There is no `done`.** Done-ness is the Verdict's alone, asked at every hop
past the first and read first (#369). Hop 0 asks no Verdict: it always acts
or drops, and the "already here" ending goes. The `done` verb is gone from
the Command too.

**The rest is as it was.** The Slot, `where`, `steps`, the dismiss Choice
and the Early Fire `complete` Noul are asked beside the card, independent of
it. `navigate` and `search` with words keep #353's path — an address-shaped
Slot is navigated; `where=site` searches the site (#340, #341); `where=page`
at hop 0 takes the card's most probable click or open; a later hop never
searches again and on a results landing takes the most probable click or
open, on a Web Engine's a result alone (#332, #342) — minus the branch where
a target naming a ref made a search a click, which the card now says
outright. A label naming a ref or link the hop does not offer is no
Command. The runner-up after a dead end (#363) is the card's next action of
the opener's kind: the next `click-N` after a click, the next `menu-N` after
a menu. The decision record keeps the card's top eight probabilities as
`action` in place of `verb` and `target`.

Removed: the #367 rule (`sureTargetOf`), the #353 target-names-a-ref branch,
and the #367 corpus encoding of a click as `target=ref-12>=0.7 verb<0.7 …`.
Kept: the Verdict-first precedence of #369, the Dismissal Ladder, Site Scope
and Steps.

### Consequences

- The wording was measured, not chosen. A `done` on the card was over-eager
  (an earlier replay's 19–29 `done`s against the Verdict's 11 sure yeses,
  most on search landings), and a hop-0 Verdict read YouTube's stale
  "unavailable" captions label as already done (yes 0.76–0.87). A sentence
  on when to right-click, or each right-click carrying its ref line, cost
  every sure click about 0.2 ("disable captions" 0.66–0.72 → 0.41–0.46, its
  top `none`), so each `menu-N` is shown as `right-click [N] to open its
  menu` and nothing more. The Capability sentence now says a ref that names
  what the words name is the page's own control for it, and that "click
  play" is that control's click.
- The corpus was converted with each ask's card rebuilt by the real
  `commandQuestions`: in all 23 cases the card offers exactly the refs and
  links of the recorded target card, each line the same. `pnpm jev:replay`
  passes 23 of 23; the captions cases read `click-12` at 0.61–0.87. The
  pre-#366 hop-1 "enable captions" Verdict reads yes at the bar (0.70).
- A replay of the 322 logged asks (#370, AC7) read with this card against
  today's code on each ask's own recorded answers: on the asks recorded
  with today's verbs, 51 of 69 hop-0 and 49 of 81 later-hop readings the
  same, the Verdict agreeing on 74 of 78, median latency 216 ms, the largest
  card 195 options. Gained: the hop-0 "disable captions" asks that ended
  "already here" click the captions, "what is a synonym for posthumous"
  searches, an empty Web Engine landing scrolls instead of ending unsure, a
  later hop opens the result link it names. Lost near the bar: "Open this
  tweet" at hop 0 reads `none` at 0.42; two "Cross out the pop-up" hops read
  in_the_way at 0.52–0.59 and end unsure rather than step aside.
- A no-repeat guard, a mechanical done and re-deriving the 0.7 bar for the
  wider card stay deferred: measure on the new asks first.

## Amendment 2026-10-23 — a Task's end says one fixed line (#399)

The voice policy above ("successful actions stay silent") gains one
exception at a Task's end. A Task that ends `done` after more than one
action says "Done." — one word, not the Verdict's reason or the landing's
title; no model writes it. A Task that ends at the cap of five actions, or
`unavailable` past hop 0, says "I couldn't finish that.", marked a failure.
Both are spoken through the runner's voice like any other line: the next
Command silences them, and they ride the turn whose Answer the Feed already
shows, so the Feed gains no entry. A single action stays silent; a wall,
`unsure` and `not_found` keep their own lines; a superseded Task says
nothing. A Step with Steps still to come says nothing of being done, and a
Step whose Task said its end line stops its line without saying "I'm not
sure this is it." again.

The dead end above ("nothing is spoken, the Feed shows `no next step`")
already speaks "I'm not sure this is it." since #369; this amendment
leaves that line as it is.
