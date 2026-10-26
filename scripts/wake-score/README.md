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

## Selection and final halves

```sh
pnpm wake:score score sweep/ --split selection   # what a sweep ranks on
pnpm wake:score score winner.onnx --split final  # the number reported for the winner
```

Ranking dozens of models on one test set flatters the winner, so a sweep
ranks on one half and reports the winner on the other. `--split all`, the
default, is both halves and gives the same numbers as before the split
(`TESTSET_VERSION` stays 1).

The split is by voice: of the 462 ways to put 6 of the 11 voices in
selection and 5 in final, 21 split the 2,040 kachow clips exactly 1,020 /
1,020, and seed 452 picked one of them. The voices are hard-coded in
`SELECTION_VOICES`, so the split never moves:

| Half | Voices | Kachow clips |
|---|---|---|
| selection | en_GB-alba, en_US-amy, en_US-hfc_female, en_US-l2arctic, en_US-lessac, en_US-ryan | 1,020 |
| final | en_GB-aru, en_GB-northern_english_male, en_GB-vctk, en_US-arctic, en_US-kusal | 1,020 |

The validation audio splits by time in the same proportion, selection
first: about 5.3 h each. Your own recordings are counted in every split.

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
