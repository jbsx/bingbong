# ADR 0076: A Command fires on the best available reading, with no confirmation, and a Misfire is recovered, never prevented

## Status

Accepted on 2026-10-17 for the `kachow` branch, grilled the same day from
the branch at f4d323b and the measurements in `docs/moonshine-ab.md`, with
every recommendation taken. Nothing is built: the first increment is the
plain loop this decision shapes, and no Reaction has been measured.

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
