# Containerized kiosk deployment

Bing Bong is deployed to the kiosk (the Hardware Floor machine) as a Docker
appliance: `docker compose up --build -d` on the box, with the X11 socket and
the PulseAudio unix socket passed through so the dashboard renders on the
kiosk's physical screen and the full voice loop (mic in, TTS out) works
unchanged. The container runs as `1000:1000` to match the socket-owning host
user; all durable state (Browser Profile, Settings, models, history,
downloads) lives in one `./data` bind mount (`HOME=/data`,
`BINGBONG_USER_DATA_DIR=/data/.config/bingbong`) — fresh start is deleting the
directory, migration is copying it. Model assets (Silero VAD, openWakeWord
melspectrogram/embedding, the three custom-trained wake heads, Moonshine
small, the Piper voice) are baked into the image and seeded into `./data`
copy-if-missing at boot (`src/main/kiosk/seed.ts`), so the first voice command
works with no downloads. The image builds locally — no registry — and the GPU
is passed through with the existing crash-loop guard as the software-rendering
fallback.

## Considered options

- **Xvfb + VNC inside the container** — rejected: the dashboard would only be
  "visible" through a mirror, straining the On-Screen Principle, and it adds
  latency on a machine that has a real screen.
- **PulseAudio over TCP** — rejected: needs host-side module loading (setup
  hassle) and is unauthenticated localhost TCP; the unix socket + UID match
  needs zero host setup.
- **`env_file:` in compose** — rejected: it injects the routing as *process*
  environment, which overrides the settings page's saved values and breaks the
  Env File layering. The file is bind-mounted read-only at `/app/.env`
  instead.
- **Registry pull** — rejected for now: one kiosk, no publish infra; the
  compose file switches to an `image:` reference without other changes if one
  appears.

## Consequences

- Linux-only, and tied to a UID-1000 host user (`compose.yaml` must be edited
  for another UID).
- Electron runs with `--no-sandbox` inside the container (Chromium's
  user-namespace sandbox is unavailable there; the app already runs its
  renderer with `sandbox: false`).
- The wake heads are custom-trained with no download source; they are
  committed under `docker/models/wake/` and `scripts/kiosk-setup.sh` stages
  them from an existing install when missing.
- `scripts/kiosk-setup.sh` is diagnose-only for the host (it never mutates the
  machine). Its two repo-local conveniences — creating `./data` before docker
  can create it root-owned, and staging the wake heads — touch only the repo.
