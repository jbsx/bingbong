# Kiosk echo replay (#512, #515)

`pnpm speech:echo:kiosk` replays these through Electron in a closed room. Nothing sounds.

- `C100/mic.flac`: the raw C920 (32 kHz, mono, `parecord` beside the running app), first 125 s of `rec-512d-C-155940`, 2026-10-29 15:59. Nobody speaks; the app reads a page over "Good Morning". Sink at 100 %.
- `C100/monitor.flac`: the sink's monitor over the same 125 s (44.1 kHz stereo), which is what Chromium's echo canceller has as its reference.
- `owner-lines.flac`: 7.5 s of the raw C920 from `rec-512-20261029-142835` (64.5–72.0 s), the owner's own lines in the quiet before that read. The measure adds them to the mic at 3 s (alone) and at 40, 75 and 110 s (over the read), at +2.5 dB for the mic gain moving from 59 to 65 %.

The harsher rooms, the same read at sink 116 % (`A116`) and 146 % (`B146`), and the 14:28 take with the owner really talking over a read, stay outside the repo at 9 MB each (`BINGBONG_ECHO_TAKES`, default `~/rec-512-kit/takes`).
