"""Kaggle kernel: train every config of one sweep on one features set, and score each.

Blocks 14 (trainer) and 15 (ensemble + ONNX export) of
scripts/wake-train/train_wakeword.ipynb, in a loop over SWEEP["configs"].
Each config's .onnx is scored by scripts/wake-score/wake_score.py (uploaded
with the test set as a dataset and imported, never copied) on SWEEP["split"],
and one line goes to /kaggle/working/results.jsonl as soon as it is done, so
a kernel stopped at Kaggle's limit still hands back every finished config. A
config already in results.jsonl is skipped. A new kernel version starts with
an empty /kaggle/working, so the resume that matters is the driver's: it
pushes again with only the configs it has not pulled.

The driver (scripts/wake-sweep/wake_sweep.py) writes the real SWEEP line
below before it pushes this file; run as it stands, it trains nothing.
"""

import copy
import glob
import io
import json
import math
import os
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

SWEEP = {"configs": [], "split": "selection"}

OUT = Path("/kaggle/working")
RESULTS = OUT / "results.jsonl"
WORK = Path("/tmp/wake-sweep")
WORK.mkdir(parents=True, exist_ok=True)
T0 = time.time()


def log(msg):
    print(f"[{(time.time() - T0) / 60:6.1f}m] {msg}", flush=True)


def find(name):
    hits = sorted(glob.glob(f"/kaggle/input/**/{name}", recursive=True))
    assert hits, f"{name} is in no attached input"
    return Path(hits[0])


done = set()
if RESULTS.exists():
    done = {json.loads(line)["name"] for line in RESULTS.read_text().splitlines() if line.strip()}
todo = [c for c in SWEEP["configs"] if c["name"] not in done]
log(f"{len(todo)} configs to train, {len(done)} already done")
if not todo:
    sys.exit(0)

# Blocks 14-15 need only torch (Kaggle's own), numpy, yaml and onnxruntime;
# the notebook's other pins are for clip generation (the features kernel).
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "onnx", "onnxruntime"], check=True)

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import yaml

# ── Inputs ──────────────────────────────────────────────────────────────────
FEAT = find("positive_features_train.npy").parent
base_cfg = yaml.safe_load((FEAT / "my_model.yaml").read_text())

# The scorer, from the test-set dataset: imported as a module, its cache
# pointed at a writable copy of the dataset's two arrays.
SCORER = find("wake_score.py").parent
ws_cache = WORK / "wake-score"
ws_cache.mkdir(exist_ok=True)
for n in ("testset.npz", "validation_set_features.npy"):
    if not (ws_cache / n).exists():
        (ws_cache / n).symlink_to(find(n))
os.environ["BINGBONG_WAKE_SCORE_CACHE"] = str(ws_cache)
sys.path.insert(0, str(SCORER))
import wake_score as ws  # noqa: E402

ts = ws.load_testset()

# Block 9's ACAV training subset is the first tenth of the 17 GB ACAV file's
# rows. Fetch only those bytes, so the 17 GB file never touches the disk.
ACAV_URL = ("https://huggingface.co/datasets/davidscripka/openwakeword_features/resolve/main/"
            "openwakeword_features_ACAV100M_2000_hrs_16bit.npy")


