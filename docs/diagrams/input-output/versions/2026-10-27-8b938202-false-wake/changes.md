# Input-to-output chart — 2026-10-27, base `8b938202` + a wake that brings no words (#483)

- **Source:** base `8b938202` (`main`, 27 October 2026), plus the #483 implementation on branch `worktree-impl-483` in `src/core/voice/voiceSession.ts` (and the `listen-closed` line in `src/core/perf/perfReport.ts`). The containing commit records the exact snapshot.
- **Previous chart:** base `da107e12` + where the Planner enters (#468), 27 October 2026: [`../2026-10-27-da107e12-planner-on/chart.html`](../2026-10-27-da107e12-planner-on/chart.html). This version is drawn on that chart.

## Behavioral changes since `da107e12` + #468

| State or event | Condition | Next state or outcome | Source symbol |
| --- | --- | --- | --- |
| A wake opens a listen | always (before: no clock ran until the listen had submitted a line) | the silence clock starts, `hotListenSilenceMs` (8 s by default) | `startListening` → `startSilenceClock` (`silenceCloses`) |
| A blip inside that listen (empty transcript, or a capture the endpointer drops) | — | the clock restarts from the blip (before: a no-op, so the ear stood open until the next real line — 116 s on the kiosk) | `handleUtterance`, `handleChunk` |
| The clock runs out | no line was submitted | the listen closes, nothing said or shown, the wake monitor reset; one `listen-closed` span `{reason: 'wake', blips, heard: false}`; no `wake-to-transcript` | `closeForSilence` |
| A Hot Listen's clock runs out | a line was submitted | as before, plus one `listen-closed` span with `heard: true` | `closeForSilence` |
| A Task from an earlier listen is still under way at a fresh wake | — | the clock waits for the Task to end, then starts (before: `restartAfterTask` started it only in a Hot Listen) | `restartAfterTask` |
| A hotkey listen | — | unchanged: no clock closes it | `silenceCloses` |

## Chart changes

- **When you speak:** a red outcome off the wake branch, “Listening closes; nothing is said”, labelled “no words in 8 s (a blip restarts it)”; the “Before you speak…” note moved left of the capture box to make room; the Hot Listen note says it times out 8 s after Tasks and speech settle, as a wake that brings no words does; the intro adds one sentence. `voice.png` recaptured and inspected.
- **The whole journey** and **How it chooses an action:** no change; `overview.png` and `decisions.png` carried over.
- **Important details:** a bullet for the wake that brings no words; the source references name `voiceSession.ts` and the stamp now names this base (the previous version still carried #478's stamp).
