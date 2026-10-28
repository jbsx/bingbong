# Input-to-output chart — 2026-10-28, base `4ec5948b` + #490 step 3 (the stop at the read, the level cut)

- **Source:** base `4ec5948b` (`main`, 28 October 2026), plus the #490 implementation on branch `worktree-impl-490` in `src/main/run/commandRunner.ts` (`forTheApp`), `src/main/voice/attachVoice.ts` (`overSpeech` to the runner), `src/core/voice/overLevel.ts` and `src/core/voice/voiceSession.ts` (`cutStretch`). The containing commit records the exact snapshot.
- **Previous chart:** base `b746a5c5` + the Overlap (#489), 28 October 2026: [`../2026-10-28-b746a5c5-overlap/chart.html`](../2026-10-28-b746a5c5-overlap/chart.html). This version is drawn on that chart.

## Behavioral changes since `b746a5c5` + #489

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A capture over the ducked voice runs | a stretch ≥ 3× the ducked voice's level (its 75th percentile after a 0.64 s settle), ~190 ms or more, then 0.38 s of the ducked voice | the capture is cut there; the stretch alone, with one frame (32 ms) ahead of it and up to 0.26 s after its last loud frame (a person who spoke first is cut from their onset) is read as its own Utterance, `endedBy: level`; the voice still sounding starts a capture of its own | `createOverLevel`, `cutStretch` |
| A line said over the voice is read | an action, or a Fate that ends, joins or waits on the line running | the voice stops at the read, before the Fate is acted on (before: only when a Command fired) | `forTheApp` |
| A line said over the voice is read | `none`, and its Fate goes on (or nothing runs) | nothing stops; the duck lets go when its Task settles | `forTheApp`, `attachVoice` |

## Chart changes

- **When you speak:** the duck box says the ear cuts a loud stretch out alone; the note says the voice stops at the read when the line is for the app, and a none that goes on lets it come back up at its end. The view is 60 px taller for the note. `voice.png` recaptured and inspected.
- **Important details:** the #490 bullet (lost from the previous version when #489's chart was merged) is back, rewritten for the level cut and the stop at the read; the source references name `overLevel.ts`, `ownVoice.ts`, `voiceSession.ts`, `commandRunner.ts` and `attachVoice.ts`; the stamp names this base.
- **The whole journey** and **How it chooses an action:** no change; `overview.png` and `decisions.png` carried over.
