# STT latency on the 5600G — validation gate (T9)

Measured 2026-08-17 on the target machine (Ryzen 5 5600G, 12 SMT threads,
CPU-only) with `scripts/measure-stt-latency.mjs`, 6 threads (physical cores —
fastest of 4/6/8/12 measured), greedy decoding, model warm after first load.

| model | first load | 2 s utterance | 5 s utterance | 10 s utterance |
| --- | --- | --- | --- | --- |
| tiny.en | 66 ms | 2.85 s | 3.10 s | 3.12 s |
| base.en | 82 ms | 6.11 s | 6.48 s | 6.67 s |

Two facts drive the decision:

- **The cost is fixed, not per-second.** whisper.cpp encodes the full 30 s
  window for every utterance, so a 2 s command costs the same as a 10 s one
  (base.en: ~6.1 s vs 6.7 s). Utterance length discipline (VAD endpointing)
  buys little; model size buys everything.
- **base.en transcribes a full utterance in ~6 s regardless of length** (~1.5–
  1.7× realtime at 10 s, slower than realtime for very short commands because
  the fixed encode dominates), and every measurement stayed under 7 s
  end-to-end even while the machine ran a dev session.

## Decision

**Ship base.en as the default** (spec's choice, confirmed):

- ~6 s utterance→transcript fits the interaction: commands are single-shot,
  and the 12 s confirmation window leaves >5 s of margin for a spoken yes/no
  (0.8 s VAD tail + ~6 s STT).
- Accuracy on command phrasing (URLs, video names) is worth more than the
  ~3 s tiny.en would save; base.en clearly out-transcribes tiny.en on the
  sample material.

`BINGBONG_WHISPER_MODEL` (or the settings env layer) points at a different
ggml file — `ggml-tiny.en.bin` (~3 s turns) is the documented step-down if
response feel matters more than accuracy.

## Reproducing

```sh
# models live in ~/.config/bingbong/models (see README)
node scripts/measure-stt-latency.mjs
```
