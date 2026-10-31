#!/usr/bin/env bash
# Runs a command with no route out (#533): an empty network namespace with
# loopback up, as the caller's own uid. No default e2e test needs a host, so a
# red or green cannot hang on the network and a run spends no bandwidth.
#
#   e2e/bin/no-network.sh <cmd...>
#
# A live gate's variable lets the command out, since reaching the host is its
# point. BINGBONG_E2E_NET=1 does too, says so, and is for a machine whose
# kernel refuses the namespace. Anything else that cannot cut the route stops:
# a silent run with the network is the gap this closes.
set -u

for live in BINGBONG_YOUTUBE_E2E BINGBONG_PLAY_TIMING BINGBONG_APPLIANCE_LIVE BINGBONG_MEDIA_OPS_LIVE BINGBONG_APPLIANCE_SPEED; do
  if [ -n "${!live:-}" ]; then exec "$@"; fi
done

if [ -n "${BINGBONG_E2E_NET:-}" ]; then
  echo 'no-network: BINGBONG_E2E_NET is set, so this run HAS the network.' >&2
  exec "$@"
fi

if ! unshare -Urn true; then
  echo 'no-network: this kernel refuses an unprivileged network namespace, so the route cannot be cut.' >&2
  echo 'no-network: allow it with sysctl kernel.unprivileged_userns_clone=1 (user.max_user_namespaces above 0; on Ubuntu kernel.apparmor_restrict_unprivileged_userns=0),' >&2
  echo 'no-network: or run with the network on purpose: BINGBONG_E2E_NET=1.' >&2
  exit 1
fi

# The ids are taken out here: inside the first unshare the caller is uid 0.
# The second unshare maps back, since Chromium will not run its sandbox as 0.
export UID_OUT GID_OUT BINGBONG_E2E_NO_NETWORK=1
UID_OUT=$(id -u)
GID_OUT=$(id -g)
exec unshare -Urn bash -c 'ip link set lo up && exec unshare -U --map-user="$UID_OUT" --map-group="$GID_OUT" "$@"' -- "$@"
