# Input-to-output chart — 2026-10-26, base `39196428` + a failed ear load ends the Starting wait (#447)

- **Source:** base `39196428` (`main`, 26 October 2026, after #445 and #446), plus the #447 implementation on branch `worktree-impl-447-ear-fault-overflow`, in `src/core/voice/earState.ts`, `src/core/voice/voicePrompt.ts`, `src/core/voice/voiceHint.ts`, `src/main/voice/attachVoice.ts` and the three ear surfaces. The containing commit records the exact snapshot.
- **Previous chart:** base `a63fde2d` + every Try line parses (#445), 26 October 2026: [`../2026-10-26-a63fde2d-try-lines/chart.html`](../2026-10-26-a63fde2d-try-lines/chart.html).

## Behavioral changes since `a63fde2d` + #445

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The ear starts | the VAD, the wake word or the transcriber load fails | the Starting wait ends: `Ear did not start — type, or restart` on the Voice Prompt and the Idle Screen; the Capsule's pill `Ear did not start`, its hint `type, or restart`; no count; a `voice.ear.load` fault record | `createEarState().modelLoaded`, `earPhase` → `failed`, `voiceHint` |
| The ear failed | a wake came in while the transcriber loaded, no line taken | “The ear did not start. Type, or restart the app.” is said (in place of “I'm ready”) | `sayFailed`, `EAR_FAILED_SPOKEN` |
| The ear failed | a later load of that model succeeds | the line clears to what is still loading, or to the rest hint | `modelLoaded` |

Before, a failed load was ignored and Starting counted up forever.

## Chart changes

- **When you speak:** a red outcome off the cold start, “Ear did not start — type, or restart”, on the arrow “a model does not load”, with a note (shown, not spoken save to a wake during the words' load; a fault record; a retry clears it). The intro adds “or that it did not start”. `voice.png` recaptured and inspected.
- **Important details:** a new bullet for the failed cold start; the source line and the `voicePrompt.ts` reference updated.
- **The whole journey, How it chooses an action:** unchanged; `overview.png` and `decisions.png` retained from the previous version.
