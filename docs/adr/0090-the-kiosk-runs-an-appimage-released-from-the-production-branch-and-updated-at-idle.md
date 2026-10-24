# The kiosk runs an AppImage released from the production branch and updated at idle

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
