# Wake-word scorer

Scores a trained "kachow" wake model (`.onnx`, openWakeWord head) offline.
It never opens a microphone or speaker.

```sh
pnpm wake:score build                  # once, ~1 GB download + synthesis
pnpm wake:score score ~/Downloads/kachow.onnx
pnpm wake:score score sweep/ --json results.json   # rank every .onnx in a folder
```

`uv` runs it in its own environment (Python deps are declared in the script).

## What it measures

- **Headline.** The share of "kachow" test clips that wake the model at the
  lowest threshold where false wakes stay at or under 0.5 per hour. One
  number, so sweep variants rank directly.
- **False wakes per hour** on openWakeWord's ~11 h held-out validation audio
  (`validation_set_features.npy`). A wake silences the detector for ~2 s, so
  a run of hot frames counts once. The training notebook counts every hot
  frame, so its FP/hour reads higher than this one.
- **Recall** on clips the training never hears: 11 Piper voices, none of them
  LibriTTS (the notebook's generator), including Hindi-L1 (L2-ARCTIC) and
  Indian (VCTK) speakers. Each clip is scored clean, under babble or noise at
  5–15 dB, and with synthetic room echo.
- **Breakdowns** by pronunciation, accent group and near-miss phrase.

The five pronunciations are written as phonemes (`kətʃˈaʊ` and variants) and
match the notebook's `TARGET_PHRASE`. espeak reads the spelling "kachow" as
"KATCH-ow", so text would test the wrong word.

## Your own voice

Synthetic voices are not your voice, room or microphone. Put recordings in
`~/.cache/bingbong/wake-score/recordings/positive/*.wav` (you saying kachow)
and `.../negative/*.wav` (near misses, ordinary talk), then rerun `build`.
They get their own column and do not change the headline.

## Caveats

- The validation audio also picks the training notebook's checkpoints, so
  FP/hour here is slightly optimistic for models from that notebook.
- The test set is fixed by a seed. Changing the voices, phrases or seed
  bumps `TESTSET_VERSION` and old results stop being comparable.
- Cache: `~/.cache/bingbong/wake-score` (`BINGBONG_WAKE_SCORE_CACHE`).
  The mel and embedding models come from `~/.config/bingbong/models`
  (`BINGBONG_MODELS_DIR`).
