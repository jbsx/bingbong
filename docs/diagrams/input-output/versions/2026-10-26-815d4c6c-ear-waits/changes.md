# Input-to-output chart — 2026-10-26, base `815d4c6c` + the ear's waits narrated (#442)

- **Source:** base `815d4c6c` (`main`, 26 October 2026, after the narrated wait #438 and the contrast floor #437), plus the #442 implementation on branch `worktree-impl-442-narrate-ear-waits`, chiefly in `src/core/voice/earState.ts`, `src/core/voice/voicePrompt.ts`, `src/core/voice/voiceHint.ts`, `src/core/pipeline/runProgress.ts`, `src/core/pipeline/stageSpans.ts`, `src/main/voice/attachVoice.ts`, `src/main/index.ts`, `src/main/run/commandRunner.ts` and the renderer's Voice Prompt, Idle Screen and Capsule. The containing commit records the exact snapshot.
- **Previous chart:** base `9db2d2ba` + the narrated wait (#438), 26 October 2026: [`../2026-10-26-9db2d2ba-narrated/chart.html`](../2026-10-26-9db2d2ba-narrated/chart.html).

## Behavioral changes since `9db2d2ba` + #438

New visible states before command selection, and one spoken line:

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| App launch, the ear open (wake on, or a hotkey listen) | the VAD (and the wake models) not yet loaded | the ear is **Starting**: "loading the ear · Ns" on the Capsule, the Voice Prompt and the Idle Screen; no "Say Bing Bong", never "Ready" | `earPhase`, `createEarState` |
| `vad-loaded` (and `wake-loaded`) | — | at rest, "Say Bing Bong"; the boot milestone `ready` now waits for `vad-loaded` (owner ruling 1), and the transcriber loads from `ready` | `startBootClock` readyWhen, `voiceLoads` |
| An Endpoint | the transcriber not yet loaded | the line is held: **Starting** with its words and the seconds since its Endpoint | `earPhase` |
| `stt-loaded` | a wake came in while it loaded and no line is being taken | "I'm ready" is said (owner ruling 3) | `createEarState.modelLoaded` |
| An Endpoint | the transcriber loaded | **Transcribing** with the Utterance's last partial (or "your words") and its seconds | `earWaitParts` |
| An action's first effect | — | "Loading…" carries the host it loads | `loadingDetail` |
| A stage past its own bound | thinking/acting 1.7 s, loading 7.2 s (guess, dev p95) | "still …" | `STUCK_STAGE_MS` |

## Chart changes

- **When you speak:** a new first box, "The app starts; the ear loads what it hears with", with a note on what the screen says, and the arrow "the ear can hear" to "You activate listening"; "The app finishes transcribing your words" becomes "The app transcribes your words; the screen counts its seconds", with a note on the held line and "I'm ready". Everything below moved down 240 units. Re-captured and inspected (`voice.png`).
- **Important details:** a bullet on the ear's waits; the stages bullet names Loading's host (re-named at a click's landing) and the per-stage bounds; the empty Feed's rest hint (#437) is blank while starting.
- **Source references:** `earState.ts` and `voicePrompt.ts` added; the base line updated.
- **The whole journey** and **How it chooses an action:** diagrams unchanged; their captures (`overview.png`, `decisions.png`) are retained from #438's version.
