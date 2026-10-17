# Bing Bong

The voice-driven browser shell with the
generating-model layers stripped out. What is left is a local voice pipeline
(wake word, STT, TTS), a real embedded Chromium driven over CDP through a
numbered-ref interaction surface, a dashboard that shows every step, and one
model — Jev, the Decision Model. The aim is an agent that completes a task
as fast as it can, built on this shell.

![Bing Bong dashboard](docs/screenshot.png)

## What is here

- **Talk or type.** `Ctrl/Cmd+Space` arms listening; say "bing bong" for
  hands-free. "stop" cancels a run, "hold on" pauses it for a spoken
  directive, and the wake word mid-answer barges in — playback stops
  instantly and it listens again. Typed commands go through the Prompt Bar
  in the feed panel.
- **A browser an agent can act through.** The pane's page is collected into
  a numbered snapshot of its interactive elements (Vimium-style: visible
  rect, label, kind, risk facts) plus its text; actions are `navigate`,
  `read`, `click <ref>`, `type <ref> <text>`, `scroll`, `press`,
  `screenshot`, `back`. Every action's outcome names what happened on the
  page — a blocker, a consent wall, a covered click, an empty or not-found
  landing — in one line.
- **A direct command runner, for now.** Commands in the CLI grammar above
  run straight against the browser and show in the feed. This is the seam
  the Jev-driven agent replaces (`src/main/run/commandRunner.ts`).
- **Handles the annoying web.** Cookie/consent walls are auto-dismissed;
  native JS dialogs are auto-dismissed and reported; `window.open` popups are
  closed with their URL reported; an embedder-level adblocker runs on the
  pane's partition; agent-initiated downloads land in
  `~/Downloads/bingbong_downloads/` and are announced.
- **Ships as an appliance.** The kiosk image and compose file are unchanged
  from `main`.

## Quickstart

Linux, Node ≥ 22.18, pnpm.

```sh
pnpm install    # native dep: onnxruntime-node; with gcc ≥ 14 export
                #   CFLAGS=-D_GNU_SOURCE CXXFLAGS=-D_GNU_SOURCE first
export TYPESAFE_API_KEY=…   # arms Jev; optional until the agent is wired
pnpm dev
```

Open the feed panel (`Ctrl+Shift+F`) and type `navigate youtube.com`, then
`read`, then `click <ref>` — or arm listening with `Ctrl/Cmd+Space` and say
it. `pnpm cli` drives the same browser controller from a terminal REPL.
Voice needs one manual model download (Silero VAD); everything else fetches
itself.

## Voice models

The first voice command needs the Silero VAD model in `<userData>/models`
(`~/.config/bingbong/models` on Linux — set `BINGBONG_VAD_MODEL` to
override):

```sh
mkdir -p ~/.config/bingbong/models
curl -L -o ~/.config/bingbong/models/silero_vad.onnx \
  https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
```

Everything else is app-managed:

- **Moonshine STT** (Small by default; Base and Medium selectable on the
  settings page) — the int8 ONNX export (~230 MB) fetches in the background
  on first launch; a fetch failure surfaces as an STT error on the first
  spoken command, not a startup crash.
- **Wake models** — custom heads run fully in Node via onnxruntime-node
  (melspectrogram → speech embedding → one classifier per head): "bing
  bong" wakes, "stop now" aborts. Silero VAD gates the scores against
  music/noise false positives; the settings-page threshold slider applies
  live. Download links and the parity write-up: `docs/wake-parity.md`.

The wake engine has a Python fallback (`pip install openwakeword
onnxruntime`) — a pure config swap; the seam (`WakeWordDetector`) and the
VAD gate above it are identical for both engines.

## The Decision Model

Jev answers typed questions — a Choice among named options, a Noul for
whether a statement holds — and generates nothing. A key alone arms it; the
base URL and model id are pinned defaults, overridable:

```sh
TYPESAFE_API_KEY=…                 # or BINGBONG_DECISION_API_KEY / BINGBONG_DECISION_API_KEY_ENV
BINGBONG_DECISION_BASE_URL=…       # default https://api.typesafe.ai
BINGBONG_DECISION_MODEL=…          # default jev-1.13.0 — pinned, never a floating alias
BINGBONG_DECISION_SCRIPT='[…]'     # scripted stand-in: a list of {"answers": {…}} or
                                   # {"unavailable": "<reason>"}, consumed in order
```

Keys may also live in the `.env` file next to the app (read once at boot).
Precedence is `.env` < process environment.

### Environment variables

