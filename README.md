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
  `screenshot`, `back`, `reload`, `resume` (the last page, reopened after a
  restart). Every action's outcome names what happened on the
  page — a blocker, a consent wall, a covered click, an empty or not-found
  landing — in one line. From the keyboard, wherever focus is,
  `Ctrl/Cmd+R` or `F5` reloads the page and `Alt+←/→` (`Cmd+[`/`]` on
  macOS) steps it back and forward; no key reloads, zooms or closes the
  app itself.
- **A direct command runner, for now.** Commands in the CLI grammar above
  run straight against the browser and show in the feed. This is the seam
  the Jev-driven agent replaces (`src/main/run/commandRunner.ts`).
- **Handles the annoying web.** Cookie/consent walls are auto-dismissed;
  native JS dialogs are auto-dismissed and reported; `window.open` popups are
  closed with their URL reported; an embedder-level adblocker runs on the
  pane's partition; agent-initiated downloads land in
  `~/Downloads/bingbong_downloads/` and are announced.

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
Nothing is installed by hand: the small models ship with the app and the
rest fetch themselves on first launch.

## Voice models

Shipped with the app and read in place (`models/` in the repo,
`resources/models` in the AppImage, ADR 0090), about 7 MB:

- **Silero VAD** (`silero_vad.onnx`; `BINGBONG_VAD_MODEL` overrides).
- **Wake models** — the openWakeWord front end (melspectrogram → speech
  embedding, v0.5.1 release assets) and the three custom heads in
  `models/wake/`, which have no other source. They run fully in Node via
  onnxruntime-node, one classifier per head: "bing bong" wakes, "stop now"
  aborts. Silero VAD gates the scores against music/noise false positives;
  the settings-page threshold slider applies live. The parity write-up:
  `docs/wake-parity.md`.

Fetched into `<userData>` (`~/.config/bingbong` on Linux) on first launch,
in the background, each to a `.part` file renamed when whole and retried on
the next use if the network fails:

- **Parakeet STT**, the default (~660 MB; the Moonshine tiers, Small, Base
  and Medium, are the lighter choice on the settings page) — a fetch
  failure surfaces as an STT error on the first spoken command, not a
  startup crash.
- **Piper** — the binary from rhasspy/piper's Linux x86_64 release into
  `piper/`, and the `en_GB-alba` voice into `voices/`. A
  `BINGBONG_PIPER_BIN` of your own skips both: it brings its own voices.

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

Keys may also live in the `.env` file (read once at boot): next to the app
in a checkout, `<userData>/.env` (`~/.config/bingbong/.env`) in the
installed AppImage, whose own files are read-only. Settings › Environment
edits it. Precedence is `.env` < process environment; the Piper, voice and
wake lines in it apply at the next start.

### Environment variables

