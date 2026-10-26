"""Kaggle kernel: make one features set for the kachow sweep.

Blocks 1-13 of scripts/wake-train/train_wakeword.ipynb, with /content moved
to /kaggle/working/work and the notebook's fixes kept as they are (the
Python 3.13 pins, --no-deps openwakeword, Patches A-H). Two changes, both
for Kaggle's 20 GB disk:

- FMA (block 7-8): the 8 GB zip is never downloaded. Its central directory
  is read over HTTP ranges and only the 1,500 MP3s block 8 converts are
  fetched.
- ACAV (blocks 7 and 9): not fetched here at all. Clip generation and
  augmentation never read it; the sweep kernel fetches the first tenth of
  its rows, block 9's training subset, by byte range.

The output is /kaggle/working/features/: the four *_features_*.npy files
and my_model.yaml, which a sweep kernel mounts as a kernel source.

The driver (scripts/wake-sweep/wake_sweep.py) writes the real DATA line
below: the data config's name and its overrides of the block-10 config.
"""

import glob
import io
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

DATA = {"name": "control", "overrides": {}}

OUT = Path("/kaggle/working/features")
W = "/kaggle/working/work"
os.makedirs(W, exist_ok=True)
os.chdir(W)
T0 = time.time()


def log(msg):
    print(f"[{(time.time() - T0) / 60:6.1f}m] {msg}", flush=True)


def sh(cmd, check=True):
    log(f"$ {cmd[:200]}")
    r = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    tail = (r.stdout + r.stderr).strip().splitlines()[-15:]
    if tail:
        print("\n".join(tail), flush=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"failed ({r.returncode}): {cmd}")
    return r


# ── 1. Install ──────────────────────────────────────────────────────────────
sh("apt-get install -y -qq cmake espeak-ng espeak-ng-data libespeak-ng-dev libsndfile1 pkg-config "
   "build-essential ffmpeg unzip 2>&1 | tail -3", check=False)
log(f"Python {sys.version.split()[0]}")
sh(f"{sys.executable} -m pip install -q piper-phonemize-fix==1.2.2")
sh(f"{sys.executable} -m pip install -q webrtcvad-wheels mutagen==1.47.0 torchinfo torchmetrics pyyaml tqdm "
   "datasets soundfile audiomentations torch_audiomentations pronouncing onnxruntime onnx speechbrain "
   "acoustics scipy requests huggingface_hub")
sh(f"{sys.executable} -m pip install -q --no-deps piper-tts")

# ── 2. Clone repos + download the libritts model ────────────────────────────
PSG_DIR = f"{W}/piper-sample-generator"
PSG_PIN = "1a8c49bd29b3a132721086ee88f2253f788594a8^"
if not os.path.exists(f"{PSG_DIR}/generate_samples.py"):
    shutil.rmtree(PSG_DIR, ignore_errors=True)
    sh(f"git clone -q https://github.com/rhasspy/piper-sample-generator {PSG_DIR}")
sh(f"cd {PSG_DIR} && git fetch -q --all && git checkout -q {PSG_PIN}")
PIPER_MODEL = f"{PSG_DIR}/models/en_US-libritts_r-medium.pt"
if not os.path.exists(PIPER_MODEL) or os.path.getsize(PIPER_MODEL) < 100_000_000:
    os.makedirs(f"{PSG_DIR}/models", exist_ok=True)
    sh(f"wget -q --tries=5 --timeout=300 -O {PIPER_MODEL} "
       "https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt")
assert os.path.getsize(PIPER_MODEL) > 100_000_000
OWW_DIR = f"{W}/openwakeword"
if not os.path.exists(f"{OWW_DIR}/openwakeword/train.py"):
    shutil.rmtree(OWW_DIR, ignore_errors=True)
    sh(f"git clone -q https://github.com/dscripka/openwakeword {OWW_DIR}")
    sh(f"cd {OWW_DIR} && git checkout -q $(git rev-list -n1 --before=2026-05-09 HEAD)")
