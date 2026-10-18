# ADR 0076: A Command fires on the best available reading, with no confirmation, and a Misfire is recovered, never prevented

## Status

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
of a candidate on this increment.

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
  local_match | terminal`. A `task` span runs from the Endpoint to the
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
  `abandoned`, and nothing fires. Otherwise a slow Jev read would fire
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
- **`screenshot` and `help` stay grammar-only verbs**: Jev is offered the
  spoken vocabulary without them.
- **The post-action wait is readiness, capped at 150 ms**, on an injectable
  clock: a DOM mutation, an input event, a scroll or the document going
  ends it early. The landing poll after `ERR_ABORTED` keeps one 100 ms
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
  `abandoned` (superseded). Only hop 0 has a `reaction` span. The `task`
  span sits on hop 0's turn, carrying `{ ended, hops, actions, source }`.
- **Result links are offered as `link-N` targets**, after the refs and
  only on a search landing (`parseSearchUrl`). They come from the whole
  page's links (`pageLinks`), filtered by the Local Match's own result
  rule (`resultLinksOf`). A link is never offered twice, nor when a ref in
  view already carries its address. A `link-N` has no ref to click, so a
  `click` or `open` of one opens its address.
- **What counts as visited:** the page the Task started on (never
  `about:blank`) and each hop's landing. Two addresses are the same page
  when they agree after the engine's redirect is followed to its target
  (`uddg`, `url`) and the fragment, a trailing slash, `www.` and the
  host's case are set aside (`pageAddressOf`). A visited ref or link is
  absent from the hop's targets. The state Jev reads adds two lines: "This
  is step N of the task. Done so far: …" and "Pages visited: …".
- **Each hop collects the landing afresh**; the page prepared at speech
  start stays hop 0's.
- **An overrun counts only against a Jev-read hop whose verb goes on, and
  only while its Task is still under way.** A Task that ends on its own
  overran nothing, so a next Utterance three seconds after a `done` is no
  overrun, nor is "stop" over a spoken `read`. The overrun is checked at
  a new Command (spoken or typed), at an Early Fire, and at an abort
  (Escape, a "stop" heard while running, the Abort Head). An abort's
  record carries no `signalTurnId`; every overrun carries `hop`. Hop 0
  counts too, and the report keeps it apart by its hop number.
- **Hops past hop 0 raise no back, clear, escape or opposite-scroll
  Misfire against the hop before.** They are the Task's own steps, not
  the user's recovery. The user's next Command is read against the last
  hop that fired, as before.
- **Early Fire:** the Endpoint of an Utterance whose hop 0 fired on a
  partial waits for that action to land, then goes on with the final
  transcript. An Utterance that never reaches its Endpoint is recorded
  at the next speech start. It ends `superseded` when Jev read a hop
  that would have gone on, and otherwise as its reading ends.
- **The Hot Listen's clock restarts when the Task ends.** The runner's
  `run` resolves at the Task's end, and the voice session restarts the
  clock then if the Listen is still open and no Utterance is being
  captured. The clock still runs from the Endpoint, so a Task longer than
  `hotListenSilenceMs` closes the Listen under it; the Abort Head still
  hears.
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