```sh
BINGBONG_ENV_FILE=…                    # load .env from another path
BINGBONG_IDLE_TIMEOUT_MS=…             # idle screen timeout (default 5 min)
BINGBONG_KIOSK=1                       # kiosk mode, as --kiosk (process env only, not the .env)

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

The kiosk runs the app on the host as an AppImage (ADR 0090), never in a
container. On the kiosk (Debian, i3), from a checkout or with the script
alone:

```sh
scripts/kiosk-install.sh            # the latest Release from GitHub
```

It installs `libfuse2t64` if missing (the AppImage runtime needs FUSE 2,
so it asks for sudo once), puts the AppImage at
`~/.local/bin/bingbong.AppImage`, writes the user service
`bingbong.service` (`--kiosk`, `Restart=on-failure`), and adds the line
that starts it to `~/.config/i3/config`:

```
exec --no-startup-id "systemctl --user import-environment DISPLAY XAUTHORITY; systemctl --user start bingbong.service"
```

i3 starts no graphical-session target, so this line is what hands the
service the display. Run inside the session, the script starts the service
at once; otherwise it starts at the next i3 login. After that the only steps
by hand are the Jev key, `TYPESAFE_API_KEY`, and, if the kiosk keeps its logs
in the Log Bucket (below), its lines, both in Settings › Environment. At
boot the app checks for `aplay`, a microphone and a display; anything
missing is a line in the fault log and under Settings › This computer.

`journalctl --user -u bingbong` shows the service; `systemctl --user
restart bingbong` restarts the app.

**Releases.** `pnpm dist` builds the AppImage locally (`dist/`), and
`scripts/kiosk-install.sh dist/bingbong-*.AppImage` installs that build. A
Release is built only from the `production` branch, which only
fast-forwards to commits already on `main`: `pnpm release [commit]`
(default `origin/main`) pushes it, and the Release workflow runs the
typecheck and the unit suite, then publishes the AppImage as `0.1.<run>`.
The kiosk checks for a newer Release every hour, downloads it in the
background, and installs it only while the Idle Screen is up; the service
starts the new version.

## The Log Bucket (optional)

The app deletes log files older than 7 days. On a machine that names itself
with `BINGBONG_LOG_MACHINE`, the app also copies its logs dir, `ask-images/`
included, to a Cloudflare R2 bucket under `<bucket>/<machine>/` every 5
minutes, from its own main process: no extra program, no new dependency. It
only ever copies: nothing the app purges is deleted from the bucket. The
bucket is never listed to decide what to send; at start each file is checked
once, and from then on only files that changed are uploaded, so the requests
stay far inside R2's free tier at any load. Once a day it measures the
bucket; over 8 GB it deletes this machine's oldest uploads until the bucket
is under 7 GB, so storage stays inside the free tier's 10 GB.

Setup is the "Log Bucket" block of `.env.example`, with:

- **an R2 API token** you create in the Cloudflare dashboard with Object
  Read & Write on this bucket only (a private bucket that holds only logs);
- **a billing notification** on the Cloudflare account, as the backstop:
  going over the free tier is billed, not blocked.

On the kiosk the lines, with `BINGBONG_LOG_MACHINE=kiosk`, go in Settings ›
Environment, which saves them to the packaged app's `.env`,
`~/.config/bingbong/.env`. The settings are read at boot, so restart the app
after changing them (`systemctl --user restart bingbong`); with
them partly set it prints one line naming what is missing. The logs are not
encrypted; their privacy rests on the private bucket and the scoped token.

On the dev PC, the same lines without `BINGBONG_LOG_MACHINE` (so the dev
PC's own logs are never sent) let you pull a machine's folder:

```sh
pnpm logs:pull [machine] [dir]   # default: kiosk → kiosk-logs/kiosk
pnpm perf:report kiosk-logs/kiosk
```

`jev:candidates`, `jev:case` and the bugs scripts read that folder too.

## Monitor brightness (ddcutil, optional)

Night Dim (Settings › Idle screen › Screen) works with nothing installed: it
lays a black veil over the Idle Screen, so the pixels darken but the
monitor's backlight stays at full. Turning the monitor's own brightness
down at night, which is darker and saves power, goes over DDC/CI, the
monitor's control channel on the video cable. It does not depend on X11 or
Wayland. It needs:

- **ddcutil** (2.x), the DDC/CI client: `sudo apt install ddcutil`
  (Debian 13 ships 2.2).
- **The `i2c-dev` kernel module**, which exposes the GPU's I²C buses as
  `/dev/i2c-*`. Load it now and at every boot:
  ```sh
  sudo modprobe i2c-dev
  echo i2c-dev | sudo tee /etc/modules-load.d/i2c-dev.conf
  ```
- **Access to `/dev/i2c-*` without root.** ddcutil 2.x installs a udev rule
  (`60-ddcutil-i2c.rules`) that grants it to the user logged in at the
  screen. Unplug and replug the monitor or reboot after installing. If
  `ddcutil detect` still says permission denied, use a group instead:
  ```sh
  sudo groupadd --system i2c
  sudo usermod -aG i2c "$USER"
  echo 'KERNEL=="i2c-[0-9]*", GROUP="i2c", MODE="0660"' | sudo tee /etc/udev/rules.d/45-i2c.rules
  sudo udevadm control --reload && sudo udevadm trigger   # then log out and in
  ```
- **DDC/CI switched on in the monitor's own menu** (OSD). Most monitors
  have it on; some call it "DDC/CI" under System or Setup.
- **A GPU output that carries DDC.** A port on the graphics card (amdgpu,
  i915 and nouveau all do) works. A DisplayLink or other USB dock output
  does not, and neither do most KVM switches. NVIDIA's proprietary driver
  may need `options nvidia NVreg_RegistryDwords=RMUseSwI2c=0x01;RMI2cSpeed=100`
  in `/etc/modprobe.d/`.

Check it end to end:

```sh
ddcutil detect                  # lists the monitor with its I2C bus, e.g. /dev/i2c-5
ddcutil getvcp 10               # current brightness (VCP feature 0x10)
ddcutil setvcp 10 40            # set 40 %; each call takes about 0.1–0.5 s
```

On the kiosk this is host setup like any other; how the kiosk is installed
is #419.

Then pick the monitor: **Settings › Screen › Monitor** lists what
`ddcutil detect` finds, by model and connector ("PHL 325E1 · HDMI-A-1").
The choice is kept by model and connector, so it survives the I²C buses
renumbering; the list is read again each time Settings opens. The default,
*Veil only*, never calls ddcutil.

With a monitor picked, the Idle Screen inside the night window turns that
monitor's own brightness down to the slider's share of its day level (40 %
of 40 is 16) and draws no veil. Waking the dashboard, the window ending and
quitting the app put the day level back. Before lowering, the day level is
written to `night-dim.json` in the app's data directory; if the app dies at
night, the next start restores it from there. If ddcutil is missing, the
monitor does not answer, or it is already at 0, the veil dims as before.
The Monitor field says why, and a failed call is in `faults-*.jsonl`. Each
call is bounded at 3 s.

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
    parakeet/  Parakeet STT, the default engine
    moonshine/ streaming Moonshine STT engine + the model fetch every engine shares
    wake/      openWakeWord heads (Node) and the Python sidecar
    tts/       piper → aplay, ducking the pane; Piper's first-launch install
    update/    the updater: hourly check, install at the Idle Screen
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
