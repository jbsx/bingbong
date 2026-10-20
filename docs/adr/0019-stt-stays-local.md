# ADR 0019: STT stays local

## Status

Accepted

## Context

The project is billed as a local voice pipeline, but that billing was an
artifact of how it was built, not a decided constraint — so it was put to a
real decision when STT quality became the blocking complaint. The target
machine (the Hardware Floor: a dual-core mobile-class i3-7100U with 4 GB RAM,
shared with the Electron/Chromium dashboard and the OS) cannot afford the
accuracy ladder's top rungs, and cloud STT (Deepgram/OpenAI/Groq-class) is
near-verbatim at ~300 ms on any CPU.

The case for cloud is strong on the merits. The case against it is
decisive here: this is a side project of uncertain future use, and cloud
STT is metered spend that keeps costing whether or not the thing earns its
keep. A zero-operating-cost ceiling applies to the whole system — the LLM
side already runs on keys the developer happens to hold, and adding a
per-utterance billing surface for transcription would make casual use cost
money.

The Alexa comparison was examined and rejected as a counterexample: Echo
devices achieve "offline" by shrinking the problem, not the model — wake
word runs on a DSP, a closed built-in command grammar runs on-device on
purpose-built silicon (AZ1/AZ2), and everything open-ended still goes to
cloud ASR. There is no evidence that tiny machines do open-vocabulary
transcription at cloud accuracy; there is evidence they do streaming ASR
well within a sub-1-GB, sub-TOPS envelope (Moonshine Streaming's own model
card targets exactly that).

## Decision

- **Utterance transcription stays fully local. No cloud STT tier, no
  hybrid.** The only network the voice pipeline may touch is the one-time
  model fetch.
- **Accuracy is pursued inside the local ladder**: the Moonshine Streaming
  family (Small default, Medium opt-in — WER 7.84%/6.65% avg on the open
  ASR benchmark vs Base's legacy line), plus the Bias Lexicon for the app's
  own vocabulary, which is where mishears actually concentrate ("pop up"
  heard as "bob").
- **The relaxed latency gate is 2 s p95 endpoint→transcript** on the
  Hardware Floor, verified by `pnpm stt:replay` over captured utterance
  dumps — not the 500 ms the 5600G development machine allowed.

## Consequences

- Zero per-use operating cost; the assistant works offline end to end
  except for the LLM/browsing it is asking about anyway.
- Accuracy ceilings below cloud ASR are accepted by design. If accuracy
  later becomes unacceptable and the project proves durable, revisiting
  this ADR means adding a metered dependency — a deliberate product
  decision, not a quiet regression.
- Engine swaps stay cheap: the Transcriber port and the tier/fetch seam
  (`moonshineModels.ts`) localize what an engine change touches.
- Latency claims must be measured on the Hardware Floor, not extrapolated
  from the development machine — the measurement protocol (audio dumps +
  replay) is the standing check.

## Amendment 2026-10-20 — Parakeet is the default engine (#358)

The owner still had to over-articulate for Moonshine Medium to hear them,
and the mishears were the model's, not the endpoint's (847d039). The owner
ruled again that audio stays local, and that Parakeet should replace
Moonshine.

- **NVIDIA Parakeet TDT 0.6B v2** (English, the int8 onnx-asr export,
  ~660 MB, under `models/parakeet-tdt-0.6b-v2`) is the default engine, on
  the same onnxruntime-node stack with a greedy TDT decode. It does not
  stream, so partials come from the same rolling passes Moonshine's do (1 s
  in, every 0.5 s after, a pass due while one runs is skipped), and Early
  Fire reads them unchanged.
- **Moonshine stays as the lighter engine**, selectable in Settings for a
  machine too slow for Parakeet. A Medium saved before the change moves to
  Parakeet once. Small and Base stay as saved.
- **The bias still applies.** The Seed Lexicon, Learned Terms and Page Terms
  re-rank which token a frame emits, over Parakeet's vocab. They never turn
  a blank into a token, so a boost cannot insert a word Parakeet did not
  hear.
- **The Hardware Floor fit is not a gate for this default.** It is measured
  later. The owner's ruling: "if speed is an issue, we can deal with it
  then." The 2 s p95 gate above still names the Floor, but this default
  ships without it. If the Floor turns out too slow, the candidate is
  `parakeet-tdt_ctc-110m` or a Moonshine tier.
