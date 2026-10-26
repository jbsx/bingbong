# Input-to-output chart — 2026-10-26, base `4af7377e` + the hearing receipt (#441)

- **Source:** base `4af7377e` (`main`, 26 October 2026), plus the #441 implementation on branch `worktree-impl-441-hearing-receipt`, chiefly in `src/core/voice/voiceSession.ts`, `src/core/voice/ipcChannels.ts`, `src/core/voice/voicePrompt.ts`, `src/core/voice/voiceHint.ts`, `src/renderer/src/overlay/VoicePrompt.tsx`, `src/renderer/src/IdleScreen.tsx`, `src/main/stt/createRollingTranscriber.ts` and `src/main/voice/attachVoice.ts`. The containing commit records the exact snapshot.
- **Previous chart:** base `d0263a1f` + the Status Capsule's stages (#428), 25 October 2026: [`../2026-10-25-d0263a1f-stages/chart.html`](../2026-10-25-d0263a1f-stages/chart.html).

## Behavioral changes since `d0263a1f` + #428

No transition changes: what is captured, read, fired and ended is the same. What changes is the visible output while an Utterance is taken, and when its first words appear.

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The open ear, no speech yet | listening | said-line "say a command" under LISTENING, as before | `wordlessLine` |
| The endpointer confirms speech (the frame `onSpeechStart` fires on, ~96 ms of speech in) | listening, not the app's own voice | `VoiceState.hearing` true on that frame; the Voice Prompt, the Idle Screen's Voice Line and the Capsule's hint say "…", the word stays "Listening" | `setHearing`, `earPhase` (`hearing`) |
| The first partial | 0.5 s of speech (was 1 s) | its words replace the "…" | `DEFAULT_PARTIAL_MIN_SAMPLES` |
| A blip dropped, a line starting under the speech, a wake inside the Hot Listen, the listen closing | hearing | `hearing` false: back to "say a command" (or closed) | `letGo`, `stopListening` |
| The Endpoint | hearing | `hearing` false, `transcribing` true: "Transcribing"; the said-line reads "…" where it used to read "say a command" while the words are read | `handleUtterance`, `wordlessLine` |
| A pause inside the resumption merge window (`resumptionMergeMs` > 0; default 0) | the Endpoint fired, the window still open | `hearing` stays true, as `listening` does, until the window closes in quiet or speech resumes | `capturing` |
| The dashboard paints the receipt | a speech start is pending | `speech-to-hearing` perf span (onset chunk's arrival in main to the painted frame); `pnpm perf:report` prints it | `hearingReceipts`, `VOICE_IPC.hearingShown` |

## Chart changes

- **When you speak:** the capture box reads "You speak; the screen shows “…” and the app prepares the page"; a note beside it: "Before you speak it says “say a command”. The first words replace “…” after 0.5 s of speech." Re-captured and inspected (`voice.png`), and at a 600 px width (scrolls sideways as before).
- **Important details:** a bullet on the hearing receipt.
- **Source references:** `voicePrompt.ts` added, `voiceSession.ts` names `setHearing`; the base line updated.
- **The whole journey** and **How it chooses an action:** unchanged; their captures (`overview.png`, `decisions.png`) are retained from the previous version.
