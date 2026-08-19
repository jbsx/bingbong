# Moonshine Base vs whisper.cpp — go/no-go evidence (#39)

Measured 2026-08-19 on the target machine (Ryzen 5 5600G, 12 SMT threads,
CPU-only) with `pnpm stt:ab` — the A/B harness replays utterance-dump WAVs
(`BINGBONG_AUDIO_DUMP=1` → `<userData>/audio-dumps`, #34) through both engines
and prints transcript pairs plus per-file latency.

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
To run the real decision material:

```sh
BINGBONG_AUDIO_DUMP=1 pnpm dev   # speak a day's worth of real commands
pnpm stt:ab                       # replays ~/.config/bingbong/audio-dumps
```

Models fetch automatically into `~/.config/bingbong/models/moonshine-base`
on first run (the `models/wake` subdir convention).

## Go / no-go

**GO on Moonshine Base as-is.** ~30× lower utterance→transcript latency with
matching accuracy on natural speech is the whole point of #35's engine swap;
6.5 s of dead air after every command is what makes the current pipeline feel
broken. No escalation to Moonshine Small on accuracy grounds (Base matches
whisper base.en on the material tested); Small remains available if #40/#41
profiling wants the headroom. The synthetic-voice failure mode goes on the
#41 acceptance list: barge-in robustness needs its own test (either
endpointing keeps TTS playback out of STT, or Moonshine's empty-transcript
on synthetic audio degrades to a harmless no-op — it cannot, however, be
allowed to swallow a real spoken command, which today's data does not show).
