# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Train and score a queue of kachow wake models on Kaggle, unattended.

  uv run scripts/wake-sweep/wake_sweep.py run scripts/wake-sweep/configs/first.json
  uv run scripts/wake-sweep/wake_sweep.py table first

A queue is a list of data configs. Each has a features set, either an
existing zip of the notebook's four feature arrays and my_model.yaml or a
features job with block-10 overrides, and a training sweep that runs on it.
The driver uploads what Kaggle lacks, makes each features set once, pushes
the sweep kernels, polls them every 2 minutes, pulls every model beside the
JSON of its scores, and prints the ranked table. When the queue is done it
re-scores the winner locally on the final half: that is the reported number.

Everything it pulls goes to ~/.cache/bingbong/wake-sweep/<sweep>/. Rerunning
the same command resumes: finished kernels are not pushed again.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SCORER = REPO / "scripts" / "wake-score" / "wake_score.py"
CACHE = Path(os.environ.get("BINGBONG_WAKE_SWEEP_CACHE")
             or Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "bingbong" / "wake-sweep")
SCORE_CACHE = Path(os.environ.get("BINGBONG_WAKE_SCORE_CACHE")
                   or Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "bingbong" / "wake-score")
POLL_S = 120
# Kaggle stops a kernel at 12 h; a sweep longer than this is split (ruling 9).
MAX_KERNEL_MIN = 9 * 60
# Minutes per config, setup paid once per kernel. Measured on a T4 by the
# smoke queue (2026-10-26): setup 0.8 min, 6,000 steps trained and scored in
# 1.1 min; rounded up. `table` prints each training's measured minutes.
SETUP_MIN = 5
MIN_PER_20K_STEPS = 5
RETRIES = 2
# A full-size features job on a T4: aug2 took 74 min (2026-10-26), rounded up.
FEATURES_JOB_MIN = 80


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


def kaggle(*args: str, check: bool = True) -> str:
    r = subprocess.run(["kaggle", *args], capture_output=True, text=True)
    out = "\n".join(l for l in (r.stdout + r.stderr).splitlines() if "outdated `kaggle` version" not in l)
    if check and r.returncode != 0:
        raise RuntimeError(f"kaggle {' '.join(args)} failed:\n{out}")
    return out


def owner() -> str:
    m = re.search(r"username:\s*(\S+)", kaggle("config", "view"))
    if not m:
        sys.exit("kaggle CLI is not signed in")
    return m.group(1)