def acav_train_subset(dst):
    if dst.exists():
        return np.load(dst)
    from numpy.lib import format as npf
    with urllib.request.urlopen(urllib.request.Request(ACAV_URL, headers={"Range": "bytes=0-65535"}),
                                timeout=120) as r:
        # A 200 would be the whole 17 GB file: only a 206 is a byte range.
        assert r.status == 206, f"ACAV host ignored the byte range (HTTP {r.status})"
        head = r.read()
    bio = io.BytesIO(head)
    version = npf.read_magic(bio)
    shape, fortran, dtype = (npf.read_array_header_1_0 if version == (1, 0) else npf.read_array_header_2_0)(bio)
    assert not fortran
    offset = bio.tell()
    n_train = shape[0] // 10
    out = npf.open_memmap(dst, mode="w+", dtype=dtype, shape=(n_train,) + tuple(shape[1:]))
    buf = out.reshape(-1).view(np.uint8)
    pos, need = 0, buf.size
    log(f"ACAV subset: {n_train} of {shape[0]} rows, {need / 1e9:.2f} GB")
    for attempt in range(8):
        try:
            req = urllib.request.Request(ACAV_URL, headers={"Range": f"bytes={offset + pos}-{offset + need - 1}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                assert r.status == 206, f"ACAV host ignored the byte range (HTTP {r.status})"
                while pos < need:
                    chunk = r.read(min(8 << 20, need - pos))
                    if not chunk:
                        break
                    buf[pos:pos + len(chunk)] = np.frombuffer(chunk, np.uint8)
                    pos += len(chunk)
            if pos >= need:
                break
        except Exception as e:
            log(f"  ACAV fetch attempt {attempt + 1}: {e}; resuming at {pos / 1e9:.2f} GB")
            time.sleep(10 * (attempt + 1))
    assert pos == need, f"ACAV subset short: {pos} of {need} bytes"
    out.flush()
    del out
    return np.load(dst)


DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
log(f"device {DEVICE}")
pos_train = torch.from_numpy(np.load(FEAT / "positive_features_train.npy").astype(np.float32)).to(DEVICE)
neg_train = torch.from_numpy(np.load(FEAT / "negative_features_train.npy").astype(np.float32)).to(DEVICE)
pos_test = torch.from_numpy(np.load(FEAT / "positive_features_test.npy").astype(np.float32)).to(DEVICE)
neg_test = torch.from_numpy(np.load(FEAT / "negative_features_test.npy").astype(np.float32)).to(DEVICE)
log(f"pos_train={tuple(pos_train.shape)} neg_train={tuple(neg_train.shape)}")
acav_train_np = acav_train_subset(WORK / "acav_train_subset.npy")
log(f"acav_train {acav_train_np.shape} {acav_train_np.dtype}")
acav_val_np = np.load(find("validation_set_features.npy"))
M = acav_val_np.shape[0]
val_listen_hours = M * 0.08 / 3600.0
n_win_val = M - 16
acav_val_windows = np.lib.stride_tricks.sliding_window_view(acav_val_np, (16, 96))[:, 0, :, :]
acav_val_windows = np.ascontiguousarray(acav_val_windows.astype(np.float32))
VAL_BATCH = 4096
_WIN = np.arange(16)


def merged(base, over):
    out = copy.deepcopy(base)
    for k, v in over.items():
        out[k] = copy.deepcopy(v)
    return out


# ── Block 14: the trainer, as in the notebook, for one config ───────────────

class FCNBlock(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.fcn_layer = nn.Linear(dim, dim)
        self.relu = nn.ReLU()
        self.layer_norm = nn.LayerNorm(dim)

    def forward(self, x):
        return self.layer_norm(self.relu(self.fcn_layer(x)))


class WakewordModel(nn.Module):
    def __init__(self, dim, n_blocks):
        super().__init__()
        self.flatten = nn.Flatten()
        self.layer1 = nn.Linear(16 * 96, dim)
        self.relu1 = nn.ReLU()
        self.layernorm1 = nn.LayerNorm(dim)
        self.blocks = nn.ModuleList([FCNBlock(dim) for _ in range(n_blocks)])
        self.layer2 = nn.Linear(dim, 1)

    def forward(self, x):
        x = self.layernorm1(self.relu1(self.layer1(self.flatten(x))))
        for block in self.blocks:
            x = block(x)
        return self.layer2(x)


def train(cfg, seed):
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    model = WakewordModel(cfg["layer_size"], cfg["n_blocks"]).to(DEVICE)
    loss_fn = nn.BCEWithLogitsLoss(reduction="none")
    TOTAL_STEPS = cfg["steps"]
    MAX_NEG_W = cfg["max_negative_weight"]
    THRESH = 0.5
    history = {"val_recall": [], "val_accuracy": [], "val_fp_per_hour": [], "val_n_fp": [], "loss": []}
    best_models = []
    _bn = cfg["batch_n_per_class"]
    B_POS, B_ANEG, B_ACAV = _bn["positive"], _bn["adversarial_negative"], _bn["ACAV100M_sample"]

    def random_acav_window_batch(k):
        N, T, F = acav_train_np.shape
        rows = np.random.randint(0, N, size=k)
        starts = np.random.randint(0, T - 16 + 1, size=k)
        return acav_train_np[rows[:, None], starts[:, None] + _WIN].astype(np.float32)

    def build_batch():
        p_idx = torch.randint(0, pos_train.shape[0], (B_POS,), device=DEVICE)
        aneg_idx = torch.randint(0, neg_train.shape[0], (B_ANEG,), device=DEVICE)
        p, an = pos_train[p_idx], neg_train[aneg_idx]
        acav = torch.from_numpy(random_acav_window_batch(B_ACAV)).to(DEVICE)
        x = torch.cat([p, an, acav], dim=0)
        y = torch.cat([torch.ones(B_POS, device=DEVICE), torch.zeros(B_ANEG + B_ACAV, device=DEVICE)])
        return x, y

    @torch.no_grad()
    def validate(step_label):
        model.eval()
        p_preds = torch.sigmoid(model(pos_test)).squeeze(-1)
        n_preds = torch.sigmoid(model(neg_test)).squeeze(-1)
        recall = (p_preds >= THRESH).float().mean().item()
        accuracy = (((p_preds >= THRESH).sum() + (n_preds < THRESH).sum()).item()
                    / (pos_test.shape[0] + neg_test.shape[0]))
        n_fp = 0
        for i in range(0, n_win_val, VAL_BATCH):
            chunk = torch.from_numpy(acav_val_windows[i:i + VAL_BATCH]).to(DEVICE)
            n_fp += (torch.sigmoid(model(chunk)).squeeze(-1) >= THRESH).sum().item()
        fp_per_hour = n_fp / max(val_listen_hours, 1e-6)
        history["val_recall"].append(recall)
        history["val_accuracy"].append(accuracy)
        history["val_fp_per_hour"].append(fp_per_hour)
        history["val_n_fp"].append(n_fp)
        save = False
        if len(history["val_n_fp"]) >= 3:
            fp_p50 = np.percentile(history["val_n_fp"], 50)
            rc_p5 = np.percentile(history["val_recall"], 5)
            if n_fp <= fp_p50 and recall >= rc_p5:
                best_models.append((copy.deepcopy(model.state_dict()),
                                    {"val_recall": recall, "val_accuracy": accuracy,
                                     "val_fp_per_hour": fp_per_hour, "val_n_fp": n_fp}))
                save = True
        print(f"  [{step_label}] recall={recall:.3f}  acc={accuracy:.3f}  fp/hr={fp_per_hour:.2f}"
              f"  saved={'+' if save else '-'}", flush=True)
        model.train()

    def run_stage(stage_idx, n_steps, lr, max_neg_w, val_window_frac=1.0):
        optimizer = optim.Adam(model.parameters(), lr=lr)
        weight_schedule = np.linspace(1.0, max_neg_w, n_steps)
        val_start = int(n_steps * (1.0 - val_window_frac))
        val_steps = set(np.linspace(val_start, n_steps - 1, 20).astype(int))
        warmup = max(1, n_steps // 5)
        hold = n_steps // 3
        accumulated = []
        t0 = time.time()
        for step in range(n_steps):
            if step < warmup:
                lr_now = lr * (step + 1) / warmup
            elif step < warmup + hold:
                lr_now = lr
            else:
                decay_t = (step - warmup - hold) / max(1, n_steps - warmup - hold)
                lr_now = lr * 0.5 * (1.0 + math.cos(math.pi * min(1.0, decay_t)))
            for pg in optimizer.param_groups:
                pg["lr"] = lr_now
            x, y = build_batch()
            logits = model(x).squeeze(-1)
            preds = torch.sigmoid(logits)
            keep = ((y == 0) & (preds >= 0.001)) | ((y == 1) & (preds < 0.999))
            if keep.sum() == 0:
                if step in val_steps:
                    validate(f"stage{stage_idx} step {step}/{n_steps}")
                continue
            neg_w = weight_schedule[step]
            kept_y = y[keep]
            w = torch.where(kept_y > 0.5, torch.tensor(1.0, device=DEVICE),
                            torch.tensor(neg_w, device=DEVICE, dtype=torch.float32))
            accumulated.append((logits[keep], kept_y, w))
            if sum(t[0].shape[0] for t in accumulated) >= 128:
                cat_logits = torch.cat([t[0] for t in accumulated])
                cat_y = torch.cat([t[1] for t in accumulated])
                cat_w = torch.cat([t[2] for t in accumulated])
                loss = (loss_fn(cat_logits, cat_y) * cat_w).mean()
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                history["loss"].append(loss.item())
                accumulated.clear()
            if step in val_steps:
                validate(f"stage{stage_idx} step {step}/{n_steps} ({(time.time() - t0) / 60:.1f}m,"
                         f" lr={lr_now:.6f}, neg_w={neg_w:.0f})")

    run_stage(1, TOTAL_STEPS, lr=1e-4, max_neg_w=MAX_NEG_W, val_window_frac=0.25)
    run_stage(2, max(2000, TOTAL_STEPS // 10), lr=1e-5, max_neg_w=MAX_NEG_W)
    run_stage(3, max(2000, TOTAL_STEPS // 10), lr=1e-6, max_neg_w=MAX_NEG_W)
    return model, best_models


# ── Block 15: ensemble the best checkpoints, export ONNX ────────────────────

def export(model, best_models, out_path):
    if not best_models:
        final_state = {k: v.clone() for k, v in model.state_dict().items()}
        n = 0
    else:
        acc_p90 = np.percentile([s["val_accuracy"] for _, s in best_models], 90)
        rc_p90 = np.percentile([s["val_recall"] for _, s in best_models], 90)
        fp_p10 = np.percentile([s["val_fp_per_hour"] for _, s in best_models], 10)
        qualified = [(sd, sc) for sd, sc in best_models
                     if sc["val_accuracy"] >= acc_p90 and sc["val_recall"] >= rc_p90
                     and sc["val_fp_per_hour"] <= fp_p10]
        if not qualified:
            qualified = [sorted(best_models, key=lambda t: (t[1]["val_fp_per_hour"], -t[1]["val_recall"]))[0]]
        keys = qualified[0][0].keys()
        final_state = {k: torch.stack([sd[k].float() for sd, _ in qualified]).mean(dim=0) for k in keys}
        n = len(qualified)
    model.load_state_dict(final_state)
    model.eval()

    class WakewordExportable(torch.nn.Module):
        def __init__(self, base):
            super().__init__()
            self.base = base

        def forward(self, x):
            return torch.sigmoid(self.base(x))

    export_model = WakewordExportable(model).to(DEVICE).eval()
    dummy = torch.randn(1, 16, 96, device=DEVICE)
    torch.onnx.export(export_model, dummy, str(out_path),
                      input_names=["onnx::Flatten_0"], output_names=["output"],
                      dynamic_axes={"onnx::Flatten_0": {0: "batch"}, "output": {0: "batch"}},
                      opset_version=14, dynamo=False)
    return {"checkpoints_saved": len(best_models), "checkpoints_averaged": n}


# ── The loop ────────────────────────────────────────────────────────────────

for c in todo:
    name = c["name"]
    cfg = merged(base_cfg, c.get("overrides", {}))
    seed = int(c.get("seed", 0))
    log(f"=== {name}: seed {seed}, overrides {c.get('overrides', {})}")
    line = {"name": name, "seed": seed, "overrides": c.get("overrides", {})}
    t = time.time()
    model = None
    try:
        model, best = train(cfg, seed)
        line["train_minutes"] = (time.time() - t) / 60
        onnx_path = OUT / f"{name}.onnx"
        line["export"] = export(model, best, onnx_path)
        line["score"] = ws.score_model(onnx_path, ts, SWEEP["split"])
        line["score"]["model"] = onnx_path.name
        log(f"    {name}: {SWEEP['split']} headline {100 * line['score']['headline_recall']:.1f}%"
            f" at {line['score']['operating_threshold']}, {line['train_minutes']:.1f} min")
    except Exception:
        line["error"] = traceback.format_exc()[-4000:]
        log(f"    {name} FAILED\n{line['error']}")
    line["minutes"] = (time.time() - t) / 60
    with open(RESULTS, "a") as f:
        f.write(json.dumps(line) + "\n")
        f.flush()
        os.fsync(f.fileno())
    del model
    torch.cuda.empty_cache()

log("sweep done")
