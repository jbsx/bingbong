# Input-to-output chart — 2026-10-28, base `f0d275a0` + #490’s eighth pass (speech over the app’s voice off by default again)

- **Source:** base `f0d275a0` (`main`, 28 October 2026), plus the #490 eighth-pass changes in `src/core/voice/ownVoice.ts` (`OVER_SPEECH_DEFAULT` is `off`; `isOwnVoice` holds a short capture against `recent`), `src/core/voice/voiceSession.ts` (`hearSpeech` merges the echo windows, `recentOf`), `src/core/tts/speechCoordinator.ts` (`sounded`), `src/core/tts/speakingGate.ts` (`soundedText`), `src/core/voice/voiceChain.ts` and `src/main/voice/attachVoice.ts` (the `sounded` context). The containing commit records the exact snapshot.
- **Previous chart:** base `8fba566d` + #494’s join: [`../2026-10-28-8fba566d-split-join/chart.html`](../2026-10-28-8fba566d-split-join/chart.html). This version is drawn on that chart.

## Behavioral changes since `8fba566d` + #494

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| Speech starts while the app speaks, inside an open listen | `BINGBONG_OVER_SPEECH` unset (the default) | the capture is the app’s own and dropped, as before #490 (before: the voice ducked and the capture was read) | `OVER_SPEECH_DEFAULT` |
| A capture over the ducked voice is read | `BINGBONG_OVER_SPEECH=duck`, fewer than ten letters | it is the app’s own when it is near a stretch (share ≥ 0.75) of the words the voice sounded from 2 s before the capture to its end (before: never the app’s own under ten letters) | `isOwnVoice`, `ECHO_WINDOW_MS` |

## Chart changes

- **When you speak:** the over-speech start gains a `by default` branch to a red “Dropped as the app’s own voice (#326)” box, with a note that `BINGBONG_OVER_SPEECH=duck` arms the path below; the duck arrow reads “speech starts, when armed”. `voice.png` recaptured and inspected.
- **Important details:** the #490 bullet opens with the default and the short-capture rule; the provenance names this base.
- **The whole journey** and **How it chooses an action:** no change; `overview.png` and `decisions.png` carried over.
