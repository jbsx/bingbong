# Bing Bong

Voice assistant with a live web-browsing dashboard. Local voice pipeline
(wake word, STT, TTS) + LLM agents (GLM-4.6 orchestrator, DeepSeek subagents)
driving a real embedded Chromium via CDP.

## Status

T1 scaffold + command-pipeline seam, T2 browser pane, T3 CDP controller +
CLI harness complete. T4 adds the **text-driven assistant**: a model router
(config-only provider swapping), an OpenAI-compatible orchestrator client, and
a command text box on the dashboard — type a command, watch the browser act,
get a spoken one-liner plus full detail in the transcript.

T5 adds the **risk gate**: every click/type is classified from snapshot facts
(collected in-page, policy in code). Form submissions and downloads pause on a
spoken + on-screen confirmation (auto-deny after 60 s); credential fills and
payment submissions are hard-denied in code — no confirmation, no override.

T6 adds the **utility tools**: `web_search` (DuckDuckGo's no-JS HTML endpoint
behind the `SearchProvider` seam), media verbs (`media_control` drives
playback on the focused page via injected YouTube-style shortcuts — pause,
volume, next, seek; never ad-skipping), and download routing — approved
downloads land in `~/Downloads/bingbong_downloads/` and the filename is
spoken and displayed on completion.

Popup and dialog escalation adds three tiers: cookie/consent walls are
auto-dismissed with an outcome line; other DOM dialogs expose their text and
controls to the model; and `ask_user` shows and speaks a free-text question,
accepting a typed or spoken answer for about 45 seconds. Native JS dialogs are
auto-dismissed and reported, `window.open` popups are closed with their URL
reported, and covered clicks report the overlay instead of silently clicking
through it. `BINGBONG_ASK_TIMEOUT_MS` overrides the ask window for tests or
special deployments.

T9 adds the **ears**: `Ctrl/Cmd+Space` arms
listening; mic audio (the settings-page mic, preferring the C920 over the OS
default) streams from an AudioWorklet at 16 kHz mono, Silero VAD endpoints
the utterance, and smart-whisper transcribes it into the same command
pipeline as the text box. Confirmation prompts open a 12 s voice window once
the spoken prompt finishes — "yes"/"no" resolves it, the on-screen buttons
stay, and the 60 s auto-deny still backs everything. STT latency on the
5600G is measured and the base.en decision recorded in
`docs/stt-latency.md`.

## Voice models

The first voice command needs two model files in `<userData>/models`
(`~/.config/bingbong/models` on Linux — set `BINGBONG_VAD_MODEL` /
`BINGBONG_WHISPER_MODEL` to override):

```sh
mkdir -p ~/.config/bingbong/models
curl -L -o ~/.config/bingbong/models/silero_vad.onnx \
  https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
curl -L -o ~/.config/bingbong/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

`BINGBONG_VAD_SCRIPT` / `BINGBONG_STT_SCRIPT` (JSON arrays of probabilities /
transcripts) replace the real engines — used by the e2e suite and keyless
demos, mirroring `BINGBONG_LLM_SCRIPT`.

T10 adds **hands-free activation**: with the wake models present (see
`docs/wake-parity.md` for download links and the parity write-up), three
custom heads run fully in Node via onnxruntime-node (melspectrogram →
speech embedding → one classifier per head): "bing bong" wakes the
assistant, "stop now" cancels the active run, and "hold on" pauses it for a
spoken steering instruction. Silero VAD gates the scores against
music/noise false positives, and the settings-page threshold slider
applies live. Wake → chime → single-shot listen; saying the wake word
during a spoken answer kills playback instantly and listens again
(barge-in). Env knobs:

```sh
BINGBONG_WAKE_ENGINE=node|python|off   # default node; python = reference sidecar (wake head only)
BINGBONG_WAKE_MODEL=…                  # override the "bing bong" head path
BINGBONG_WAKE_ABORT_MODEL=…            # override the "abort" head path
BINGBONG_WAKE_HOLD_ON_MODEL=…          # override the "hold on" head path
BINGBONG_WAKE_SCRIPT='[0.01, 0.99]'    # scripted scores, e2e double (object form scripts each head)
```

The Python fallback needs `pip install openwakeword onnxruntime` and is a
pure config swap — the seam (`WakeWordDetector`) and the VAD gate above it
are identical for both engines.

## Configuring models

Model routing is env-only — no model ids are hardcoded. Per role
(`ORCHESTRATOR`, `SUBAGENT`, `VISION`):

```sh
BINGBONG_ORCHESTRATOR_BASE_URL   # e.g. https://ai.z.ai/api/coding/paas/v4 (z.ai coding plan)
BINGBONG_ORCHESTRATOR_MODEL      # e.g. glm-5.3
BINGBONG_ORCHESTRATOR_API_KEY    # or rely on the default key env (ZAI_API_KEY for
                                 # orchestrator/vision, DEEPSEEK_API_KEY for subagent),
                                 # or point elsewhere with BINGBONG_ORCHESTRATOR_API_KEY_ENV