sh(f"{sys.executable} -m pip install -q --no-deps -e {OWW_DIR}")
sh(f"{sys.executable} -m pip install -q onnxruntime tqdm scipy scikit-learn requests")
sys.path.insert(0, OWW_DIR)
os.environ["PYTHONPATH"] = OWW_DIR + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else "")
r = subprocess.run([sys.executable, "-c", "import openwakeword, openwakeword.data, openwakeword.utils"],
                   capture_output=True, text=True)
assert r.returncode == 0, f"a subprocess cannot import openwakeword:\n{r.stderr[-2000:]}"

# ── 3. Patches A-H, as in the notebook ──────────────────────────────────────
for path in glob.glob("/usr/local/lib/python*/dist-packages/torch_audiomentations/utils/io.py"):
    sh(f"sed -i 's|torchaudio.set_audio_backend(\"soundfile\")|pass  # patched|' \"{path}\"")      # A
src, dst = f"{PSG_DIR}/generate_samples.py", f"{OWW_DIR}/openwakeword/generate_samples.py"
os.environ["HF_HUB_ETAG_TIMEOUT"] = "120"                                                        # C
os.environ["HF_HUB_DOWNLOAD_TIMEOUT"] = "120"
import huggingface_hub.constants as hfc  # noqa: E402

for attr in ["DEFAULT_ETAG_TIMEOUT", "DEFAULT_DOWNLOAD_TIMEOUT", "HF_HUB_ETAG_TIMEOUT", "HF_HUB_DOWNLOAD_TIMEOUT"]:
    if hasattr(hfc, attr):
        setattr(hfc, attr, 120)
import torchaudio  # noqa: E402                                                                   # D

SHIM_MARKER = "# ── PATCH: info() shim for torchaudio 2.x ──"
if SHIM_MARKER not in open(torchaudio.__file__).read():
    with open(torchaudio.__file__, "a") as f:
        f.write(f"\n\n{SHIM_MARKER}\n"
                "def info(file_path, *args, **kwargs):\n"
                "    import soundfile as _sf\n"
                "    si = _sf.info(str(file_path))\n"
                "    return type(\"_TorchaudioInfo\", (), {\n"
                "        \"num_frames\": si.frames, \"sample_rate\": si.samplerate,\n"
                "        \"num_channels\": si.channels, \"bits_per_sample\": 16,\n"
                "        \"encoding\": \"PCM_S\",\n"
                "    })()\n")
sh(f"sed -i 's|model: Union\\[str, Path\\],|model: Union[str, Path] = \"{PIPER_MODEL}\",|' \"{src}\"")  # E
TRAIN_PY = f"{OWW_DIR}/openwakeword/train.py"
sh(f"sed -i 's|val_predictions = self.model(x_val)$|val_predictions = self.model(x_val.float())|' \"{TRAIN_PY}\"")  # F
DATA_PY = f"{OWW_DIR}/openwakeword/data.py"                                                      # G
_old = "    input_text_phones = [pronouncing.phones_for_word(i) for i in input_text.split()]\n"
_new = ("    # PATCH: DeepPhonemizer's model URL 403s; give CMUdict-missing words by hand.\n"
        "    _custom_phones = {'kachow': ['K AH0 CH AW1'], 'kuh': ['K AH1'],\n"
        "        '/kətʃˈaʊ/': ['K AH0 CH AW1'], '/kɐtʃˈaʊ/': ['K AH0 CH AW1'], '/kætʃˈaʊ/': ['K AE0 CH AW1'],\n"
        "        '/kˌɑːtʃˈaʊ/': ['K AA2 CH AW1'], '/kʌtʃˈaʊ/': ['K AH2 CH AW1']}\n"
        "    input_text_phones = [pronouncing.phones_for_word(i) or _custom_phones.get(i.lower(), []) for i in input_text.split()]\n")
_s = open(DATA_PY).read()
if "_custom_phones" not in _s:
    assert _s.count(_old) == 1, "Patch G anchor not found in data.py"
    open(DATA_PY, "w").write(_s.replace(_old, _new))