def sha_of(*paths: Path) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(p.name.encode())
        with open(p, "rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                h.update(block)
    return h.hexdigest()[:16]


class State:
    """What has been uploaded and pushed, so a rerun resumes."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.d = json.loads(path.read_text()) if path.exists() else {"datasets": {}, "kernels": {}}

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.d, indent=1))
        tmp.replace(self.path)


# ── Datasets ────────────────────────────────────────────────────────────────

def dataset_ready(slug: str) -> bool:
    return "ready" in kaggle("datasets", "status", slug, check=False).lower()


def wait_dataset(slug: str) -> None:
    for _ in range(90):
        if dataset_ready(slug):
            return
        time.sleep(20)
    raise RuntimeError(f"dataset {slug} never became ready")


def ensure_dataset(state: State, slug: str, title: str, files: dict[str, Path]) -> None:
    """Upload `files` as dataset `slug`, again only when their contents change."""
    stamp = sha_of(*files.values())
    if state.d["datasets"].get(slug) == stamp:
        return
    stage = CACHE / "staging" / slug.split("/")[1]
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    for name, src in files.items():
        try:
            os.link(src, stage / name)
        except OSError:
            shutil.copy(src, stage / name)
    (stage / "dataset-metadata.json").write_text(json.dumps(
        {"title": title, "id": slug, "licenses": [{"name": "other"}]}))
    exists = slug in state.d["datasets"] or dataset_ready(slug)
    log(f"{'versioning' if exists else 'uploading'} dataset {slug} ({sum(p.stat().st_size for p in files.values()) / 1e6:.0f} MB)")
    if exists:
        kaggle("datasets", "version", "-p", str(stage), "-m", f"stamp {stamp}", "-q")
    else:
        kaggle("datasets", "create", "-p", str(stage), "-q")
    wait_dataset(slug)
    # A fresh version takes a moment to be what a kernel mounts.
    time.sleep(30)
    state.d["datasets"][slug] = stamp
    state.save()
    shutil.rmtree(stage, ignore_errors=True)


def scorer_dataset(state: State, who: str) -> str:
    slug = f"{who}/kachow-wake-score"
    ensure_dataset(state, slug, "kachow-wake-score", {
        "wake_score.py": SCORER,
        "testset.npz": SCORE_CACHE / "testset.npz",
        "validation_set_features.npy": SCORE_CACHE / "validation_set_features.npy",
    })
    return slug


FEATURE_FILES = ["positive_features_train.npy", "negative_features_train.npy",
                 "positive_features_test.npy", "negative_features_test.npy", "my_model.yaml"]


def zip_features_dataset(state: State, who: str, name: str, zip_path: Path) -> str:
    out = CACHE / "features" / name
    if not all((out / f).exists() for f in FEATURE_FILES):
        out.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as z:
            for f in FEATURE_FILES:
                (out / f).write_bytes(z.read(f))
    slug = f"{who}/kachow-features-{name}"
    ensure_dataset(state, slug, f"kachow-features-{name}", {f: out / f for f in FEATURE_FILES})
    return slug


# ── Kernels ─────────────────────────────────────────────────────────────────

KERNEL_ENDS = ("complete", "error", "cancel_acknowledged", "cancel_requested")
KERNEL_TIMEOUT = 11 * 60     # minutes; under Kaggle's 12 h


def kernel_status(slug: str) -> str | None:
    """The kernel's status word (`running`, `complete`, ...), or None when the CLI could not say."""
    try:
        out = kaggle("kernels", "status", slug)
    except RuntimeError:
        return None
    m = re.search(r'has status "(?:KernelWorkerStatus\.)?(\w+)"', out)
    return m.group(1).lower() if m else None


def push_kernel(state: State, slug: str, source: Path, inject: tuple[str, object], datasets: list[str],
                kernels: list[str], timeout_min: int) -> None:
    build = CACHE / "kernels" / slug.split("/")[1]
    shutil.rmtree(build, ignore_errors=True)
    build.mkdir(parents=True)
    var, value = inject
    code = source.read_text()
    line = f"{var} = json.loads({json.dumps(json.dumps(value))})"
    code, n = re.subn(rf"^{var} = .*$", lambda _: line, code, count=1, flags=re.M)
    assert n == 1, f"{source.name} has no `{var} = ` line to fill"
    (build / source.name).write_text(code)
    meta = json.loads((source.parent / "kernel-metadata.json").read_text())
    meta.update(id=slug, title=slug.split("/")[1], dataset_sources=datasets, kernel_sources=kernels)
    (build / "kernel-metadata.json").write_text(json.dumps(meta, indent=1))
    log(f"pushing {slug}")
    out = kaggle("kernels", "push", "-p", str(build), "-t", str(timeout_min * 60))
    if "error" in out.lower() and "successfully" not in out.lower():
        raise RuntimeError(out)
    state.d["kernels"][slug] = {"status": "pushed", "pushed_at": time.time(), "pulled": False}
    state.save()


def wait_kernel(state: State, slug: str) -> str:
    # A status read right after a push can still show the previous version.
    time.sleep(60)
    last, unread = None, 0
    while True:
        s = kernel_status(slug)
        if s is None:
            # A failed read is not an ended kernel: keep polling, for an hour.
            unread += 1
            if unread > 30:
                raise RuntimeError(f"could not read {slug}'s status for an hour")
        else:
            unread = 0
            if s != last:
                log(f"{slug}: {s}")
                last = s
            if s in KERNEL_ENDS:
                state.d["kernels"][slug]["status"] = s
                state.save()
                return s
        time.sleep(POLL_S)


def needs_push(state: State, slug: str, attempt: int) -> bool:
    """Push unless this kernel is still ours to wait on or pull: a driver that
    stopped mid-wait, or after the kernel ended but before its output came down."""
    k = state.d["kernels"].get(slug, {})
    return bool(attempt) or k.get("status") is None or k.get("pulled", False)


def pull_output(slug: str, dest: Path, pattern: str | None = None) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    args = ["kernels", "output", slug, "-p", str(dest), "-o", "-q"]
    if pattern:
        args += ["--file-pattern", pattern]
    kaggle(*args)
    return dest


# ── Features job ────────────────────────────────────────────────────────────

def features_job(state: State, who: str, sweep: str, name: str, overrides: dict) -> str:
    """Make one features set; its kernel's output is what the sweep kernels mount."""
    slug = f"{who}/kachow-features-{sweep}-{name}"
    if state.d["kernels"].get(slug, {}).get("has_features"):
        return slug
    for attempt in range(RETRIES + 1):
        if needs_push(state, slug, attempt):
            push_kernel(state, slug, HERE / "features-kernel" / "features_kernel.py",
                        ("DATA", {"name": name, "overrides": overrides}), [], [], KERNEL_TIMEOUT)
        status = wait_kernel(state, slug)
        # my_model.yaml is written after the four arrays, so it marks a whole set.
        out = pull_output(slug, CACHE / sweep / "_features" / name, r"my_model\.yaml$")
        state.d["kernels"][slug]["pulled"] = True
        state.save()
        if any(out.rglob("my_model.yaml")):
            state.d["kernels"][slug]["has_features"] = True
            state.save()
            log(f"features set {name} made by {slug}")
            return slug
        log(f"{slug} ended {status} without its features (attempt {attempt + 1})")
    raise RuntimeError(f"features job {slug} failed {RETRIES + 1} times")


# ── Sweep ───────────────────────────────────────────────────────────────────

def est_minutes(c: dict, base_steps: int = 20000) -> float:
    steps = c.get("overrides", {}).get("steps", base_steps)
    return MIN_PER_20K_STEPS * steps / 20000


def chunks(configs: list[dict]) -> list[list[dict]]:
    out, cur, t = [], [], SETUP_MIN
    for c in configs:
        m = est_minutes(c)
        if cur and t + m > MAX_KERNEL_MIN:
            out.append(cur)
            cur, t = [], SETUP_MIN
        cur.append(c)
        t += m
    return out + ([cur] if cur else [])


def config_dir(sweep: str, data: str, name: str) -> Path:
    return CACHE / sweep / f"{data}.{name}"


def collect(sweep: str, data: str, out: Path) -> set[str]:
    """Move each finished config's model and score line into its own folder.
    A config that failed is written too, for the table, but is not done."""
    done = set()
    res = next(out.rglob("results.jsonl"), None)
    if not res:
        return done
    for line in res.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        d = config_dir(sweep, data, r["name"])
        d.mkdir(parents=True, exist_ok=True)
        model = next(out.rglob(f"{r['name']}.onnx"), None)
        if model:
            shutil.copy(model, d / "model.onnx")
        r["data"] = data
        (d / "score.json").write_text(json.dumps(r, indent=1))
        if "score" in r and model:
            done.add(r["name"])
    return done


def is_done(sweep: str, data: str, name: str) -> bool:
    p = config_dir(sweep, data, name) / "score.json"
    return p.exists() and "score" in json.loads(p.read_text())


def run_sweep(state: State, who: str, sweep: str, data: str, configs: list[dict], split: str,
              datasets: list[str], kernels: list[str]) -> None:
    done = {c["name"] for c in configs if is_done(sweep, data, c["name"])}
    for i, chunk in enumerate(chunks(configs), 1):
        slug = f"{who}/kachow-sweep-{sweep}-{data}-{i}"
        for attempt in range(RETRIES + 1):
            todo = [c for c in chunk if c["name"] not in done]
            if not todo:
                break
            if needs_push(state, slug, attempt):
                est = SETUP_MIN + sum(est_minutes(c) for c in todo)
                log(f"{slug}: {len(todo)} configs, about {est / 60:.1f} GPU h")
                push_kernel(state, slug, HERE / "sweep-kernel" / "sweep_kernel.py",
                            ("SWEEP", {"configs": todo, "split": split}), datasets, kernels,
                            min(KERNEL_TIMEOUT, int(est * 1.5) + 30))
            status = wait_kernel(state, slug)
            out = CACHE / sweep / "_pulled" / slug.split("/")[1]
            shutil.rmtree(out, ignore_errors=True)
            done |= collect(sweep, data, pull_output(slug, out))
            state.d["kernels"][slug]["pulled"] = True
            state.save()
            left = [c["name"] for c in chunk if c["name"] not in done]
            if left:
                log(f"{slug} ended {status} with {len(left)} configs left: {', '.join(left)}")
        else:
            left = [c["name"] for c in chunk if c["name"] not in done]
            if left:
                log(f"giving up on {', '.join(left)} after {RETRIES + 1} kernels")
        print_table(sweep)


# ── Ranking ─────────────────────────────────────────────────────────────────

def load_results(sweep: str) -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted((CACHE / sweep).glob("*/score.json"))]