```sh
BINGBONG_ENV_FILE=…                    # load .env from another path
BINGBONG_IDLE_TIMEOUT_MS=…             # idle screen timeout (default 5 min)

# Wake
BINGBONG_WAKE_ENGINE=node|python|off   # default node; python = reference sidecar (wake head only)
BINGBONG_WAKE_MODEL=…                  # override the "bing bong" head path
BINGBONG_WAKE_ABORT_MODEL=…            # override the "abort" head path

# Diagnostics
BINGBONG_BROWSER_SUBSPANS=1            # verbose sub-spans inside browser actions (perf log)
BINGBONG_AUDIO_DUMP=1                  # dump each utterance as a WAV for offline STT A/B

# Scripted doubles — replace the real engines; used by the e2e suite
BINGBONG_VAD_SCRIPT='[0.01, 0.99]'     # VAD probabilities
BINGBONG_STT_SCRIPT='["…"]'            # transcripts
BINGBONG_WAKE_SCRIPT='[0.01, 0.99]'    # wake scores (object form scripts each head)
```

## Kiosk deployment

The appliance ships as a container (ADR 0023) — full voice loop, real
screen, one command, no downloads on the kiosk:

```sh
cp .env.example config/.env   # fill the keys
scripts/kiosk-setup.sh        # diagnose-only preflight
docker compose up --build -d
```

Run it inside the kiosk's X session (`xhost +local:` grants the container
access to the screen). X11 and the PulseAudio socket are passed through, so
the dashboard renders on the physical screen and mic/speakers work
unchanged. Every model — Silero VAD, openWakeWord, the custom wake heads,
Moonshine Small, the Piper voice — is baked into the image and seeded into
`./data` on first boot. All durable state (Browser Profile, Settings,
downloads) lives in `./data`: delete it for a fresh start, copy it to
migrate.

## Observability

Every turn is perf-logged, zero config: one JSONL span per finished stage
(STT, each browser action, TTS), keyed by a `turnId` shared with the event
stream, written to a rotating `logs/` dir under the profile.
`pnpm perf:report` aggregates per-stage latency percentiles and, on this
branch, the Reaction p50/p95 per Command verb with the decision log beside it;
`BINGBONG_BROWSER_SUBSPANS=1` drills into browser actions; see
`docs/stt-latency.md` and `docs/moonshine-ab.md` for measured results.

`BINGBONG_AUDIO_DUMP=1` writes every detected utterance to `audio-dumps/`
under the profile as a 16 kHz mono WAV — the artifact shape offline STT
benchmarks replay. Replay them against the shipped engine with
`pnpm stt:replay`.

## Architecture

One seam: a text command goes into a `CommandRunner`
(`src/main/run/commandRunner.ts`) and a typed event stream comes out
(`src/core/pipeline/events.ts`) — the command, its stages, each browser
action and its outcome, what was shown and said, and its end. The voice
pipeline and the dashboard sit above it; the browser controller, TTS, STT
and the Decision Model sit below it behind interfaces in `src/core/ports`,
with pure test doubles in `src/core/testing`.

```
src/
  main/        Electron main process
    browser/   the pane, the CDP controller, the in-page collector, adblock, downloads
    run/       the command seam: runner + IPC (the agent goes here)
    decision/  Jev — the Decision Model adapter and its scripted stand-in
    voice/     Silero VAD adapter, scripted doubles, voice IPC, learned terms
    moonshine/ streaming Moonshine STT engine + model fetch
    wake/      openWakeWord heads (Node) and the Python sidecar
    tts/       piper → aplay, ducking the pane
    panel/     the feed panel's native overlay view
    cli/       the terminal REPL over the browser controller
  preload/     contextBridge preload
  renderer/    React dashboard (toolbar, browser pane, feed panel + prompt bar, settings)
  core/
    browser/   snapshot numbering, page text, action-outcome classifiers, fingerprints
    pipeline/  event types, run progress, tool-call display (the seam's vocabulary)
    ports/     interfaces for browser, decision model, TTS, STT, wake, clock
    voice/     VAD endpointing, voice session (the ears' seam)
    feed/      the feed projection the dashboard and the panel share
    testing/   test doubles (fake browser, fake clock, fake STT/VAD/wake)
```

Domain language and architectural decisions: `CONTEXT.md`, `docs/adr/`
(the ADRs are `main`'s history; many describe machinery this branch removed).

## Development

```sh
pnpm dev        # launch the app in dev mode
pnpm test       # unit suite (plus the headless-Chrome collector tests when a Chrome is installed)
pnpm test:e2e   # e2e suite (wraps vitest in Xvfb — never against a real display)
pnpm typecheck  # tsc over main/preload/core + renderer + scripts
pnpm lint       # eslint
pnpm build      # production build to out/
pnpm cli        # the browser CLI harness
pnpm perf:report  # per-stage latency percentiles, Reaction per verb and the decision log
pnpm stt:replay   # replay utterance dumps through the shipped STT engine
pnpm shot         # regenerate docs/screenshot.png (launches the app under Xvfb)
```