_bad = f"{OWW_DIR}/openwakeword/resources/en_us_cmudict_forward.pt"
if os.path.exists(_bad) and os.path.getsize(_bad) < 1_000_000:
    os.remove(_bad)
_old = "    # Combine all sentences\n    if phoneme_input:\n"                                         # H
_new = ("    # PATCH: '/.../' is spoken exactly as written (raw espeak IPA).\n"
        "    if len(text) > 2 and text.startswith('/') and text.endswith('/'):\n"
        "        text, phoneme_input = text[1:-1], True\n"
        "    # Combine all sentences\n    if phoneme_input:\n")
_s = open(src).read()
if "PATCH: '/.../'" not in _s:
    assert _s.count(_old) == 1, "Patch H anchor not found in generate_samples.py"
    open(src, "w").write(_s.replace(_old, _new))
shutil.copy(src, dst)                                                                             # B, after E and H
log("patches A-H applied")

# ── 4. Pre-flight ───────────────────────────────────────────────────────────
import importlib  # noqa: E402

for mod in ["torch", "torchinfo", "torchmetrics", "scipy", "numpy", "tqdm", "yaml", "mutagen", "pronouncing",
            "torchaudio", "audiomentations", "torch_audiomentations", "speechbrain", "acoustics", "onnx",
            "onnxruntime", "soundfile", "requests", "huggingface_hub", "piper_phonemize", "piper", "openwakeword"]:
    importlib.import_module(mod)
from openwakeword.data import augment_clips, generate_adversarial_texts, mmap_batch_generator  # noqa: E402,F401
from openwakeword.utils import AudioFeatures, compute_features_from_generator  # noqa: E402,F401

import torch  # noqa: E402

log(f"pre-flight passed; CUDA {torch.cuda.is_available()}")

# ── 5. openWakeWord mel + embedding models ──────────────────────────────────
models_dir = f"{OWW_DIR}/openwakeword/resources/models"
os.makedirs(models_dir, exist_ok=True)
for fname in ["embedding_model.onnx", "embedding_model.tflite", "melspectrogram.onnx", "melspectrogram.tflite"]:
    out = f"{models_dir}/{fname}"
    if not (os.path.exists(out) and os.path.getsize(out) > 1000):
        sh(f"wget -q --tries=5 --timeout=120 https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/{fname} -O {out}")

# ── 6. MIT impulse responses → 16 kHz WAVs ──────────────────────────────────
import numpy as np  # noqa: E402
import scipy.io.wavfile as wavfile  # noqa: E402

rir_dir = f"{W}/mit_rirs"
os.makedirs(rir_dir, exist_ok=True)
if len([f for f in os.listdir(rir_dir) if f.endswith(".wav")]) < 250:
    import datasets  # noqa: E402
    from huggingface_hub import snapshot_download  # noqa: E402
    for i in range(6):
        try:
            snapshot_download(repo_id="davidscripka/MIT_environmental_impulse_responses", repo_type="dataset",
                              etag_timeout=120, max_workers=4)
            break
        except Exception as e:
            log(f"snapshot_download attempt {i + 1}/6: {e}")
            time.sleep(15 * (i + 1))
    for attempt in range(4):
        try:
            rir_dataset = datasets.load_dataset("davidscripka/MIT_environmental_impulse_responses", split="train",
                                                streaming=False)
            break
        except Exception as e:
            log(f"load_dataset attempt {attempt + 1}: {e}")
            time.sleep(20 * (attempt + 1))
    else:
        raise RuntimeError("load_dataset failed for MIT IRs")
    from scipy.signal import resample_poly  # noqa: E402
    for i, row in enumerate(rir_dataset):
        out = f"{rir_dir}/{i:04d}.wav"
        if os.path.exists(out):
            continue
        sr, arr = row["audio"]["sampling_rate"], np.asarray(row["audio"]["array"])
        if sr != 16000:
            arr = resample_poly(arr, 16000, sr)
        wavfile.write(out, 16000, (arr * 32767).clip(-32768, 32767).astype(np.int16))
log(f"{len(os.listdir(rir_dir))} MIT IR WAVs")

