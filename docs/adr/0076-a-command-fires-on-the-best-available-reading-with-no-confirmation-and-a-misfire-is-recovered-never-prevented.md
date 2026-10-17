# ADR 0076: A Command fires on the best available reading, with no confirmation, and a Misfire is recovered, never prevented

## Status

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
  and an Early Fired Command that speaks would mute its own Utterance and
  lose its lead — nothing speaks a Command's output until increment 3
  (#327), which should close that Utterance at the mute.
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
- **A process that dies before answering its first line could not start**
  (no piper, or one without `--output-dir`): every line from then on goes
  to the per-line spawn, with no error surfaced. One that dies after
  serving is restarted at the next line, and a line it died under is
  retried once on the new one. A line unanswered in 20 s kills the process.
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
  is shown first, as in increment 1; the Feed hides the `speak` entry of a
  turn whose Card rendered.
- **A spoken `read` stays the Command in flight until its text ends**, with
  status `speaking`: the Abort Head (gated on the run state) and the next
  Command reach it, and either stops the speaker, which kills the stream.
  The voice is one queue, so a stop also cuts a download announcement.
- **The Reaction of a spoken `read` closes on `effect: 'spoken'`**, when the
  first sample is written to the player, and a page mutation during the
  read does not close it. When nothing was spoken — the voice failed, or
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
