# ADR 0093: The voice chain runs in its own process, and Electron's main thread only routes

## Status

Amended 2026-10-30 by ADR 0098 (#513): the app does not speak by default; its
lines are shown on the Line Overlay and chimed, and the voice runs only with
`BINGBONG_VOICE=on`.

Accepted on 2026-10-26, built for #430 (gitlab main 6f63adba). The
orchestrator ruled on the owner's behalf on the issue: (a) utilityProcess
over worker_threads unless measured otherwise, (b) frames go through main
first, (c) STT on its own thread is a measured tie, (d) the dev measures
close it and the kiosk confirms. Amends ADR 0019 (Parakeet loads at boot).

## Context

Every voice model ran on Electron's main JS thread: Silero VAD, the
openWakeWord stack, Smart Turn and the STT engine. That thread also drives
CDP, IPC, every hook, the boot and the quit. onnxruntime-node 1.27's `run()`
and `InferenceSession.create` are a `setImmediate` followed by a synchronous
binding call, so whatever a model computed, the main loop computed.
Parakeet's sessions (652 MB int8 encoder) were created at the first
`finish()`, so the first line after a boot paid the load on that thread.

The kiosk (i3-7100), 2026-10-25 audit and the 2026-10-26 00:40 baseline,
at rest with the ear open: the main process was at 19.1 % of one core, its
JS thread about 20 %. `turnScoreMs` ran 861–1202 ms in the app, against
about 270 ms for the same model benchmarked alone, so most of every turn
check was spent waiting in the queue. The first `stt` after a boot took
6756 and 7798 ms. Main loop p99 was 26.5 ms, with one 3045 ms stall.

## Decision

- **The voice chain is one Electron utilityProcess**
  (`src/main/voice/voiceProcess.ts`): the VAD, the wake stack, Smart Turn,
  the endpointer, the voice session and the STT engine.
- **The STT engine runs on its own worker thread inside it**
  (`sttThread.ts`), so a Parakeet pass or load never holds a VAD frame or a
  wake chunk.
- **The ear's capture opens no output device.** Its `AudioContext` takes
  `sinkId: {type: 'none'}`, so capture brings up no output stream (#431).
  Measured against decimating at the device rate (B) and `channelCount: 1`,
  this arm (A) won. Echo cancellation, noise suppression and gain control
  stay on; whether to turn them off is a fork left unbuilt, and keeping them
  is a guess until the owner's live-mic run of the wake under music settles it.
- **Main only routes.** It holds a VoiceSession-shaped client
  (`src/core/voice/voiceChain.ts`). Frames go renderer → main → voice
  process, each with what the session reads off the app (a line playing,
  the run state, the live Settings). State, partials, the words to submit,
  perf spans, faults and model loads come back. PipelineEvents, the `stt`
  and `end-of-speech` spans, `vadLag`, `model-load` and faults keep their
  seams.
- **Models load before they are needed.** The STT engine loads once boot
  is `ready` (`Transcriber.prepare`), so the first line is not cold, and
  `ready` does not wait for it. The wake models load when the ear opens
  (ADR 0024, amendment 2026-10-26).
- **A voice process that exits is a fault** (`voice.chain.exit`). The ear
  says it is down, and the process restarts after 1 s, doubling to 30 s.
- On quit the voice process is killed at `before-quit` with no wait. Its
  sessions are not released; process exit frees them (#434).

## Measured at build

`e2e/voiceChain.e2e.test.ts` (opt-in): the real models on Chromium's fake
mic, CPUQuota=120 %, 2 cores, 60 s at rest with the ear open, then 90 s of
12 real utterance dumps (about 17 lines a run). Before is ef491bfa (2 runs),
after is 5 runs.

| | before | after |
| --- | --- | --- |
| main JS thread at rest | 4.1–4.6 % | 0.6–0.9 % |
| main JS thread while speaking | 12.5 % | 0.8–1.0 % |
| main loop p99 / max | 48 / 4207–5465 ms | 22–25 / 132–300 ms |
| first `stt` | cold, behind a 4.3–5.5 s create on main | 195–366 ms |
| `turnScoreMs` p50 | 145 / 167 | 85–89 |
| `stt` warm p50 | 269 / 274 | 172–204 |
| `vadLag` max | 706–940 ms | 390–670 ms |

The forks, on the same runs:

- **utilityProcess vs worker_threads: a measured tie.** `turnScoreMs` p50
  with one thread was 142/107/84 (utility) against 93/87/83 (worker); with
  the STT thread it was 89/87/86/85 against 156/93/87/87. The main thread
  was the same in both. The worker held about 95 MB less RSS. Utility kept,
  on the ruling: onnxruntime-node is a native addon, and a process keeps its
  memory and its crashes off the app.
- **One thread vs STT on its own thread: the STT thread won.** With one
  thread, the boot load held up the VAD and the wake: `vadLag` max was
  1.8–3.4 s, worse than base, and turn p95 was 145–308 ms. With the STT
  thread they were 390–670 ms and 165–265 ms.
- **Frames through main vs a direct MessagePort: through main, on the
  ruling.** The port is named and unbuilt. It is the next arm if the
  kiosk's loop record (#429) still shows main-thread stalls.

## Kiosk confirmation

Build 6f63adba, 2026-10-26 01:20, at rest on the Idle Screen, 60 s `top`, %
of one core:

| | before | after |
| --- | --- | --- |
| main process | 19.1 | 3.4 |
| main thread | ≈ 20 | 2.4 |
| voice process | — | 16.6 (its main thread 15.9, STT thread 0.4) |
| Electron total | 40.9 | 36.9 |

Loop p99 was 21 ms (it had been 26.5). Boot `ready` came at 5643 ms (it had
been 6812), and `stt-loaded` at 11515 ms (a 5852 ms load), with `ready` not
waiting for it. The voice process held 920 MB RSS with Parakeet in it;
`vmstat` si/so read 0/0 on every sample. There were no `voice.chain.exit`
faults. The work moved without shrinking: #435 then cut the voice process
at rest to 4.8 %.

## Considered options

- **worker_threads alone**: a measured tie on the spans and 95 MB lighter,
  but a native addon's fault takes the app down with it.
- **A direct MessagePort renderer → voice process**: unbuilt (above).

## Consequences

- Main's loop no longer waits on a model. A stall there is something other
  than voice.
- The voice process is a separate row in `perf:report` and in `top`. Its
  RSS (about 920 MB with Parakeet) is the largest single process on the
  kiosk's 4 GB.
- A model crash costs the ear until the restart, not the app.