# ── 7-8. FMA: 1,500 MP3s out of the remote zip → 16 kHz mono WAVs ───────────
import requests  # noqa: E402


class HttpFile(io.RawIOBase):
    """A seekable read-only file over HTTP ranges, enough for zipfile."""

    def __init__(self, url):
        self.url, self.pos, self.s = url, 0, requests.Session()
        self.size = int(self.s.head(url, allow_redirects=True, timeout=120).headers["content-length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = {0: off, 1: self.pos + off, 2: self.size + off}[whence]
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size:
            return 0
        end = min(self.size, self.pos + len(b)) - 1
        for attempt in range(6):
            try:
                r = self.s.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=120)
                r.raise_for_status()
                break
            except Exception:
                if attempt == 5:
                    raise
                time.sleep(5 * (attempt + 1))
        n = len(r.content)
        b[:n] = r.content
        self.pos += n
        return n


fma_wav = f"{W}/fma_wav"
os.makedirs(fma_wav, exist_ok=True)
if len(os.listdir(fma_wav)) < 1500:
    zf = zipfile.ZipFile(io.BufferedReader(HttpFile("https://os.unil.cloud.switch.ch/fma/fma_small.zip"),
                                           buffer_size=1 << 20))
    mp3s = sorted(n for n in zf.namelist() if n.endswith(".mp3"))
    assert len(mp3s) >= 1500, f"FMA zip lists only {len(mp3s)} MP3s"
    tmp_mp3 = f"{W}/fma_tmp.mp3"
    for i, name in enumerate(mp3s[:1500]):
        out = f"{fma_wav}/{i:05d}.wav"
        if os.path.exists(out):
            continue
        with open(tmp_mp3, "wb") as f:
            f.write(zf.read(name))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp_mp3, "-ac", "1", "-ar", "16000", out],
                       check=False)
        if i % 250 == 0:
            log(f"  FMA {i}/1500")
log(f"{len(os.listdir(fma_wav))} FMA WAVs")

# ── 10. Training config: the notebook's block 10, then this data config ─────
import yaml  # noqa: E402

TARGET_PHRASE = ["/kətʃˈaʊ/", "/kɐtʃˈaʊ/", "/kætʃˈaʊ/", "/kˌɑːtʃˈaʊ/", "/kʌtʃˈaʊ/"]
MODEL_NAME = "kachow"
config = {
    "target_phrase": TARGET_PHRASE,
    "model_name": MODEL_NAME,
    "custom_negative_phrases": [
        "ciao", "chow", "chow mein", "catch up", "cachet", "cashew",
        "Kashmir", "how", "wow", "now", "cow", "ouch",
        "kutchra", "kutcha", "kutchori", "kyah hoowa", "utcha", "kuh haan", "chalo",
        "stop now", "hold on",
    ],
    "n_samples": 20000,
    "n_samples_val": 2000,
    "tts_batch_size": 50,
    "piper_sample_generator_path": PSG_DIR,
    "augmentation_rounds": 2,
    "augmentation_batch_size": 16,
    "steps": 20000,
    "max_negative_weight": 1500,
    "target_accuracy": 0.7,
    "target_recall": 0.5,
    "target_false_positives_per_hour": 0.5,
    "batch_size": 128,
    "learning_rate": 1e-4,
    "model_type": "dnn",
    "layer_dim": 128,
    "layer_size": 128,
    "n_blocks": 1,
    "model_input_shape": [16, 96],
    "n_classes": 1,
    "batch_n_per_class": {"ACAV100M_sample": 64, "adversarial_negative": 32, "positive": 32},
    "background_paths": [fma_wav],
    "background_paths_duplication_rate": [1],
    "rir_paths": [rir_dir],
    "false_positive_validation_data_path": f"{W}/validation_set_features.npy",
    "feature_data_files": {"ACAV100M_sample": f"{W}/acav_train_subset.npy"},
    "output_dir": f"{W}/{MODEL_NAME}_output",
    "tflite_export": False,
    "onnx_export": True,
    "positive_clips_train_dir": f"{W}/{MODEL_NAME}_output/{MODEL_NAME}/positive_train",
    "positive_clips_test_dir": f"{W}/{MODEL_NAME}_output/{MODEL_NAME}/positive_test",
    "negative_clips_train_dir": f"{W}/{MODEL_NAME}_output/{MODEL_NAME}/negative_train",
    "negative_clips_test_dir": f"{W}/{MODEL_NAME}_output/{MODEL_NAME}/negative_test",
    "feature_save_dir": f"{W}/{MODEL_NAME}_output/{MODEL_NAME}",
}
config.update(DATA["overrides"])
_map = json.load(open(f"{PIPER_MODEL}.json"))["phoneme_id_map"]
import unicodedata  # noqa: E402

