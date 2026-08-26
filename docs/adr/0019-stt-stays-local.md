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
