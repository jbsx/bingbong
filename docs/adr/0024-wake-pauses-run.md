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
