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
  does; otherwise it is an address.
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

Not built in increment 1: Early Fire, Hot Listen, the persistent Piper.
The Reaction distribution this increment measures is their baseline.
- Moonshine Small stays the default STT tier until increment 1's replay
  of the same utterance dumps gives Small and Base a p95 to compare.
