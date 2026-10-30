# ADR 0098: The app does not speak; its lines are shown on the Line Overlay and chimed

## Status

Accepted 2026-10-30, by the owner's ruling of 2026-10-29 (#513). Built on
gitlab main 94938481. Amends ADR 0076, 0081, 0082, 0086 and 0087 where they
name the Page Read, and ADR 0019 and 0093 where they name the voice.

## Context

The person talks over the app. While the app spoke, the mic's echo
canceller took the person out with the app's own voice. Eight passes on
#490 (speech over the app's voice) and a day on #512 (the Chromium speech
player) did not make talking over it reliable. Once, under load, the
person was removed entirely: the 13:39 read on 2026-10-29, at load 6.1,
with Piper at 40 s a sentence. The `overlap` scenario is the top of the
Yield list (~10 a day).

The owner is "not too attached to TTS" and wants the least-headache fix.
The Page Read ("read the page", the whole page aloud) is not useful enough
to keep.

## Decision

- **No line is spoken.** Every road that spoke shows its line instead:
  - the runner's Answers, failures, Fates and stops;
  - a site's question or alert;
  - an Errand's confirm or question (still answered by the next line, spoken or typed);
  - a download;
  - the ear's "I'm ready" and failed line.
  The shown speaker stands where the speaking gate did. It publishes a
  `line` pipeline event and plays a Line Chime: done, or failed when the
  line tells a failure. Nothing is ever speaking, so no capture is muted,
  nothing ducks under speech, and the mic hears the person whenever a
  listen is open.
- **The Line Overlay shows the line** at 65 px on whatever surface is up,
  for 15 s or until the next line, and never takes focus (CONTEXT.md, Line
  Overlay). Someone not looking gets the chime alone. The owner accepts
  that compromise.
- **The Page Read is removed from every spoken road:**
  - the Local Match phrases;
  - the Jev and Planner card option, and the recorded asks of the corpus;
  - the spoken reading.
  The typed CLI `read`/`read_page` stays as a silent page listing: it is
  the e2e suites' ref listing. "show me the part about X" stays.
- **Speech is switched off, not deleted.** Piper, the Chromium speech
  player, the speaking gate and over speech stay in the tree behind
  `BINGBONG_VOICE=on`; off is the default, and Piper is neither installed
  nor started while it is off.

## Consequences

- #512 and #490 are moot, and close as superseded once #513 closes. The
  kiosk's `BINGBONG_SPEECH_PLAYER=chromium` line goes.
- ui.md principles 2, 5, 6, 9 and 10 and the AGENTS.md UI and Reliability
  lines now speak of the Line Overlay and its chime (#513).
- A Command whose output was a line has its Reaction close when the line
  is shown.
- The overlap row-10 cases (talking while the app speaks) can no longer
  reach their state. The criterion needs a new shape: a line said while
  the Line Overlay is up.
- **Guess:** keeping speech behind a switch rather than deleting it, taken
  because it is the cheapest to reverse. What settles it: a week on the
  kiosk with no wish for the voice back; a follow-up then deletes Piper,
  the speech player, the speaking gate and over speech.
- **Guess:** the chime tones (done 660→990 Hz, failed 392→262 Hz, 120 ms
  each), not yet measured in the room.
