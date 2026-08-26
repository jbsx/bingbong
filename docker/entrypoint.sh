#!/bin/sh
# Bing Bong kiosk entrypoint (ADR 0023): seed baked assets into the bind-
# mounted userData dir (copy-if-missing, atomic per file), then exec Electron
# as the appliance. --no-sandbox: Chromium's user-namespace sandbox is not
# available inside the container; the app already runs its renderer with
# sandbox: false. --kiosk is the app's own appliance mode (T11).
set -eu

node scripts/kiosk-seed.ts

exec ./node_modules/.bin/electron . --no-sandbox --kiosk
