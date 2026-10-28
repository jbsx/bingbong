# Input-to-output chart — 2026-10-28, base `7559ae7b` + speech over the app's own voice (#490)

- **Source:** base `7559ae7b` (`main`, 28 October 2026), plus the #490 implementation on branch `worktree-impl-490` in `src/core/voice/ownVoice.ts`, `src/core/voice/voiceSession.ts`, `src/core/tts/speechCoordinator.ts`, `src/main/tts/` (the aplay gain) and `src/main/voice/attachVoice.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `deef0aa5` + a song plays before it says Playing (#488), 27 October 2026: [`../2026-10-27-deef0aa5-media-start/chart.html`](../2026-10-27-deef0aa5-media-start/chart.html). This version is drawn on that chart.

## Behavioral changes since `deef0aa5` + #488

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Speech starts inside a listen while the app speaks | arm `duck` (the default) | the capture is kept, not muted (before: muted and dropped as the app's own voice, #326); the app's voice ducks to the duck floor (15 %) | `meetSpeech`, `speechCoordinator.duck` |
| A line starts under a capture already running | the app began speaking during it | the same: the capture is read, the voice ducked | `meetSpeech` |
| A partial arrives over the app's voice | — | not shown, never fired early | `onPartial` guard (`over === null && !speaking()`) |
| The Endpoint of a capture over the voice | the transcript is blank, or ≥ 0.7 of its words are the app's sentence in order | dropped, nothing shown; the voice comes back up | `isOwnVoice`, `releaseOver` |
| The Endpoint of a capture over the voice | any other line | submitted to the runner with `overSpeech: true`; a Command that fires silences the voice as any fire does; the duck is let go when the line's Task settles (a `none` fires nothing, so the voice comes back up) | `handleUtterance`, `attachVoice` (restore on settle) |
| Arms | `BINGBONG_OVER_SPEECH` | `duck` (default), `filter` (no duck; a line of yours stops the voice at the Endpoint), `stop` (any speech stops the voice at its start), `off` (as before: muted) | `resolveOverSpeech` |
| Perf | — | `over-speech` span per read (verdict, share); `speech-yield` from speech start over speech to the voice going quiet | `voiceSession`, `attachVoice` |

## Chart changes

- **When you speak:** a second starting dot below the Hot Listen: “You speak over the app’s own voice, inside an open listen” → (speech starts) “Its voice ducks to 15 %; the ear reads what it heard” → a red “Dropped, nothing shown; the voice comes back up” (blank, or mostly the app’s own words) and “Your line enters the runner, as any spoken line does” (a line of yours), with a note that nothing fires early over it and that the voice stops when a Command fires and comes back up when the Task settles. The intro adds one sentence. `voice.png` recaptured and inspected.
- **The whole journey** and **How it chooses an action:** no change; `overview.png` and `decisions.png` carried over.
- **Important details:** a bullet for speech over the app's own voice and its arms; the source references name `ownVoice.ts`, `voiceSession.ts`, `speechCoordinator.ts` and `attachVoice.ts`; the stamp names this base.
