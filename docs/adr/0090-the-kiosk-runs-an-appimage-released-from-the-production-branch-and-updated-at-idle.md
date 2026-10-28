# The kiosk runs an AppImage released from the production branch and updated at idle

Amended on 2026-10-27 by #422: the owner's "update" installs a Release
already downloaded at once, past the Idle Screen's gate; see the amendment
below.

The Docker deployment (ADR 0023) is gone by the owner's ruling, 2026-10-24:
the project never uses containers. The kiosk runs the app on the host
(#419).

We decided that the kiosk runs an AppImage built by electron-builder, the
one packaging tool, whose targets include the `.dmg` the public Mac build
will need. The models no download source serves, and the ones small enough
not to matter (Silero VAD, the openWakeWord front end, the wake heads, about
7 MB), ship inside it. Everything larger (speech-to-text, the Piper binary
and its voice) downloads on first launch, so the download stays small and
nothing is installed by hand. Settings live in `<userData>/.env`, because
the app's own path is read-only.

A Release is built only from the `production` branch, which only
fast-forwards to commits already on `main`. Pushes to `main` happen many
times a day and the kiosk should not follow each one. The kiosk checks for
a Release every hour and installs it only while the Idle Screen is up, so
an update never cuts off a command. Agents push `production` only on the
owner's word in the turn.

On i3, which starts no graphical-session target, the kiosk's i3 config
starts a systemd user service, which restarts the app if it crashes.

## Considered options

- **A .deb or a plain checkout:** a .deb has no update channel without an
  apt repo, and a checkout needs the whole toolchain on the kiosk.
- **Shipping every model:** about 200 MB, and the kiosk is always online
  anyway, since Jev is remote.
- **A Release on every push to `main`:** rejected by the owner as overkill.
- **An XDG autostart entry:** nothing restarts the app after a crash.

## Amendment 2026-10-26 — a stop quits the app alone, before the mount goes (#434)

A stop of the unit took systemd's full 90 s and ended in SIGKILL, or the
main process died of SIGBUS within a second of the stop and took 52–64 s to
write its core. There were 1.7 GB of core dumps on the disk. Two facts were
behind it:

- **Chromium moves the main process out of the unit.** About 1 s after
  start it creates a transient `app-bingbong-<pid>.scope` over D-Bus and
  moves the browser's main process into it. The unit's cgroup keeps the
  AppImage runtime (the FUSE server) and Chromium's children.
- **The AppImage runtime unmounts the moment the app exits**, not when the
  stop ends: a 20 ms poll found the mount gone 41 ms after the app's exit.
  Under the default `KillMode=control-group` the runtime got SIGTERM along
  with the app, so the squashfs left from under the quitting app
  (`BUS_ADRERR` in its own text). Chromium's crashpad handler is reparented
  to the user manager, so the app's quit does not end it, and it faulted on
  the dead mount after a clean app exit (1 stop in 4).

**The unit stops the app, not its cgroup.** `ExecStop` (written by
`scripts/kiosk-install.sh`) first TERMs every process running from the mount
whose parent is outside the app (the crashpad handler) and waits up to 2 s.
It then TERMs the app and waits for it, then waits up to 5 s for every
process the unit held when the stop began; the runtime unmounts and exits on
its own. `KillMode=mixed` then finds nothing left to SIGKILL, and
`TimeoutStopSec=15` bounds the whole stop.

**The app bounds its own quit at 5 s** from the first `before-quit`
(`src/main/quitBound.ts`). Past it, the app calls `app.exit(0)` and records
an `app.quitBound` fault naming the last step reached. **The 5 s is a
guess.** On the kiosk the quit reached `exit` in 14–29 ms, so no record
has come near the bound yet; a `bound-passed` record would settle it. A quit
from the OS runs no hook takeover. Night dim's restore runs only for the
app's own quit, and the next boot restores what it would have. The ONNX
sessions, the voice process and CDP are not released on quit; process exit
frees them.

Arms, built AppImage on Xvfb under a transient user unit (2 CPUs, 120 %
quota), the crashpad handler present at every stop: TERM the app, wait,
`sleep 1` (handler alive on a dead mount 1 of 3 plain, 5 of 5 held); TERM
the app, then wait for all but the runtime (5 of 5 held, 7 SIGKILLs);
handler first, then the app, then every process the unit held: 0 of 10, 0
SIGKILLs, 269–555 ms. The last arm landed (279e650a). Kiosk, six stops on
2026-10-26: 0.47–0.60 s each, no core dumps, no new dead mounts. Before
that, stops took 52–90 s with a SIGBUS per stop.

`LimitCORE` is left unset (systemd's default, infinity). With the SIGBUS
gone there are no cores to drop.

**Read the kiosk's journal by identifier:**
`journalctl --user -t bingbong.AppImage`. `-u bingbong` shows only the
first ~2 s of the main process's lines, before the move into the scope. A
milestone that must be seen, however the journal is filtered, goes to the
perf log (the codec probe's settle, ADR 0079).

Considered:
- **Extracting the AppImage** so there is no mount to lose: ruled out by
  the orchestrator.
- **`KillMode=mixed` alone**: no crash, but 5 of 7 stops left a dead FUSE
  mount.

## Amendment 2026-10-27 — the owner's update installs now (#422)

"Update yourself", "check for updates" and the like are an app op on the
Appliance Card (ADR 0096), offered there alone. A sure pick asks the feed
for a newer Release and says one fixed Answer:

- **A Release already downloaded** installs past the Idle Screen's gate
  once "Installing version X, back in a moment." has been said. The line
  is itself the owner asking (owner's ruling, 2026-10-24).
- **A Release found but not yet downloaded** downloads, and installs at
  the Idle Screen as the hourly check's does: "Downloading version X; it
  installs when the screen is idle." This is a guess, the arm cheapest to
  reverse; the owner's first live "update" that lands on downloading
  settles it.
- **No newer Release:** "Up to date, version X."
- **Not the installed AppImage:** "Updates only run in the installed app."
- **A check that fails or does not answer in 8 s:** "Couldn't check for
  updates." Each such check reports a fault (`update.checkNow`). The 8 s
  (`CHECK_NOW_WAIT_MS`) is a guess; the first live checks' spans settle it.

A later line before the install, `stop` among them, keeps the app running.
This is also a guess.