```

Any OpenAI-compatible provider works for any role — swapping providers is a
config change. `BINGBONG_LLM_SCRIPT` (a JSON array of scripted turns) replaces
the live model entirely — used by the e2e suite and keyless demos.

## Performance log

Every turn is perf-logged, zero config: one JSONL span per finished stage
(STT, each LLM round, each tool call, TTS), keyed by a `turnId` shared with
the event stream and history, written to a rotating `logs/` dir under the
profile. Whole browser actions appear as their tool span; set

```sh
BINGBONG_BROWSER_SUBSPANS=1            # verbose drill-down inside browser actions
```

to additionally time the deliberate delays and extra round-trips inside them
(settle sleeps, snapshot recollections, pre-click safety probes) as
`browser-*` sub-spans. Off by default — the default log stays whole-action.

## Try it

```sh
export ZAI_API_KEY=… BINGBONG_ORCHESTRATOR_BASE_URL=https://ai.z.ai/api/coding/paas/v4 BINGBONG_ORCHESTRATOR_MODEL=glm-5.3
pnpm dev
```

Type `open youtube and play the first MKBHD result` into the command box and
watch the loop navigate, read, type, and click.

## The seam

Everything is tested through one boundary: a text command goes in, a typed
event stream comes out (`src/core/pipeline`). The stream covers status
transitions, tool calls/results, confirmation and free-text ask requests and
resolutions, speak/display payloads, and errors.

- **Above the seam** (thin adapters, later tickets): voice pipeline, dashboard UI.
- **Below the seam** (interfaces + test doubles, `src/core/ports`): LLM client,
  browser controller, TTS, STT, search, clock (injectable for timeout tests).
  Scripted doubles resolve env-side in the main adapters
  (`BINGBONG_*_SCRIPT`); pure doubles for unit tests live in `src/core/testing`.

## Commands

```sh
pnpm install    # install (native deps: onnxruntime-node + smart-whisper build via node-gyp;
                #   with gcc ≥ 14 export CFLAGS=-D_GNU_SOURCE CXXFLAGS=-D_GNU_SOURCE first)
pnpm dev        # launch the app in dev mode
pnpm test       # run the test suite
pnpm typecheck  # tsc over main/preload/core + renderer
pnpm lint       # eslint
pnpm build      # production build to out/
```

## Layout

```
src/
  main/        Electron main process
    agent/     model-routed OpenAI client, orchestrator prompt, pipeline glue, IPC
    voice/     Silero VAD + smart-whisper adapters, voice IPC (T9)
  preload/     contextBridge preload
  renderer/    React dashboard (command box, transcript, status orb, browser pane, mic worklet)
  core/
    agent/     model routing config + the answer contract (speak/display)
    pipeline/  command pipeline + event types (the seam)
    ports/     interfaces for LLM, browser, TTS, STT, search, clock
    voice/     VAD endpointing, yes/no parsing, voice session (the ears' seam)
    testing/   test doubles (scripted LLM, fake clock, fakes)
```
