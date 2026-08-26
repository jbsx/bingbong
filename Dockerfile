# Bing Bong kiosk image (ADR 0023). Built locally on the kiosk:
#   docker compose up --build -d
#
# Three stages:
#   builder — native deps + the electron-vite production build
#   assets  — the baked model/voice inventory, mirrored into the bind-mounted
#             userData dir on first boot by scripts/kiosk-seed.ts
#   runtime — Debian slim + Electron's shared libs + piper TTS + Node for the
#             seed/report scripts
#
# The asset layout below is a path contract with the app: models land in
# <userData>/models/{silero_vad,melspectrogram,embedding_model}.onnx,
# models/wake/*.onnx, models/moonshine-small/ (dest file names per
# src/main/moonshine/moonshineModels.ts), voices in <userData>/voices/
# (src/main/tts/piperConfig.ts). The wake heads are custom-trained with no
# download source — they are staged into docker/models/wake/ first
# (scripts/kiosk-setup.sh copies them from an existing install).

# --- builder ---------------------------------------------------------------
FROM node:26-bookworm AS builder
WORKDIR /app

# gcc on bookworm is 12; the flags are only required at gcc >= 14 but are
# harmless here and make the image portable to newer bases (README install
# notes).
ENV CFLAGS=-D_GNU_SOURCE CXXFLAGS=-D_GNU_SOURCE
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install -g pnpm@10.17.1 && pnpm install --frozen-lockfile
# pnpm 10 gates postinstall scripts behind onlyBuiltDependencies; make the
# Electron binary download explicit so the build cannot silently ship a
# broken node_modules/electron. Idempotent when it already ran.
RUN node node_modules/electron/install.js

COPY . .
RUN pnpm build

# --- assets ----------------------------------------------------------------
FROM debian:bookworm-slim AS assets
WORKDIR /assets
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

ENV SILERO_URL=https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx \
    OWW_URL=https://github.com/dscripka/openWakeWord/releases/download/v0.5.1 \
    MOONSHINE_SMALL_URL=https://huggingface.co/Immortalizer/moonshine-streaming-small-onnx/resolve/main \
    PIPER_VOICES_URL=https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium

RUN mkdir -p models/wake models/moonshine-small voices \
 && curl -fsSL -o models/silero_vad.onnx "$SILERO_URL" \
 && curl -fsSL -o models/melspectrogram.onnx "$OWW_URL/melspectrogram.onnx" \
 && curl -fsSL -o models/embedding_model.onnx "$OWW_URL/embedding_model.onnx" \
 && curl -fsSL -o models/moonshine-small/encoder_model.onnx "$MOONSHINE_SMALL_URL/encoder_model_quantized.onnx" \
 && curl -fsSL -o models/moonshine-small/decoder_model_merged.onnx "$MOONSHINE_SMALL_URL/decoder_model_merged_quantized.onnx" \
 && curl -fsSL -o models/moonshine-small/tokenizer.json "$MOONSHINE_SMALL_URL/tokenizer.json" \
 && curl -fsSL -o voices/en_US-ryan-medium.onnx "$PIPER_VOICES_URL/en_US-ryan-medium.onnx" \
 && curl -fsSL -o voices/en_US-ryan-medium.onnx.json "$PIPER_VOICES_URL/en_US-ryan-medium.onnx.json"

# minBytes floors mirror src/main/moonshine/moonshineModels.ts and the
# upstream release sizes: a truncated fetch fails the build instead of
# surfacing as a broken first voice command on the kiosk.
RUN bytes() { stat -c %s "$1"; } \
 && test "$(bytes models/silero_vad.onnx)" -ge 1000000 \
 && test "$(bytes models/melspectrogram.onnx)" -ge 1000000 \
 && test "$(bytes models/embedding_model.onnx)" -ge 1000000 \
 && test "$(bytes models/moonshine-small/encoder_model.onnx)" -ge 70000000 \
 && test "$(bytes models/moonshine-small/decoder_model_merged.onnx)" -ge 145000000 \
 && test "$(bytes models/moonshine-small/tokenizer.json)" -ge 3000000 \
 && test "$(bytes voices/en_US-ryan-medium.onnx)" -ge 10000000

# Custom-trained wake heads — no download source; staged by kiosk-setup.sh.
# Named explicitly so an unstaged head fails the build loudly.
COPY docker/models/wake/bing_bong.onnx \
     docker/models/wake/stop_now.onnx \
     docker/models/wake/hold_on.onnx \
     models/wake/
RUN test "$(stat -c %s models/wake/bing_bong.onnx)" -ge 10000 \
 && test "$(stat -c %s models/wake/stop_now.onnx)" -ge 10000 \
 && test "$(stat -c %s models/wake/hold_on.onnx)" -ge 10000

# --- runtime ---------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
WORKDIR /app

# Node 26 runs the seed/report scripts (type-stripping .ts imports) and
# node_modules/.bin/electron's cli.js.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_26.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
    libgtk-3-0 libnss3 libasound2 libpulse0 libxss1 libxtst6 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 \
    libgl1 libegl1 alsa-utils libasound2-plugins \
    fonts-liberation fonts-noto-color-emoji tzdata \
 && curl -fsSL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
      | tar -xz -C /opt \
 && ln -s /opt/piper/piper /usr/local/bin/piper \
 && piper --help >/dev/null \
 && apt-get purge -y curl gnupg && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Piper TTS note (rhasspy release is self-contained, espeak-ng-data included;
# not packaged in Debian — the Debian "piper" package is the mouse tool).
# The app plays piper's WAV via aplay (src/main/tts/createAplayPlayer.ts):
# alsa-utils provides the binary and the pulse plugin routes its default PCM
# through PulseAudio, which honors PULSE_SERVER from compose.

# aplay's default PCM → PulseAudio explicitly (the plugin alone does not
# register a default device on Debian); libpulse then honors PULSE_SERVER.
RUN printf 'pcm.!default { type pulse }\nctl.!default { type pulse }\n' > /etc/asound.conf

COPY --from=builder /app/out ./out
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=assets /assets /opt/bingbong/assets
COPY docker/entrypoint.sh /usr/local/bin/bingbong-entrypoint
COPY scripts/kiosk-seed.ts ./scripts/kiosk-seed.ts
COPY src/main/kiosk/seed.ts ./src/main/kiosk/seed.ts

# The kiosk host user is UID 1000 (compose runs the container as 1000:1000);
# owning /app matters only for anything Electron writes next to the app —
# all durable state lives in the /data bind mount (HOME=/data).
RUN useradd -u 1000 -m -s /bin/sh kiosk && chmod +x /usr/local/bin/bingbong-entrypoint
USER kiosk

ENV BINGBONG_BAKED_ASSETS_ROOT=/opt/bingbong/assets \
    BINGBONG_PIPER_BIN=/usr/local/bin/piper

ENTRYPOINT ["bingbong-entrypoint"]
