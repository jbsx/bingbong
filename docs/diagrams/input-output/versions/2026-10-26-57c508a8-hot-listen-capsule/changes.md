# Input-to-output chart — 2026-10-26, base `57c508a8` + the screen through a Hot Listen (#472)

- **Source:** base `57c508a8` (`main`, 26 October 2026, after #466), plus the #472 implementation on branch `worktree-hot-listen-capsule`, in `src/core/pipeline/runProgress.ts` (`capsuleStatus`), `src/core/voice/voicePrompt.ts` (`earPhase`), `src/core/voice/voiceHint.ts`, `src/core/voice/ipcChannels.ts` (`VoiceState.speaking`), `src/main/voice/attachVoice.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/useVoice.ts` and `src/renderer/src/IdleScreen.tsx`. The containing commit records the exact snapshot.
- **Previous chart:** base `a1a470bb` + the Capture Op (#466), 26 October 2026: [`../2026-10-26-a1a470bb-capture/chart.html`](../2026-10-26-a1a470bb-capture/chart.html).

## Behavioral changes since `a1a470bb` + #466

No transition changes: what is captured, read, fired and ended is the same, and the Hot Listen stays open exactly as long as before. What changes is what the screen says while it is open.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A Command runs inside an open Hot Listen | the ear has heard nothing | the Capsule's pill names the stage (“Opening…”, “Loading…”, “Reading…”) with the waveform beside it, the hint “say a command” (was “Listening…” for the whole Task) | `capsuleStatus`, `App` |
| Speech starts in the open Hot Listen | a Command is running | “Listening…”, “…”, the receipt first, as before | `capsuleStatus` (`hearing`) |
| The app speaks (the speaking gate holds a line, or the runner's Speaking stage) | the Hot Listen is open, nothing heard | the ear is shown at rest: the Capsule “Speaking…” with no waveform, its hint, the Voice Prompt and the Idle Screen's line the rest hint (`Say “Bing Bong” or start typing`), never “say a command”: what starts under the app's voice is dropped as its own | `VoiceState.speaking`, `earPhase`, `voiceHint` |
| A spoken Answer plays after the Task has ended | nothing runs | the Capsule says “Speaking…” (was “Listening…”, or “Ready” with the ear closed) | `capsuleStatus` |
| The speaking gate starts or stops | — | main republishes the voice state with `speaking` | `attachVoiceToWindow` (`onSpeakingChange`) |

## Chart changes

- **When you speak:** the note under “Listening stays open for your next request” gains “While a Task runs the screen names its stage, the waveform beside it. While the app speaks it says “Speaking”: only the wake word is heard then.”; the note moved down to clear the box and the view grew to 2000. `voice.png` recaptured at 1440 × 2300 and inspected; a 700 px capture inspected (scrolls sideways as before, the note legible).
- **Important details:** a #472 bullet.
- **Source references:** `voicePrompt.ts` names the at-rest phase; `runProgress.ts` (`capsuleStatus`) and `speakingGate.ts` added; the base line updated.
- **The whole journey** and **How it chooses an action:** unchanged; `overview.png` and `decisions.png` retained from the previous version.
