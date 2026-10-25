#!/bin/sh
# Installs Bing Bong on the kiosk (#419, ADR 0090): the AppImage where the
# updater can replace it, a systemd user service that restarts it, and the
# i3 line that starts the service with the display. Run it again to reinstall;
# every step is idempotent.
#
#   scripts/kiosk-install.sh                      # the latest Release from GitHub
#   scripts/kiosk-install.sh dist/bingbong-*.AppImage   # a local build (pnpm dist)
#
# Overridable for a dry run on another machine: BINGBONG_APPIMAGE (where the
# AppImage goes), BINGBONG_SERVICE (the unit's name), I3_CONFIG.
set -eu

REPO=jbsx/bingbong
APPIMAGE=${BINGBONG_APPIMAGE:-$HOME/.local/bin/bingbong.AppImage}
SERVICE=${BINGBONG_SERVICE:-bingbong}
I3_CONFIG=${I3_CONFIG:-$HOME/.config/i3/config}
UNIT_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
# The app exits with this after installing an update at the Idle Screen
# (src/main/update/attachUpdater.ts): start the new version.
RELAUNCH_EXIT_CODE=75

say() { printf '%s\n' "kiosk-install: $*"; }

# The AppImage runtime mounts itself with FUSE 2 (it dlopens libfuse.so.2).
if ! /sbin/ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2 '; then
  say "installing libfuse2 (the AppImage runtime needs it)"
  sudo apt-get install -y libfuse2t64 || sudo apt-get install -y libfuse2
fi

# Hardware video decode (#425): Chromium decodes through VA-API, which needs
# the GPU's driver. iHD covers the kiosk's Kaby Lake (HD 630); vainfo shows
# what it decodes.
if ! dpkg -s intel-media-va-driver vainfo >/dev/null 2>&1; then
  say "installing intel-media-va-driver and vainfo (hardware video decode)"
  sudo apt-get install -y intel-media-va-driver vainfo
fi

# The AppImage: a fixed name with no version in it, so the updater replaces
# this same file in place.
mkdir -p "$(dirname "$APPIMAGE")"
if [ $# -ge 1 ]; then
  say "installing $1"
  cp "$1" "$APPIMAGE.part"
else
  url=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"browser_download_url": *"\([^"]*\.AppImage\)".*/\1/p' | head -n 1)
  [ -n "$url" ] || { say "no AppImage in the latest Release of $REPO"; exit 1; }
  say "downloading $url"
  curl -fL --retry 3 -o "$APPIMAGE.part" "$url"
fi
chmod +x "$APPIMAGE.part"
mv -f "$APPIMAGE.part" "$APPIMAGE"

# The user service: restarts the app if it crashes, and starts the new
# version after an update.
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$SERVICE.service" <<EOF
[Unit]
Description=Bing Bong (kiosk)

[Service]
ExecStart=$APPIMAGE --kiosk
Restart=on-failure
RestartSec=2
# An update installed at the Idle Screen exits $RELAUNCH_EXIT_CODE: not a failure, and started again.
SuccessExitStatus=$RELAUNCH_EXIT_CODE
RestartForceExitStatus=$RELAUNCH_EXIT_CODE
EOF
systemctl --user daemon-reload
say "wrote $UNIT_DIR/$SERVICE.service"

# i3 starts no graphical-session target: its config hands the display to the
# user manager and starts the service.
I3_LINE="exec --no-startup-id \"systemctl --user import-environment DISPLAY XAUTHORITY; systemctl --user start $SERVICE.service\""
mkdir -p "$(dirname "$I3_CONFIG")"
touch "$I3_CONFIG"
if grep -qF "systemctl --user start $SERVICE.service" "$I3_CONFIG"; then
  say "$I3_CONFIG already starts $SERVICE.service"
else
  printf '\n# Bing Bong (scripts/kiosk-install.sh)\n%s\n' "$I3_LINE" >> "$I3_CONFIG"
  say "added the start line to $I3_CONFIG"
fi

# Started now when run from inside the session; otherwise at the next i3 login.
if [ -n "${DISPLAY:-}" ]; then
  systemctl --user import-environment DISPLAY XAUTHORITY 2>/dev/null || systemctl --user import-environment DISPLAY
  systemctl --user restart "$SERVICE.service"
  say "started $SERVICE.service"
else
  say "no display here: $SERVICE.service starts at the next i3 login"
fi
say "done. The Jev key goes in Settings › Environment (TYPESAFE_API_KEY)."
