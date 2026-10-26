# Wake pauses the run; the bare "hold on" head is unwired

## Status

Accepted

## Context

The always-on ear scored three trained heads — "bing bong" (wake), "abort",
and "hold on" — on every 80 ms chunk, gated only by recent VAD. In practice the
hold-on head fired constantly on nearby conversation and ambient noise: a weak
bare-speech recognizer with no wake-word corroboration is mostly false
positives, and each one parked the running Run into an unbounded pause listen —
wedging the kiosk until someone spoke.

## Decision

- **The Wake Word now pauses a running Run.** Saying "bing bong" (or pressing
  the hotkey) during a Run pauses it and opens the Pause Listen, replacing the
  bare "hold on" head as the pause path. The `hold_on` head stays trained and
  shipped but is no longer wired to anything.
- **The Pause Listen times out.** Five seconds of mic silence auto-resumes the
  Run, silently — only the Status Capsule changes. Speaking re-arms the window.
- **The abort head stays.** "stop now" keeps its bare-speech path; its
  false-positive risk is accepted until actually observed. Revisit this entry
  if it misfires.

## Considered Options

- **Harden the bare head** (echo gating, per-head thresholds, cooldowns) —
  rejected: the false fires were nearby speech and ambient noise, which gating
  doesn't fix; only a stricter trigger does.
- **Corroborated bare head** (head opens a candidate listen, transcript
  confirms) — rejected: wake-pauses-run achieves the same self-correction with
  one recognizer instead of two failure-prone ones.

## Consequences

- A false wake detection during a Run now costs a five-second pause instead of
  a wedged kiosk — the timeout is load-bearing, not cosmetic.
- Pausing over the assistant's own speech becomes "bing bong, hold on":
  wake first, then the directive in the Pause Listen.

## Amendment 2026-10-26 — the wake stack scores a chunk only while the VAD gate is open, and only the heads that can land (#435)

At rest on the kiosk the voice process (ADR 0093) took 15.8 % of one core
on its main thread. About 72 % of that went to the wake stack scoring audio
the VAD had already called silence. Each 80 ms chunk ran melspectrogram,
speech embedding and all three heads (62.5 ORT runs a second), and the gate
was applied only afterwards, to decide whether a score counted.

- **A chunk is scored only while the gate is open.** With the gate shut no
  head can fire, so the detector only keeps the chunk in a ring of the last
  26. When the gate opens, it reruns the melspectrogram over the last 25 and
  the embedding over the last 15, then scores. The depth is set by the
  model's windows: 23 backfilled chunks fail the equality test, 24 pass, and
  25 ship with one to spare. Every gate-open score equals, to the bit, what
  an ear that scored every chunk would give (`gatedWake.models.test.ts`,
  shipped models, max difference 0 for every head asked).
- **A head runs only when it can land.** The wake head always runs. The
  abort head (`stop_now`) runs only while a Command runs or a Hot Listen is
  open, the only times `interrupt()` acts. `hold_on` is never run (it fires
  nothing, above).
- **The wake models load when the ear opens**, at attach, not at the first
  scored chunk. Behind the gate, a quiet room put `wake-loaded`, `ready`
  and the STT preload behind the first sound: 119 s after a kiosk boot.
  With the load at attach, `ready` comes at boot again (582 and 528 ms
  under the e2e's silent fake mic).
- Each `cpu` record carries `wakeGate: { heard, scored }`, and
  `pnpm perf:report` prints the gate-open share. With
  `BINGBONG_AUDIO_DUMP`, a wake writes the ear's last ~2 s as
  `wake-<ms>-<seq>.wav`.

Measured (`pnpm wake:cpu`, ms of process CPU per s of audio, dev PC pinned
to 2 cores): silence 20.6–23.0 → 4.2–4.7, −60 dBFS hiss 20.4–25.4 →
4.0–5.7, 25 kiosk utterance dumps 19.6–21.2 → 16.4–17.2. Heads by need alone
moved nothing at rest, and about 0.6 ms/s on speech, at the edge of the
noise. In the e2e voice chain at rest, the voice process went from 2.9–3.2 %
to 1.0 % of a core, with spans unchanged or better (turn p95 186–200 →
153–169 ms).

Kiosk (b35b8718, 2026-10-26 02:20, at rest): the voice process went from
16.6 % to 4.8 % of one core, its main thread from 15.9 % to 4.4 %, and
Electron in total from 36.9 % to 26.0 %. The gate was open 0.2 % of the
time (13 of 7456 chunks scored). The Python sidecar has no skip and scores
every chunk as before.
