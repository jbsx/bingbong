# Input-to-output chart — 2026-10-31, base `2afdab0a` + #530 (accompanying implementation changes)

- **Source:** base `2afdab0a` (`main`, 31 October 2026), plus #530: `src/core/voice/captureAsk.ts`, `src/core/voice/voicePrompt.ts`, `src/core/voice/voiceHint.ts`, `src/core/voice/micMute.ts`, `src/core/voice/ipcChannels.ts`, `src/main/voice/attachVoice.ts`, `src/preload/index.ts`, `src/renderer/src/useVoice.ts`, `src/renderer/src/micCapture.ts`.
- **Previous chart:** [`../2026-10-31-4bed530e-tap-no-card/chart.html`](../2026-10-31-4bed530e-tap-no-card/chart.html), which this one replaces.

## Behavioral changes

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| The capture does not open | any error, at rest or in a listen | The ear is `failed`: every surface says “Ear did not start — type, or restart”, never “Ready”. One Feed line; nothing said aloud. | `captureFailed`, `earPhase` |
| A listen open with no capture | until the disarm lands | `failed`, not `listening`: no frame reaches it. | `earPhase` |
| A line already taken | the capture has since failed | Its read is still named. | `earPhase` |
| A device change, or 30 s (a guess) | capture failed, ear asks for one | One try. If it fails: no Feed line. | `useVoice`, `CAPTURE_RETRY_MS` |
| A track ends that nobody stopped | capture open | As a capture that did not open: `failed`, one Feed line, any listen closed. | `onLost` |
| The ear is shut | capture failed | “Microphone off” as ever; the next Ctrl+Space tries. | `earPhase` |
| A listen opens, or the ear reopens from shut | capture failed | One try. If it fails: a Feed line, since someone asked. | `opensCapture` |
| Any other voice state | capture failed | No try. Before, each one tried again and added a Feed line. | `opensCapture` |
| A capture opens | after a failure | The fact clears; the Capsule returns to “Ready”. | `useVoice`, `captureReports` |
| The Mic Mute | capture failed | “Microphone off” as ever; the try on unmuting is a new ask. | `micMutedState` |

## Layout and terminology

- **When you speak:** the arrow into “Ear did not start” also names the mic, and its note says how it comes back; the intro says the same. No box or arrow added or removed. Recaptured: `voice.png`.
- **The whole journey** and **How it chooses an action:** no drawn change; `overview.png` and `decisions.png` are retained.
- The details gain one bullet and the source references gain `useVoice.ts` and `captureAsk.ts`.