for _p in config["target_phrase"]:
    if _p.startswith("/"):
        _missing = [c for c in unicodedata.normalize("NFD", _p[1:-1]) if c not in _map]
        assert not _missing, f"{_p}: phonemes {_missing} not in the libritts voice"
os.makedirs(config["output_dir"], exist_ok=True)
YAML = f"{W}/my_model.yaml"
with open(YAML, "w") as f:
    yaml.dump(config, f, sort_keys=False)
log(f"data config {DATA['name']}: overrides {DATA['overrides']}")

# ── 11. Piper TTS clips ─────────────────────────────────────────────────────
dirs = {
    "positive_train": (config["positive_clips_train_dir"], int(config["n_samples"] * 0.75)),
    "positive_test": (config["positive_clips_test_dir"], int(config["n_samples_val"] * 0.75)),
    "negative_train": (config["negative_clips_train_dir"], int(config["n_samples"] * 0.75)),
    "negative_test": (config["negative_clips_test_dir"], int(config["n_samples_val"] * 0.75)),
}


def counts():
    return {k: (len(os.listdir(p)) if os.path.isdir(p) else 0, n) for k, (p, n) in dirs.items()}


if not all(n >= e for n, e in counts().values()):
    sh(f"{sys.executable} {TRAIN_PY} --training_config {YAML} --generate_clips")
for k, (n, e) in counts().items():
    assert n >= e, f"generate_clips left {k} with only {n} clips (expected >={e})"
log(f"clips {counts()}")

# ── 12. Resample TTS clips 22050 → 16000 Hz ─────────────────────────────────
import soundfile as sf  # noqa: E402
from scipy.signal import resample_poly  # noqa: E402

ROOT = config["output_dir"]
for d in sorted({os.path.dirname(f) for f in glob.glob(f"{ROOT}/**/*.wav", recursive=True)}):
    files = [f for f in os.listdir(d) if f.endswith(".wav")]
    if all(sf.info(f"{d}/{f}").samplerate == 16000 for f in files[:20]):
        continue
    for f in files:
        data, sr = sf.read(f"{d}/{f}")
        if sr != 16000:
            sf.write(f"{d}/{f}", resample_poly(data.astype("float32"), 16000, sr), 16000)
    log(f"resampled {d}")
for f in glob.glob(f"{ROOT}/**/*.npy", recursive=True):
    os.remove(f)

# ── 13. Augment + featurise ─────────────────────────────────────────────────
FEAT = config["feature_save_dir"]
needed = ["positive_features_train.npy", "negative_features_train.npy",
          "positive_features_test.npy", "negative_features_test.npy"]
sh(f"{sys.executable} {TRAIN_PY} --training_config {YAML} --augment_clips")
for n in needed:
    assert os.path.exists(f"{FEAT}/{n}"), f"augment didn't produce {n}"

# ── Output: the features set, and nothing else ──────────────────────────────
OUT.mkdir(parents=True, exist_ok=True)
for n in needed:
    shutil.move(f"{FEAT}/{n}", OUT / n)
shutil.copy(YAML, OUT / "my_model.yaml")
(OUT / "data.json").write_text(json.dumps(DATA, indent=1))
shutil.rmtree(W, ignore_errors=True)
log(f"features set {DATA['name']} written: {sorted(p.name for p in OUT.iterdir())}")
