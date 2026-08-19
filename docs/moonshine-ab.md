# Moonshine Base vs whisper.cpp — go/no-go evidence (#39)

Measured 2026-08-19 on the target machine (Ryzen 5 5600G, 12 SMT threads,
CPU-only) with the #39 A/B harness (`pnpm stt:ab`, removed with the whisper
engine in #41; its Moonshine half lives on as `pnpm stt:replay`) — it
replayed utterance-dump WAVs
(`BINGBONG_AUDIO_DUMP=1` → `<userData>/audio-dumps`, #34) through both
engines and printed transcript pairs plus per-file latency.

Engines, both greedy and warm:

- **whisper base.en** via smart-whisper with the app's exact config (same
  model path, `initial_prompt`, 6 physical threads — resolved by
  `src/main/voice/voiceConfig.ts`).
- **Moonshine Base** via the official int8-quantized merged ONNX export
  (`moonshine-ai/moonshine` on HuggingFace, `onnx/merged/base/quantized` —
  63 MB total: encoder + `decoder_model_merged` + SentencePiece-BPE
  tokenizer) running on the app's existing `onnxruntime-node`. This is the
  same graph the upstream C++ core ships; the float export is 250 MB.

## Fixture validation

`jfk.wav` (whisper.cpp's own sample): Moonshine Base transcribes the full
passage verbatim — the ONNX path (encoder → merged decoder with
`use_cache_branch` + past/present KV plumbing, greedy argmax, EOS 2,
token budget `⌈duration × 6.5⌉`) is correct end to end on
`onnxruntime-node`.

## Latency

| utterance | duration | whisper base.en | moonshine base |
| --- | --- | --- | --- |
| beckett.wav | 10.0 s | 6537 ms | 212 ms |
| intent.wav | 20.6 s | 6812 ms | 199 ms |
| jfk.wav | 11.0 s | 6822 ms | 255 ms |
| two_cities_16k.wav | 44.4 s | 31004 ms | 2182 ms |

First use (load + warm-up): whisper 6.2 s, moonshine 0.9 s.

whisper.cpp pays its fixed 30 s window per utterance (~6.5–6.8 s regardless
of length, as recorded in `docs/stt-latency.md`) and multiples of it beyond
30 s. Moonshine scales with actual content: ~200–310 ms for command-length
speech, ~2.2 s for a 44 s literary reading — **20–30× faster** where the
assistant actually lives (1–5 s commands).

## Accuracy

Transcripts matched (normalized) on the human speech fixtures
(beckett.wav, jfk.wav). On two_cities_16k.wav both engines track the
reading word-for-word and both degrade on the long tail: whisper emits its
`[BLANK_AUDIO]` special token, Moonshine hallucinates a repeated clause
("The time of the Lord…"). No accuracy advantage either way on long reads;
the assistant never sees 44 s utterances after endpointing anyway.

**One real failure mode:** `intent.wav` starts with a synthesized "Hi, I'm
Pete" intro. Moonshine emits EOS immediately — empty transcript — and that
head poisons the whole non-causal decode of the clip (whisper transcribes
it fine). Not quantization: the float export behaves identically. With the
intro sliced out, Moonshine transcribes the rest perfectly ("Can you go
forward please? Rotate left. Eat a ham sandwich. Move in reverse."),
punctuation included. So: Moonshine Base is solid on natural speech, but
TTS-like/heavily processed audio can zero out an utterance. For this
assistant that matters where TTS playback or media audio reaches the mic —
the wake/barge-in path, not the spoken-command path.

## The user's own voice

No `BINGBONG_AUDIO_DUMP=1` captures existed on this machine at write time.
Utterance dumps still work (`BINGBONG_AUDIO_DUMP=1 pnpm dev`, #34); replay
them offline against the shipped Moonshine engine with `pnpm stt:replay`
(real-time-paced pushes, per-file transcripts, endpoint→transcript p50/p95
in the same units as the live `stt` span) — the models live in
`~/.config/bingbong/models/moonshine-base` (auto-fetched, the `models/wake`
subdir convention).

## Go / no-go

**GO on Moonshine Base as-is.** ~30× lower utterance→transcript latency with
matching accuracy on natural speech is the whole point of #35's engine swap;
6.5 s of dead air after every command is what makes the current pipeline feel
broken. No escalation to Moonshine Small on accuracy grounds (Base matches
whisper base.en on the material tested); Small remains available if #40/#41
profiling wants the headroom. The synthetic-voice failure mode went on the
#41 acceptance list: barge-in robustness needs its own test (either
endpointing keeps TTS playback out of STT, or Moonshine's empty-transcript
on synthetic audio degrades to a harmless no-op — it cannot, however, be
allowed to swallow a real spoken command, which today's data does not show).
That test exists now — see the close-out section below.

Shipped in #41: whisper.cpp and the `BINGBONG_WHISPER_MODEL` /
`BINGBONG_STT_PROMPT` knobs are gone; the streaming engine lives in
`src/main/moonshine/` (unit tests at the Transcriber port with the fake
runtime, real-models test with the `jfk.wav` fixture).

## #41 streaming evidence (same machine, warm engine)

Driven the way the voice session drives the engine — frames pushed during
speech, one `finish()` at the endpoint whose wall time (the `stt` perf
span's measure) is drain-in-flight-partial + final full-utterance pass:

| material | endpoint → transcript |
| --- | --- |
| command-length cuts (2–4.5 s of jfk speech) | 97–108 ms |
| full jfk.wav (11.0 s) | 270 ms |
| realistic push cadence, 18 partials during speech | 394 ms |
| **p95 over 20 utterances** | **267 ms** |

Well under the 500 ms target. First use pays ~0.9 s of model load (like the
old whisper adapter, then ~7× cheaper). Live verification on real usage
stays with `pnpm perf:report` (`stt` span). Partials grew prefix-correctly
("And so" → "…ask not what your country can do for you"), and none landed
after the endpoint.

## #35 close-out: barge-in robustness + real-voice evidence

The go/no-go section's open acceptance item — the synthetic-voice failure
mode needs its own test — is closed at both seams:

- **Engine** (`createMoonshineTranscriber.test.ts`): audio that makes the
  engine sample EOS on the first token resolves `finish()` to `''` (the
  harmless no-op), and the shared sessions stay ready — the next utterance
  transcribes normally.
- **Session** (`voiceSession.test.ts`): during a wake barge-in listen, an
  utterance that transcribes empty (the stopped speech's tail or the
  activation chime reaching the mic) reopens the ear with the wake listen
  intact; the real spoken command after it is submitted, never swallowed.

Real voice, measured after the swap on the target machine:

- Live `stt` span (perf:report): **164 ms** — from the session started
  15:52 UTC, after the #41 engine-swap commit (15:10 UTC). A fresh report's
  aggregate stt p95 of ~6.5 s mixes in pre-swap whisper sessions (the
  6.0–6.6 s fixed-window profile of docs/stt-latency.md); one live
  post-swap span is a sample, not a p95 — ongoing usage accrues it through
  the same report.
- `pnpm stt:replay` over the captured live dump (3.1 s utterance, real-time
  pacing): **135 ms**, transcript verbatim ("Open the first line of
  stackedups video you can find.").

Acceptance standing: every endpoint→transcript measurement on the shipped
engine — fixtures (p95 267 ms over 20), the live span (164 ms), real-voice
replay (135 ms) — sits well under the 500 ms target, with `perf:report`
as the ongoing live check.
