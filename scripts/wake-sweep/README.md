# Wake-word sweep

Trains and scores a queue of "kachow" wake models on Kaggle, unattended,
from this machine. Each model is scored by [`wake_score`](../wake-score/)
inside the kernel that trained it.

```sh
pnpm wake:sweep run scripts/wake-sweep/configs/first.json   # the one command
pnpm wake:sweep table first                                 # the ranked table so far
```

`run` goes to the end with nobody watching: it uploads what Kaggle lacks,
makes each features set once, pushes the sweep kernels, polls them every
2 minutes, pulls every model, prints the ranked table and scores the winner
on the final half. If the machine or the command stops, run it again: it
resumes. A kernel it was waiting on is waited on again, a kernel that ended
before its output came down is pulled, not pushed, and nothing pulled is
trained twice. It refuses a queue estimated above the queue's
`max_gpu_hours` (default 4), which `--max-gpu-hours` overrides.

It needs the Kaggle CLI signed in (`kaggle config view`) on an account that
can turn on kernel internet (phone-verified), `uv`, and the scorer's test
set (`pnpm wake:score build`).

## What it makes

- **Datasets.** `<user>/kachow-wake-score` holds `wake_score.py`,
  `testset.npz` and `validation_set_features.npy` from
  `~/.cache/bingbong/wake-score/`. It gets a new version when any of them
  changes. `<user>/kachow-features-<data>` holds an uploaded features set.
- **Features job, one per data config** (`features-kernel/`). Blocks 1–13
  of [`train_wakeword.ipynb`](../wake-train/train_wakeword.ipynb) with the
  data config's overrides on block 10. The output is the four
  `*_features_*.npy` files plus `my_model.yaml`. That output is the
  reusable features set: the sweep kernels mount it as a kernel source, so
  it is never copied into a separate dataset. It fetches 1,500 FMA MP3s out of the remote zip by byte range and
  never fetches ACAV, so Kaggle's 20 GB disk is never close to full. It
  runs about 2 h on a T4.
- **Sweep kernel, many trainings per features set** (`sweep-kernel/`).
  Blocks 14–15 in a loop over the config list. After every config it writes
  `<config>.onnx` and a line of `results.jsonl` holding the config and its
  `wake_score` card on the selection half. A config already in
  `results.jsonl` is skipped. The ACAV training negatives (block 9's subset,
  the first tenth of the 17 GB file's rows) are fetched by byte range. A
  sweep estimated over 9 h is split into kernels of at most 9 h each, in
  config order, under Kaggle's 12 h limit. When a kernel stops early, or a
  config in it fails, the driver pushes it again with only the configs not
  yet trained, up to 2 retries. A failed config stays in the table as
  FAILED, and running the command again retries it.
- **Local results**, in `~/.cache/bingbong/wake-sweep/<sweep>/`: one folder
  per training, `<data>.<config>/model.onnx` beside `score.json`. The winner
  goes to `winner/` with `final.json`, `final-card.txt` and
  `settings.json`.

## Queues and configs

A queue (`configs/first.json`) names the sweep and its data configs, in
order. Each data config has a features set and a training list:

```json
{"name": "run3", "features": {"zip": "~/Downloads/kachow_features.zip"}, "training": "first-grid.json"}
{"name": "aug3", "features": {"job": {"augmentation_rounds": 3}}, "training": "first-grid.json"}
```

A `zip` is a features set already made (block 16's download). A `job`
holds block-10 overrides for a features job, plus one knob of its own:
`negative_phrase_share` repeats `custom_negative_phrases`, every phrase
equally, until the class is that share of the adversarial texts. Upstream
voices them by cycling one list with about `n_samples` generated texts, so
left alone each custom phrase is about one clip in 20,000.

The scorer's near-miss phrases are held out from training, like its voices.
Some ("a chow", "catch", "ketchup", "gotcha") are deliberately missing from
`custom_negative_phrases`. Don't add them, or the near-miss column turns
into a replay of the training list. Each training config
(`configs/first-grid.json`) replaces keys of the features set's
`my_model.yaml`:

```json
{"name": "negw-500", "seed": 0, "overrides": {"max_negative_weight": 500}}
```

**Batch mix order.** A mix is named positive/adversarial/ACAV:
`batch_n_per_class` read as `positive`, `adversarial_negative`,
`ACAV100M_sample`. The control is 32/32/64 and upstream openWakeWord's is
50/50/1024. The issue's first table writes the control as "64/32/32", ACAV
first. Read that as the same mix.

## The ranking

The measure was named before any numbers: the `wake_score` headline on the
selection half, ties broken by false wakes per hour at the operating point.
Configs named `control-*` are the same settings on different seeds. Their
spread is the noise band. A config ranked above the band beat every control
seed. One inside the band is a measured tie with the control, not a winner.
The winner is the best config above its band. When none is above it, the
knobs are ties and the best control is the winner, since a measured tie
goes to the arm cheapest to reverse (AGENTS.md, "Ties are measured"). The
reported number is the winner's headline on the final half, scored again
on this machine.

`configs/smoke.json` is a one-training queue, about 20 GPU minutes, that
checks the whole loop end to end.

## Caveats

- The estimate (`MIN_PER_20K_STEPS`, `SETUP_MIN` in `wake_sweep.py`) is
  rounded up from the smoke queue: setup took 0.8 min, and 6,000 steps
  trained and scored in 1.1 min on a T4. `table` shows each training's
  measured minutes.
- The final half is held out of the ranking, not out of training. The
  trainer (block 14) still picks its checkpoints by false wakes on the
  whole 10.7 h validation audio, both halves, as the notebook always has.
  So the final card's false-wake side is a little optimistic, like the
  scorer's caveat on notebook models.
- A features job's 2 h (`FEATURES_JOB_MIN`) is the issue's estimate until
  one has run at full size.
- Kaggle's Python is 3.13, so the notebook's pins install as they are. The
  sweep kernel installs only `onnx` and `onnxruntime`, since blocks 14–15
  need nothing else beyond Kaggle's own torch.
