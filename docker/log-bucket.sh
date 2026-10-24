#!/bin/sh
# The Log Bucket sidecar (#418): copies the kiosk's logs to the owner's R2
# bucket so they outlive the app's 7-day purge and can be read while the dev
# PC is off. Runs in the pinned rclone image beside `bingbong` (compose.yaml);
# nothing is installed on the host (ADR 0023).
#
#   log-bucket.sh run    the loop: copy every 5 min, the space check daily
#   log-bucket.sh copy   one copy of the files written in the last hour
#   log-bucket.sh trim   one space check
#   log-bucket.sh env    print the settings it loaded (diagnosis)
#
# Settings are read from the Env File (config/.env, mounted read-only), and
# only the log-bucket lines: BINGBONG_LOG_* and RCLONE_CONFIG_R2_*. The model
# keys in the same file never enter this process's environment. A value
# already in the environment (compose's BINGBONG_LOG_MACHINE) wins.
set -eu

ENV_FILE=${BINGBONG_LOG_ENV_FILE:-/config/.env}
SOURCE=${BINGBONG_LOG_SOURCE:-/logs}

say() { printf '%s log-bucket: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

load_env() {
  [ -r "$ENV_FILE" ] || return 0
  # One `KEY=value` per line; `export `, surrounding quotes and CRLF handled
  # as the app's own parser does (src/core/settings/dotEnv.ts).
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/^export[[:space:]]\{1,\}//')
    case $line in
      BINGBONG_LOG_*=* | RCLONE_CONFIG_R2_*=*) ;;
      *) continue ;;
    esac
    key=${line%%=*}
    case $key in *[!A-Za-z0-9_]*) continue ;; esac
    value=$(printf '%s' "${line#*=}" | sed -e 's/[[:space:]]*$//' -e "s/^'\(.*\)'\$/\1/" -e 's/^"\(.*\)"$/\1/')
    eval "already=\${$key+set}"
    [ "$already" = set ] || export "$key=$value"
  done < "$ENV_FILE"
}

load_env

BUCKET=${BINGBONG_LOG_BUCKET:-}
MACHINE=${BINGBONG_LOG_MACHINE:-}
HIGH_GB=${BINGBONG_LOG_BUCKET_HIGH_GB:-8}
LOW_GB=${BINGBONG_LOG_BUCKET_LOW_GB:-7}

# The whole bucket holds only logs (owner, 2026-10-24), so its size is the
# free tier's measure. Over the high mark, this machine's oldest files go
# until the bucket is under the low mark; another machine's are never touched.
trim() {
  bytes=$(rclone size "r2:$BUCKET" --json | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
  high=$(awk -v gb="$HIGH_GB" 'BEGIN { printf "%.0f", gb * 1e9 }')
  low=$(awk -v gb="$LOW_GB" 'BEGIN { printf "%.0f", gb * 1e9 }')
  if [ "$bytes" -le "$high" ]; then
    say "space check: $bytes bytes, under the $HIGH_GB GB mark"
    return 0
  fi
  list=$(mktemp)
  tab=$(printf '\t')
  rclone lsf -R --files-only --format tsp --separator "$tab" "r2:$BUCKET/$MACHINE" \
    | sort \
    | awk -F "$tab" -v total="$bytes" -v low="$low" 'total >= low { total -= $2; print $3 }' > "$list"
  count=$(wc -l < "$list" | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    rclone delete "r2:$BUCKET/$MACHINE" --files-from-raw "$list"
  fi
  rm -f "$list"
  say "space check: $bytes bytes over the $HIGH_GB GB mark; deleted $count of $MACHINE's oldest files"
}

configured() {
  [ -n "$BUCKET" ] && [ -n "$MACHINE" ] && [ -n "${RCLONE_CONFIG_R2_TYPE:-}" ]
}

# `copy`, never `sync`: the kiosk's own purge must never delete anything in
# the bucket. With --max-age and --no-traverse the bucket is never listed;
# only the few files written in the last hour are checked and uploaded, so
# the Class A count is fixed by the schedule, not the load.
copy() {
  rclone copy "$SOURCE" "r2:$BUCKET/$MACHINE/" --no-traverse "$@"
}

run() {
  if ! configured; then
    say "not configured (BINGBONG_LOG_BUCKET, BINGBONG_LOG_MACHINE and RCLONE_CONFIG_R2_* in config/.env); idle"
    # Asleep, not exited: restart: unless-stopped never spins.
    exec sleep 2147483647
  fi
  say "copying $SOURCE to r2:$BUCKET/$MACHINE/ every 5 min; space check daily (over $HIGH_GB GB, down to $LOW_GB GB)"
  # Once at start without the age limit: what was written while the sidecar
  # was down goes up too. Each file is checked, nothing already there re-sent.
  copy || say "catch-up copy failed; the 5-minute copies carry on"
  last_trim=0
  while :; do
    copy --max-age 1h || say "copy failed; next try in 5 min"
    now=$(date +%s)
    if [ $((now - last_trim)) -ge 86400 ]; then
      trim || say "space check failed; next try tomorrow"
      last_trim=$now
    fi
    sleep 300
  done
}

case ${1:-run} in
  run) run ;;
  copy) configured || { say "not configured"; exit 1; }; copy --max-age 1h ;;
  trim) configured || { say "not configured"; exit 1; }; trim ;;
  # The whole environment, the R2 secret masked: what the sidecar holds.
  env) env | sort | sed 's/^\(RCLONE_CONFIG_R2_SECRET_ACCESS_KEY\)=.*/\1=***/' ;;
  *) echo "usage: log-bucket.sh run|copy|trim|env" >&2; exit 2 ;;
esac
