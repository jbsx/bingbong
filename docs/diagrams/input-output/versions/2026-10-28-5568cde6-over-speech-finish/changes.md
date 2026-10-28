# Input-to-output chart — 2026-10-28, base `5568cde6` + #490’s finish (the stop at the read, the level cut, a sounding outcome is the line running, a line over the voice that fires nothing says nothing)

- **Source:** base `5568cde6` (`main`, 28 October 2026), plus the #490 implementation on branch `worktree-impl-490` in `src/main/run/commandRunner.ts` (`forTheApp`, `quietOver`, `soundingLine`, `settleLine`), `src/main/voice/attachVoice.ts` (`overSpeech` to the runner), `src/core/voice/overLevel.ts` and `src/core/voice/voiceSession.ts` (`cutStretch`). The containing commit records the exact snapshot.
- **Previous chart:** base `7f7cccb0` + #489’s last changes, 28 October 2026: [`../2026-10-28-7f7cccb0-overlap-finish/chart.html`](../2026-10-28-7f7cccb0-overlap-finish/chart.html). This version is drawn on that chart.

## Behavioral changes since `7f7cccb0` + #489

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A capture over the ducked voice runs | a stretch ≥ 3× the ducked voice's level (its 75th percentile after a 0.64 s settle), ~190 ms or more, then 0.38 s of the ducked voice | the capture is cut there; the stretch alone, with one frame (32 ms) ahead of it and up to 0.26 s after its last loud frame (a person who spoke first is cut from their onset) is read as its own Utterance, `endedBy: level`; the voice still sounding starts a capture of its own | `createOverLevel`, `cutStretch` |
| A line said over the voice is read | an action, or a Fate that ends, joins or waits on the line running | the voice stops at the read, before the Fate is acted on (before: only when a Command fired) | `forTheApp` |
| A line said over the voice is read | `none`, and its Fate goes on (or nothing runs) | nothing stops; the duck lets go when its Task settles | `forTheApp`, `attachVoice` |
| A line has said its outcome and its Task is over | a sentence of it still sounds (a Page Read, a fact, a failure's line, an Early Fire that speaks) | it stays the running line on the Appliance Card, at the Speaking stage, until the sentence ends (before: a line was running only while its Task ran, and an Early Fire never was), so “move on” over a Page Read is read against it | `soundingLine`, `settleLine`, `retire` |
| A line ends a running line | the running line's sentence still sounds | the sentence is silenced with it | `endRunning` |
| A line said over the voice ends | it fired nothing: read none, unsure, or Jev did not answer | it is never handed to the Errand and ends with nothing said (before: an unsure or unanswered line went to the Errand, whose sentence was more echo) | `quietOver` |

## Chart changes

- **When you speak:** the duck box says the ear cuts a loud stretch out alone; the note says the voice stops at the read when the line is for the app, and a none that goes on lets it come back up at its end. The view is 60 px taller for the note. `voice.png` recaptured and inspected.
- **Important details:** the #490 bullet (lost from the previous version when #489's chart was merged) is back, rewritten for the level cut and the stop at the read; the source references name `overLevel.ts`, `ownVoice.ts`, `voiceSession.ts`, `commandRunner.ts` and `attachVoice.ts`; the stamp names this base.
- **The whole journey:** the Overlap's foot note says a line still saying its outcome is running until its sentence ends; `overview.png` recaptured and inspected (the Overlap's foot).
- **When you speak:** the note also says a line that fires nothing says nothing and is never an Errand; `voice.png` recaptured and inspected (the over-speech section).
- **Important details:** the Overlap bullet and the #490 bullet carry the two; the source references name `soundingLine`, `settleLine` and `quietOver`.
- **How it chooses an action:** no change; `decisions.png` carried over.