def pct(x: float | None) -> str:
    return "   -  " if x is None else f"{100 * x:5.1f}%"


def ranked(sweep: str) -> tuple[list[dict], dict[str, dict]]:
    rs = load_results(sweep)
    ok = [r for r in rs if "score" in r]
    ok.sort(key=lambda r: (-r["score"]["headline_recall"], r["score"]["operating"]["fp_per_hour"]))
    bands = {}
    for data in sorted({r["data"] for r in rs}):
        ctl = [r["score"]["headline_recall"] for r in ok if r["data"] == data and r["name"].startswith("control")]
        if ctl:
            bands[data] = {"min": min(ctl), "max": max(ctl), "mean": sum(ctl) / len(ctl), "n": len(ctl)}
    return ok + [r for r in rs if "score" not in r], bands


def verdict(r: dict, bands: dict[str, dict]) -> str:
    b = bands.get(r["data"])
    if "score" not in r:
        return "FAILED"
    if r["name"].startswith("control") or not b or b["n"] < 2:
        return ""
    h = r["score"]["headline_recall"]
    return "above band" if h > b["max"] else ("below band" if h < b["min"] else "tie (in band)")


def print_table(sweep: str) -> None:
    rows, bands = ranked(sweep)
    if not rows:
        return
    split = next((r["score"].get("split") for r in rows if "score" in r), "?")
    print(f"\n  Sweep {sweep}, ranked on the {split} split: headline, then FP/h at the operating point")
    print(f"  {'#':>2} {'config':<26} {'headline':>8} {'at thr':>8} {'FP/h':>5} {'clean':>6} {'noisy':>6}"
          f" {'echo':>6} {'near':>6} {'min':>5}  verdict")
    for i, r in enumerate(rows, 1):
        tag = f"{r['data']}.{r['name']}"
        if "score" not in r:
            print(f"  {i:>2} {tag:<26} {'FAILED':>8}  {r.get('error', '').strip().splitlines()[-1][:60]}")
            continue
        s, op = r["score"], r["score"]["operating"]
        thr = f"{s['operating_threshold']:.4g}" if s["operating_threshold"] is not None else "never"
        print(f"  {i:>2} {tag:<26} {pct(s['headline_recall'])}  {thr:>8} {op['fp_per_hour']:5.2f}"
              f" {pct(op['recall_clean'])} {pct(op['recall_noisy'])} {pct(op['recall_echo'])}"
              f" {pct(op['near_miss_fire'])} {r.get('minutes', 0):5.1f}  {verdict(r, bands)}")
    for data, b in bands.items():
        print(f"  noise band ({data}, {b['n']} control seeds): {pct(b['min']).strip()} to {pct(b['max']).strip()},"
              f" mean {pct(b['mean']).strip()}")


