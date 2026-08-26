#!/bin/sh
# Bing Bong kiosk preflight (ADR 0023). Diagnose-only for
# the host: every check prints PASS, FAIL, or WARN plus the fix; nothing on
# the host is ever modified. The one repo-local convenience: wake heads have
# no download source, so they are staged from an existing install when found.

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
failures=0

pass() { printf "${GREEN}PASS${NC}  %s\n" "$1"; }
fail() { printf "${RED}FAIL${NC}  %s\n" "$1"; printf "      fix: %s\n" "$2"; failures=$((failures + 1)); }
warn() { printf "${YELLOW}WARN${NC}  %s\n" "$1"; printf "      note: %s\n" "$2"; }

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root" || exit 1

echo "== Bing Bong kiosk preflight =="

# --- compose files ---------------------------------------------------------
if [ -f compose.yaml ]; then pass "compose.yaml present"; else fail "compose.yaml missing" "run from the repo root"; fi
if [ -f Dockerfile ]; then pass "Dockerfile present"; else fail "Dockerfile missing" "run from the repo root"; fi

# --- host tooling ----------------------------------------------------------
command -v docker >/dev/null 2>&1 && pass "docker present" \
  || fail "docker not found" "install Docker Engine"
docker compose version >/dev/null 2>&1 && pass "docker compose present" \
  || fail "docker compose not present" "install the compose plugin"

# --- UID contract (compose runs as 1000:1000) ------------------------------
uid=$(id -u)
[ "$uid" = 1000 ] && pass "current user is UID 1000" \
  || warn "current user is UID $uid, container runs as 1000:1000" \
    "X11/Pulse sockets owned by another UID will refuse the container; edit 'user:' in compose.yaml to match"

# --- config/.env -----------------------------------------------------------
if [ -f config/.env ]; then
  pass "config/.env present (mounted read-only at /app/.env)"
elif [ -f .env.example ]; then
  fail "config/.env missing" "mkdir -p config && cp .env.example config/.env, then fill in keys"
else
  fail "config/.env missing and no .env.example to copy" "create config/.env with your model routing"
fi

# --- display (X11 passthrough) --------------------------------------------
if [ -n "${DISPLAY:-}" ]; then
  xsock="/tmp/.X11-unix/X${DISPLAY#*:}"
  [ -S "$xsock" ] && pass "X11 socket $xsock present" \
    || fail "X socket $xsock not found" "run inside the X session that owns the display"
  if command -v xhost >/dev/null 2>&1; then
    if xhost 2>/dev/null | grep -q '^LOCAL:'; then
      pass "X server accepts local connections (xhost local)"
    else
      warn "X server may refuse the container's connections" \
        "run: xhost +local: (grants local connections to your X server)"
    fi
  else
    warn "xhost not available to verify X access" \
      "if the window fails to appear, run: xhost +local:"
  fi
else
  fail "DISPLAY not set" "run this script and docker compose from inside your X session"
fi

# --- audio (PulseAudio socket passthrough) ---------------------------------
pulse_sock="/run/user/1000/pulse/native"
[ -S "$pulse_sock" ] && pass "PulseAudio socket $pulse_sock present" \
  || fail "$pulse_sock not found" "a PipeWire/pulse session for UID 1000 must be running"

# --- GPU (optional; crash-loop guard is the fallback) ----------------------
[ -d /dev/dri ] && pass "/dev/dri present (GPU passed through)" \
  || warn "/dev/dri absent" "software rendering only; drop the devices: block in compose.yaml"

# --- data dir (bind mount; docker would create it root-owned) --------------
if [ ! -d data ]; then
  mkdir -p data
  pass "./data created (owned by $(id -un); docker compose would create it root-owned and the container could not write it)"
elif [ -w data ]; then
  pass "./data present and writable"
else
  fail "./data not writable by UID $(id -u)" "sudo chown -R $(id -u):$(id -g) data"
fi

# --- wake heads (custom-trained, no download source) -----------------------
staged=1
for head in bing_bong stop_now hold_on; do
  [ -s "docker/models/wake/$head.onnx" ] || staged=0
done
if [ "$staged" = 1 ]; then
  pass "wake heads staged in docker/models/wake/"
else
  local_heads="$HOME/.config/bingbong/models/wake"
  found=1
  for head in bing_bong stop_now hold_on; do
    [ -s "$local_heads/$head.onnx" ] || found=0
  done
  if [ "$found" = 1 ]; then
    printf 'staging wake heads from %s into docker/models/wake/ ...\n' "$local_heads"
    mkdir -p docker/models/wake
    cp "$local_heads/bing_bong.onnx" "$local_heads/stop_now.onnx" "$local_heads/hold_on.onnx" docker/models/wake/
    pass "wake heads staged (copied from an existing install — repo-local copy only)"
  else
    fail "wake heads not staged and none found in $local_heads" \
      "copy bing_bong.onnx, stop_now.onnx, hold_on.onnx into docker/models/wake/ (custom-trained; see docs/wake-parity.md)"
  fi
fi

# --- summary ----------------------------------------------------------------
echo
if [ "$failures" -gt 0 ]; then
  printf "${RED}%s check(s) failed.${NC} Fix them, then: docker compose up --build -d\n" "$failures"
  exit 1
fi
printf "${GREEN}All checks passed.${NC} docker compose up --build -d\n"
