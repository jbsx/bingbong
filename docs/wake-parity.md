# Wake-word parity: Node port vs the Python reference

The "bing bong" wake word and the "stop now" (abort) / "hold on" interrupt
heads run fully in Node (`src/main/wake/createOpenWakeWordDetector.ts`) — a
streaming
port of openWakeWord's ONNX inference pipeline. This document records what
the port does, where it intentionally deviates, and how parity is validated.

## The reference algorithm (openwakeword `utils.py` + `model.py`)

Per 1280-sample (80 ms) 16 kHz chunk:

1. **Melspectrogram** (`melspectrogram.onnx`, input `input`): the chunk plus
   a 480-sample lookback tail from the previous chunk, as int16-valued
   float32 (no normalization). Output is `(samples-480)/160` frames of 32 mel
   bins — 8 frames per steady-state chunk, 5 for the first chunk after a
   reset (no lookback yet). Rows are transformed by `x/10 + 2` and appended
   to a mel buffer that starts as 76 rows of ones (cap 970 rows).
2. **Speech embedding** (`embedding_model.onnx`, input `input_1`): the
   trailing 76×32 window, batched as `[1, 76, 32, 1]`, yields one 96-dim
   embedding per chunk, appended to the feature buffer (cap 120).
3. **Classifiers** (`wake/bing_bong.onnx`, `wake/stop_now.onnx`,
   `wake/hold_on.onnx`, each under its own first input name): the trailing
   16 embeddings as `[1, 16, 96]` → one score per head in 0..1. The three
   heads share the feature stack — melspec and embedding run once per chunk.
4. **Warmup suppression**: the first 5 chunks after a reset score 0 (the
   reference zeroes predictions while its prediction buffer fills).
5. **VAD gate**: the reference zeroes scores when its own Silero VAD's recent
   window is quiet.

The port implements 1–4 exactly; the fake-runtime unit tests
(`createOpenWakeWordDetector.test.ts`) pin every wire fact (input names,
shapes, lookback, int16 scaling, `x/10 + 2`, ones-init, warmup). A
real-models smoke test (`createOpenWakeWordDetector.models.test.ts`, runs
when the model files exist) drives the actual models and asserts sane,
deterministic, sub-threshold scores on a speech clip containing none of the
three phrases.

## Documented deviations

1. **Feature-buffer seed**: the reference seeds the embedding buffer with
   embeddings of 4 s of random noise; the port uses 16 zero rows. Both are
   garbage-during-warmup only — the classifier window is fully real after 16
   chunks (1.28 s), and the 5-chunk suppression covers the noisiest part.
2. **VAD gate shape**: the reference gates on `max(vad[-7:-4])` of its own
   VAD's 80 ms predictions (~0.32–0.56 s before the detection). The port
   reuses the session's shared Silero instance instead of loading a second
   one, gating on the max of the trailing 16 × 32 ms frames (~0.5 s). Same
   intent — speech must be present around the scored audio — tuned window.
3. **Multi-chunk `score()`**: like the reference's group prediction, the port
   scores each 80 ms sub-chunk and returns the max. The monitor only ever
   feeds single chunks, so this path exists for completeness.

## Validating parity

`src/main/wake/wakeParity.integration.test.ts` runs the same 16 kHz s16le
mono WAV through both engines chunk by chunk and compares score sequences
(max |Δ| < 0.05 after warmup; identical above-threshold frame sets). It is
skipped unless invoked with:

```sh
pip install openwakeword onnxruntime   # the reference, for the sidecar
BINGBONG_WAKE_PARITY_CLIP=~/.config/bingbong/models/jfk.wav \
  npx vitest run src/main/wake/wakeParity.integration.test.ts
```

The Python sidecar engine (`BINGBONG_WAKE_ENGINE=python`) *is* the reference
implementation behind the same `WakeWordDetector` seam, so production parity
on that engine is by construction; VAD gating lives above the seam
(`wakeMonitor`) and is shared identically by both engines.

## Models

The shared feature stack comes from the openWakeWord v0.5.1 release assets,
into `<userData>/models`:

```sh
cd ~/.config/bingbong/models
curl -LO https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/melspectrogram.onnx
curl -LO https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/embedding_model.onnx
```

The three heads are custom-trained (openWakeWord Colab notebook, one
training run) and land in `<userData>/models/wake/` as `bing_bong.onnx`,
`stop_now.onnx`, and `hold_on.onnx`. Paths are overridable via
`BINGBONG_WAKE_MODEL`, `BINGBONG_WAKE_ABORT_MODEL`, and
`BINGBONG_WAKE_HOLD_ON_MODEL`. The Python sidecar engine scores the wake
head only; the node engine runs all three.

Known training gap (Aug 2026 run): the interrupt heads spike on some
speech *onsets* — `hold_on` ≈ 0.99 for 2–3 chunks when speech starts
after silence, decaying to ~0 while speech continues, and `stop_now` ≈
0.54 on the same clip (`bing_bong` peaks at 0.19). Idle false-fires are
no-ops (the session gates interrupts on an active run), but mid-run a
speech onset can read as "hold on" (and "cancel that please" scores 0.99
on the `stop_now` head). The threshold can't separate onset transients
from the real phrases — the fix is retraining with onset-heavy negatives,
not retuning.