def winner(rows: list[dict], bands: dict[str, dict]) -> tuple[dict | None, str]:
    """The best config that beat its control seeds' band. With none, the knobs
    are measured ties, and a tie goes to the arm cheapest to reverse: the
    best control (AGENTS.md, "Ties are measured")."""
    ok = [r for r in rows if "score" in r]
    above = [r for r in ok if verdict(r, bands) == "above band"]
    if above:
        return above[0], "beat every control seed"
    controls = [r for r in ok if r["name"].startswith("control")]
    if controls:
        return controls[0], "no config beat the control seeds' band: the knobs are ties and the control stands"
    return (ok[0], "no control seeds to measure a band against") if ok else (None, "nothing trained")


def final_card(sweep: str) -> None:
    w, why = winner(*ranked(sweep))
    if w is None:
        return
    tag = f"{w['data']}.{w['name']}"
    out = CACHE / sweep / "winner"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    shutil.copy(config_dir(sweep, w["data"], w["name"]) / "model.onnx", out / f"{tag}.onnx")
    log(f"winner {tag} ({why}): scoring the final half locally")
    r = subprocess.run(["uv", "run", str(SCORER), "score", str(out / f"{tag}.onnx"),
                        "--split", "final", "--json", str(out / "final.json")],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"scoring the winner's final half failed:\n{r.stderr[-2000:]}")
    (out / "final-card.txt").write_text(r.stdout)
    (out / "settings.json").write_text(json.dumps(
        {"data": w["data"], "name": w["name"], "why": why, "seed": w["seed"], "overrides": w["overrides"]},
        indent=1))
    print(r.stdout)


# ── Commands ────────────────────────────────────────────────────────────────

def run(args: argparse.Namespace) -> None:
    qpath = Path(args.queue).resolve()
    q = json.loads(qpath.read_text())
    sweep = q["sweep"]
    split = q.get("split", "selection")
    state = State(CACHE / sweep / "state.json")
    uploads = State(CACHE / "datasets.json")      # shared by every sweep
    who = owner()
    total = 0.0
    plan = []
    for d in q["data"]:
        configs = json.loads((qpath.parent / d["training"]).read_text())["configs"]
        plan.append((d, configs))
        total += sum(SETUP_MIN + sum(est_minutes(c) for c in ch) for ch in chunks(configs))
        if "job" in d["features"]:
            total += FEATURES_JOB_MIN
    log(f"queue {sweep}: {len(plan)} data configs, {sum(len(c) for _, c in plan)} trainings,"
        f" about {total / 60:.1f} GPU h")
    cap = args.max_gpu_hours or q.get("max_gpu_hours", 4.0)
    if total / 60 > cap:
        sys.exit(f"over the {cap} GPU h cap; cut the queue, or raise max_gpu_hours in it or --max-gpu-hours")
    scorer = scorer_dataset(uploads, who)
    for d, configs in plan:
        f = d["features"]
        if "zip" in f:
            datasets = [scorer, zip_features_dataset(uploads, who, d["name"], Path(f["zip"]).expanduser())]
            kernels = []
        else:
            datasets = [scorer]
            kernels = [features_job(state, who, sweep, d["name"], f["job"])]
        run_sweep(state, who, sweep, d["name"], configs, split, datasets, kernels)
    print_table(sweep)
    final_card(sweep)


def table(args: argparse.Namespace) -> None:
    print_table(args.sweep)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    rp = sub.add_parser("run", help="run a queue to the end (resumes if run again)")
    rp.add_argument("queue")
    rp.add_argument("--max-gpu-hours", type=float,
                    help="refuse a queue estimated above this; default the queue's max_gpu_hours, else 4")
    tp = sub.add_parser("table", help="print the ranked table of a sweep pulled so far")
    tp.add_argument("sweep")
    args = ap.parse_args()
    {"run": run, "table": table}[args.cmd](args)


if __name__ == "__main__":
    main()
