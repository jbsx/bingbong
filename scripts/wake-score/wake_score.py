# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy",
#   "scipy",
#   "soundfile",
#   "onnxruntime",
#   "piper-phonemize-fix==1.2.2",
# ]
# ///
"""Score an openWakeWord-style "kachow" model offline.

  uv run scripts/wake-score/wake_score.py build          # once: make the fixed test set
  uv run scripts/wake-score/wake_score.py score M.onnx   # full score card
  uv run scripts/wake-score/wake_score.py score DIR/     # rank every .onnx in DIR

Nothing here opens a microphone or a speaker. The test set is synthesised from
Piper voices the training notebook never uses (it trains on libritts_r), mixed
with synthetic babble, noise and room echo, and turned into openWakeWord
embeddings once. Scoring a model then only runs its small classifier head, so
a sweep of dozens of models takes seconds each.

The headline is recall at the strictest-needed threshold: the lowest threshold
whose false wakes on openWakeWord's ~11 h held-out validation audio stay at or
under 0.5 per hour, and the share of "kachow" test clips that fire there.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

CACHE = Path(os.environ.get("BINGBONG_WAKE_SCORE_CACHE")
             or Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "bingbong" / "wake-score")
MODELS = Path(os.environ.get("BINGBONG_MODELS_DIR", Path.home() / ".config" / "bingbong" / "models"))
TESTSET = CACHE / "testset.npz"
VAL_FEATURES = CACHE / "validation_set_features.npy"
VAL_URL = ("https://huggingface.co/datasets/davidscripka/openwakeword_features/"
           "resolve/main/validation_set_features.npy")
VOICES_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"

SR = 16000
FRAME_S = 0.08                # one embedding per 80 ms
WINDOW = 16                   # classifier sees 16 embeddings
REFRACTORY_FRAMES = 25        # a wake silences the detector ~2 s: one event, not 25
TARGET_FP_PER_HOUR = 0.5
THRESHOLDS = [0.5, 0.7, 0.85, 0.9, 0.95, 0.99, 0.995]
SEED = 20261026
TESTSET_VERSION = 1

# What "kachow" sounds like when said, as Piper phonemes (espeak IPA). espeak's
# own reading of the spelling "kachow" is kˈætʃaʊ ("KATCH-ow"), which is not it.
# The training notebook uses the same strings, so test and training agree on
# the word; they never share a voice.
POSITIVE_PHONEMES = {
    "kuh-CHOW": "kətʃˈaʊ",
    "kuh-CHOW (open)": "kɐtʃˈaʊ",
    "ka-CHOW (cat)": "kætʃˈaʊ",
    "kah-CHOW": "kˌɑːtʃˈaʊ",
    "kuh-CHOW (cup)": "kʌtʃˈaʊ",
}

# Near misses: things said at home that share sounds with "kachow". These are
# text, phonemised per voice. Some are deliberately absent from training
# ("catch", "ka", "ketchup", "kitchen", "gotcha"...) so the test is not a
# replay of the negative list.
NEAR_MISSES = [
    "chow", "ciao", "chow mein", "catch", "catch up", "catch it now", "cachet",
    "cashew", "Kashmir", "ka", "cow", "how", "wow", "now", "ouch", "couch",
    "pouch", "ketchup", "kitchen", "gotcha", "coach", "touch", "much",
    "watch out", "go ahead", "cut it out", "a chow", "cha cha",
    "kutchra", "kutcha", "kutchori", "kyah hoowa", "utcha", "kuh haan", "chalo",
    "achcha thik hai", "kahaan ho", "bing bong", "hold on", "stop now",
]

# Background speech for babble. Harvard sentences.
BABBLE_TEXT = [
    "The birch canoe slid on the smooth planks.",
    "Glue the sheet to the dark blue background.",
    "It's easy to tell the depth of a well.",
    "These days a chicken leg is a rare dish.",
    "Rice is often served in round bowls.",
    "The juice of lemons makes fine punch.",
    "The box was thrown beside the parked truck.",
    "Four hours of steady work faced us.",
    "A large size in stockings is hard to sell.",
    "The boy was there when the sun rose.",
    "A rod is used to catch pink salmon.",
    "The source of the huge river is the clear spring.",
    "Kick the ball straight and follow through.",
    "Help the woman get back to her feet.",
    "A pot of tea helps to pass the evening.",
    "Smoky fires lack flame and heat.",
    "The soft cushion broke the man's fall.",
    "The salt breeze came across from the sea.",
    "The girl at the booth sold fifty bonds.",
    "The small pup gnawed a hole in the sock.",
]

# Test voices. None is LibriTTS (the training generator). Speaker lists pick
# the Hindi-L1 (L2-ARCTIC) and Indian (VCTK) speakers plus a spread of others.
VOICES = {
    "en_US-l2arctic-medium": {"group": "Indian/L2", "path": "en/en_US/l2arctic/medium/",
                              "speakers": "all", "renders": 2},
    "en_GB-vctk-medium": {"group": "British", "path": "en/en_GB/vctk/medium/",
                          "speakers": ["p248", "p251", "p376", "p225", "p226", "p227", "p228",
                                       "p229", "p230", "p231", "p232", "p233", "p234", "p236",
                                       "p237", "p238", "p239", "p240", "p241", "p243", "p244",
                                       "p245", "p246", "p247", "p249", "p250", "p252", "p253",
                                       "p254", "p255"],
                          "renders": 1},
    "en_US-arctic-medium": {"group": "American", "path": "en/en_US/arctic/medium/",
                            "speakers": "all", "renders": 1},
    "en_GB-aru-medium": {"group": "British", "path": "en/en_GB/aru/medium/",
                         "speakers": "all", "renders": 1},
    "en_US-lessac-medium": {"group": "American", "path": "en/en_US/lessac/medium/", "renders": 4},
    "en_US-ryan-medium": {"group": "American", "path": "en/en_US/ryan/medium/", "renders": 4},
    "en_US-amy-medium": {"group": "American", "path": "en/en_US/amy/medium/", "renders": 4},
    "en_US-hfc_female-medium": {"group": "American", "path": "en/en_US/hfc_female/medium/", "renders": 4},
    "en_US-kusal-medium": {"group": "Indian/L2", "path": "en/en_US/kusal/medium/", "renders": 4},
    "en_GB-alba-medium": {"group": "British", "path": "en/en_GB/alba/medium/", "renders": 4},
    "en_GB-northern_english_male-medium": {"group": "British",
                                           "path": "en/en_GB/northern_english_male/medium/",
                                           "renders": 4},
}
INDIAN_SPEAKERS = {"SVBI", "TNI", "ASI", "RRBI", "p248", "p251", "p376"}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def download(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    log(f"  downloading {dest.name}")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(dest)
    return dest


# ── openWakeWord features ───────────────────────────────────────────────────

class Featurizer:
    """Audio (16 kHz float) → openWakeWord embeddings (n, 96), as the app does."""

    def __init__(self) -> None:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.mel = ort.InferenceSession(str(MODELS / "melspectrogram.onnx"), opts)
        self.emb = ort.InferenceSession(str(MODELS / "embedding_model.onnx"), opts)
        self.mel_in = self.mel.get_inputs()[0].name
        self.emb_in = self.emb.get_inputs()[0].name

    def __call__(self, audio: np.ndarray) -> np.ndarray:
        x = (np.clip(audio, -1, 1) * 32767).astype(np.float32)[None, :]
        spec = self.mel.run(None, {self.mel_in: x})[0].squeeze() / 10 + 2   # (frames, 32)
        starts = range(0, len(spec) - 76 + 1, 8)
        batch = np.stack([spec[i:i + 76] for i in starts])[:, :, :, None].astype(np.float32)
        return self.emb.run(None, {self.emb_in: batch})[0].reshape(len(batch), 96)


# ── Piper synthesis straight from phonemes ──────────────────────────────────

class PiperVoice:
    def __init__(self, name: str, spec: dict) -> None:
        import onnxruntime as ort
        base = VOICES_URL + spec["path"] + name
        onnx = download(base + ".onnx", CACHE / "voices" / f"{name}.onnx")
        cfg = download(base + ".onnx.json", CACHE / "voices" / f"{name}.onnx.json")
        self.cfg = json.loads(cfg.read_text())
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.sess = ort.InferenceSession(str(onnx), opts)
        self.id_map = self.cfg["phoneme_id_map"]
        self.sr = self.cfg["audio"]["sample_rate"]
        self.espeak = self.cfg["espeak"]["voice"]
        self.speakers = self.cfg.get("speaker_id_map") or {}
        self.inputs = {i.name for i in self.sess.get_inputs()}

    def ids(self, phonemes: str) -> list[int]:
        import unicodedata
        out = list(self.id_map["^"]) + list(self.id_map["_"])
        for p in unicodedata.normalize("NFD", phonemes):
            if p not in self.id_map:
                raise ValueError(f"phoneme {p!r} not in this voice's map")
            out += list(self.id_map[p]) + list(self.id_map["_"])
        return out + list(self.id_map["$"])

    def phonemize(self, text: str) -> str:
        from piper_phonemize import phonemize_espeak
        return " ".join("".join(s) for s in phonemize_espeak(text, self.espeak))

    def speak(self, phonemes: str, speaker: str | None, length: float, noise: float,
              noise_w: float) -> np.ndarray:
        from scipy.signal import resample_poly
        ids = np.array([self.ids(phonemes)], dtype=np.int64)
        feed = {"input": ids, "input_lengths": np.array([ids.shape[1]], dtype=np.int64),
                "scales": np.array([noise, length, noise_w], dtype=np.float32)}
        if "sid" in self.inputs:
            feed["sid"] = np.array([self.speakers[speaker] if speaker else 0], dtype=np.int64)
        audio = self.sess.run(None, feed)[0].squeeze().astype(np.float32)
        if self.sr != SR:
            g = np.gcd(SR, self.sr)
            audio = resample_poly(audio, SR // g, self.sr // g).astype(np.float32)
        peak = np.abs(audio).max()
        return audio / peak * 0.7 if peak > 0 else audio


# ── Acoustic conditions (independent of the notebook's FMA / MIT data) ──────

def pink_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(n)
    f = np.fft.rfftfreq(n)
    f[0] = f[1]
    pink = np.fft.irfft(np.fft.rfft(white) / np.sqrt(f), n)
    return (pink / np.abs(pink).max()).astype(np.float32)


def synthetic_rir(rng: np.random.Generator) -> np.ndarray:
    rt60 = rng.uniform(0.25, 0.8)
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    rir = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    rir[0] = 1.0 / rng.uniform(0.3, 1.0)      # direct path vs reverberant energy
    return (rir / np.sqrt((rir ** 2).sum())).astype(np.float32)


def mix_at_snr(speech: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    ps = np.mean(speech[np.abs(speech) > 1e-3] ** 2) if np.any(np.abs(speech) > 1e-3) else 1e-6
    pn = np.mean(noise ** 2) + 1e-12
    return speech + noise * np.sqrt(ps / (pn * 10 ** (snr_db / 10)))


def pad(clip: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """1.5 s before (the window needs context), 1 s after, faint dither throughout."""
    out = np.concatenate([np.zeros(int(1.5 * SR), np.float32), clip, np.zeros(SR, np.float32)])
    return out + rng.standard_normal(len(out)).astype(np.float32) * 1e-4


def conditions(clip: np.ndarray, babble: list[np.ndarray], rng: np.random.Generator):
    """clean, babble/noise at 5–15 dB, and room echo plus noise."""
    yield "clean", pad(clip, rng)

    def bed(n: int) -> np.ndarray:
        if rng.random() < 0.6:
            b = babble[rng.integers(len(babble))]
            start = rng.integers(0, max(1, len(b) - n))
            seg = np.resize(b[start:start + n], n)
        else:
            seg = pink_noise(n, rng)
        return seg

    p = pad(clip, rng)
    yield "noisy", mix_at_snr(p, bed(len(p)), rng.uniform(5, 15))

    from scipy.signal import fftconvolve
    wet = fftconvolve(clip, synthetic_rir(rng))[: len(clip) + SR // 2].astype(np.float32)
    wet = wet / (np.abs(wet).max() + 1e-9) * 0.7
    p = pad(wet, rng)
    yield "echo", mix_at_snr(p, bed(len(p)), rng.uniform(10, 20))


# ── build ───────────────────────────────────────────────────────────────────

def render_params(rng: np.random.Generator) -> tuple[float, float, float]:
    return (float(rng.choice([0.8, 0.9, 1.0, 1.15, 1.3])),
            float(rng.choice([0.5, 0.667, 0.85])),
            float(rng.choice([0.6, 0.8, 1.0])))


def build(args: argparse.Namespace) -> None:
    import soundfile as sf
    from scipy.signal import resample_poly
    rng = np.random.default_rng(SEED)
    CACHE.mkdir(parents=True, exist_ok=True)
    download(VAL_URL, VAL_FEATURES)
    val = np.load(VAL_FEATURES, mmap_mode="r")
    assert val.ndim == 2 and val.shape[1] == 96, f"unexpected validation shape {val.shape}"
    log(f"  validation audio: {val.shape[0] * FRAME_S / 3600:.1f} h")

    feat = Featurizer()
    voices = {name: PiperVoice(name, spec) for name, spec in VOICES.items()}

    log("  babble bed")
    babble = []
    names = list(voices)
    for i in range(24):
        layers = []
        for _ in range(3):
            v = voices[names[rng.integers(len(names))]]
            spk = rng.choice(list(v.speakers)) if v.speakers else None
            parts = [v.speak(v.phonemize(BABBLE_TEXT[rng.integers(len(BABBLE_TEXT))]), spk,
                             *render_params(rng)) for _ in range(3)]
            layers.append(np.concatenate(parts))
        n = min(len(x) for x in layers)
        babble.append(np.sum([x[:n] for x in layers], axis=0).astype(np.float32))

    embs, meta = [], []

    def add(audio: np.ndarray, **m) -> None:
        e = feat(audio)
        embs.append(e.astype(np.float16))
        meta.append(m)

    t0 = time.time()
    for name, spec in VOICES.items():
        v = voices[name]
        spks = spec.get("speakers")
        spks = list(v.speakers) if spks == "all" else (spks or [None])
        n_pos = n_neg = 0
        for spk in spks:
            for _ in range(spec["renders"]):
                for label, ph in POSITIVE_PHONEMES.items():
                    clip = v.speak(ph, spk, *render_params(rng))
                    for cond, audio in conditions(clip, babble, rng):
                        add(audio, kind="positive", voice=name, speaker=spk or "", group=spec["group"],
                            indian=(spk in INDIAN_SPEAKERS) or name == "en_US-kusal-medium",
                            variant=label, condition=cond)
                        n_pos += 1
            # Near misses: every speaker says a handful; across the set each
            # phrase is heard many times, from many voices.
            for text in rng.choice(NEAR_MISSES, size=min(len(NEAR_MISSES), 4 * spec["renders"] + 2),
                                   replace=False):
                clip = v.speak(v.phonemize(str(text)), spk, *render_params(rng))
                for cond, audio in list(conditions(clip, babble, rng))[:2]:
                    add(audio, kind="near_miss", voice=name, speaker=spk or "", group=spec["group"],
                        indian=False, variant=str(text), condition=cond)
                    n_neg += 1
        log(f"  {name}: {n_pos} positive, {n_neg} near-miss clips ({time.time() - t0:.0f}s)")

    own = CACHE / "recordings"
    for kind, sub in (("own_positive", "positive"), ("own_near_miss", "negative")):
        for wav in sorted((own / sub).glob("*.wav")):
            a, sr = sf.read(wav, dtype="float32", always_2d=True)
            a = a.mean(1)
            if sr != SR:
                g = np.gcd(SR, sr)
                a = resample_poly(a, SR // g, sr // g).astype(np.float32)
            add(pad(a, rng), kind=kind, voice="you", speaker="", group="You", indian=False,
                variant=wav.name, condition="recorded")
    n_own = sum(m["voice"] == "you" for m in meta)
    if n_own:
        log(f"  your recordings: {n_own} clips")

    lengths = np.array([len(e) for e in embs])
    np.savez_compressed(TESTSET, embeddings=np.concatenate(embs), lengths=lengths,
                        meta=json.dumps({"version": TESTSET_VERSION, "seed": SEED, "clips": meta}))
    log(f"  wrote {TESTSET} ({len(meta)} clips, {TESTSET.stat().st_size / 1e6:.0f} MB)")


# ── score ───────────────────────────────────────────────────────────────────

class Head:
    def __init__(self, path: Path) -> None:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        self.sess = ort.InferenceSession(str(path), opts)
        self.inp = self.sess.get_inputs()[0].name
        self.batched = True

    def __call__(self, windows: np.ndarray, chunk: int = 8192) -> np.ndarray:
        out = np.empty(len(windows), np.float32)
        for i in range(0, len(windows), chunk):
            w = np.ascontiguousarray(windows[i:i + chunk], dtype=np.float32)
            if self.batched:
                try:
                    out[i:i + len(w)] = self.sess.run(None, {self.inp: w})[0].reshape(-1)[: len(w)]
                    continue
                except Exception:
                    self.batched = False   # some stock heads only take batch 1
            out[i:i + len(w)] = [self.sess.run(None, {self.inp: x[None]})[0].ravel()[0] for x in w]
        return out


def windows_of(e: np.ndarray) -> np.ndarray:
    from numpy.lib.stride_tricks import sliding_window_view
    return sliding_window_view(e, (WINDOW, 96))[:, 0]   # a view: no 3 GB copy on the 11 h set


def fp_events(scores: np.ndarray, t: float) -> int:
    above = np.flatnonzero(scores >= t)
    n, last = 0, -10**9
    for i in above:
        if i - last >= REFRACTORY_FRAMES:
            n, last = n + 1, i
    return n


def model_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def validation_scores(head: Head, path: Path) -> np.ndarray:
    cache = CACHE / "val-scores" / f"{model_hash(path)}.npy"
    if cache.exists():
        return np.load(cache)
    val = np.load(VAL_FEATURES, mmap_mode="r")
    s = head(windows_of(np.asarray(val)))
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.save(cache, s)
    return s


def score_model(path: Path, ts: dict) -> dict:
    head = Head(path)
    clip_max = np.array([head(windows_of(e)).max() for e in ts["clips_emb"]])
    val = validation_scores(head, path)
    hours = (len(val) + WINDOW - 1) * FRAME_S / 3600
    meta = ts["meta"]
    kind = np.array([m["kind"] for m in meta])
    pos, near = kind == "positive", kind == "near_miss"

    grid = np.unique(np.concatenate([np.linspace(0.05, 0.99, 95),
                                     1 - np.logspace(-2, -6, 41), THRESHOLDS]))
    # FP events only fall as the threshold rises, so the first grid point at or
    # under target is the operating point.
    op = None
    for t in grid:
        if fp_events(val, t) / hours <= TARGET_FP_PER_HOUR:
            op = float(t)
            break

    def row(t: float) -> dict:
        r = {"threshold": round(t, 6), "recall": float((clip_max[pos] >= t).mean()),
             "near_miss_fire": float((clip_max[near] >= t).mean()),
             "fp_per_hour": fp_events(val, t) / hours}
        for c in ("clean", "noisy", "echo"):
            sel = pos & np.array([m["condition"] == c for m in meta])
            r[f"recall_{c}"] = float((clip_max[sel] >= t).mean())
        for k in ("own_positive", "own_near_miss"):
            sel = kind == k
            if sel.any():
                r[k] = float((clip_max[sel] >= t).mean())
        return r

    def by(field: str, t: float, mask: np.ndarray) -> dict:
        vals = np.array([str(m[field]) for m in meta])
        return {k: float((clip_max[mask & (vals == k)] >= t).mean())
                for k in sorted(set(vals[mask]))}

    t_ref = op if op is not None else 0.5
    indian = np.array([bool(m["indian"]) for m in meta])
    res = {
        "model": str(path), "sha": model_hash(path),
        "validation_hours": hours,
        "operating_threshold": op,
        "headline_recall": row(op)["recall"] if op is not None else 0.0,
        "operating": row(t_ref),
        "thresholds": [row(t) for t in THRESHOLDS],
        "by_variant": by("variant", t_ref, pos),
        "by_group": by("group", t_ref, pos),
        "indian_speakers": float((clip_max[pos & indian] >= t_ref).mean()),
        "near_miss_by_phrase": dict(sorted(by("variant", t_ref, near).items(),
                                           key=lambda kv: -kv[1])),
        "counts": {"positive": int(pos.sum()), "near_miss": int(near.sum()),
                   "own_positive": int((kind == "own_positive").sum()),
                   "own_near_miss": int((kind == "own_near_miss").sum())},
    }
    return res


def pct(x: float) -> str:
    return f"{100 * x:5.1f}%"


def print_card(r: dict) -> None:
    op = r["operating_threshold"]
    print(f"\n{Path(r['model']).name}  (sha {r['sha']})")
    print(f"  test clips: {r['counts']['positive']} kachow, {r['counts']['near_miss']} near-miss;"
          f" {r['validation_hours']:.1f} h of everyday audio for false wakes")
    if op is None:
        print(f"  HEADLINE: never reaches {TARGET_FP_PER_HOUR} false wakes/hour at any threshold -> 0%")
    else:
        print(f"  HEADLINE: {pct(r['headline_recall']).strip()} of kachows wake it at threshold {op:.4g},"
              f" where false wakes are {r['operating']['fp_per_hour']:.2f}/hour")
    has_own = "own_positive" in r["operating"]
    print(f"\n  {'threshold':>9}  {'recall':>6}  {'clean':>6}  {'noisy':>6}  {'echo':>6}"
          f"  {'near-miss':>9}  {'FP/hour':>7}" + (f"  {'you':>6}" if has_own else ""))
    rows = {x["threshold"]: x for x in r["thresholds"] + ([r["operating"]] if op is not None else [])}
    for x in sorted(rows.values(), key=lambda x: x["threshold"]):
        mark = " <- operating point" if op is not None and x["threshold"] == round(op, 6) else ""
        own = f"  {pct(x['own_positive'])}" if has_own else ""
        print(f"  {x['threshold']:>9.4g}  {pct(x['recall'])}  {pct(x['recall_clean'])}  {pct(x['recall_noisy'])}"
              f"  {pct(x['recall_echo'])}  {pct(x['near_miss_fire']):>9}  {x['fp_per_hour']:7.2f}{own}{mark}")
    at = f"at threshold {op:.4g}" if op is not None else "at threshold 0.5"
    print(f"\n  Recall by pronunciation ({at}):")
    for k, v in r["by_variant"].items():
        print(f"    {k:<18} {pct(v)}")
    print(f"  Recall by accent group: " + ", ".join(f"{k} {pct(v).strip()}" for k, v in r["by_group"].items())
          + f"; Indian speakers {pct(r['indian_speakers']).strip()}")
    worst = [(k, v) for k, v in r["near_miss_by_phrase"].items() if v > 0][:8]
    print("  Near misses that fire: " + (", ".join(f"{k} {pct(v).strip()}" for k, v in worst) or "none"))


def score(args: argparse.Namespace) -> None:
    if not TESTSET.exists():
        sys.exit(f"no test set at {TESTSET}; run `wake_score.py build` first")
    z = np.load(TESTSET)
    meta = json.loads(str(z["meta"]))
    if meta.get("version") != TESTSET_VERSION:
        sys.exit("test set is from another version of this script; rerun build")
    emb = z["embeddings"].astype(np.float32)
    ends = np.cumsum(z["lengths"])
    ts = {"meta": meta["clips"], "clips_emb": np.split(emb, ends[:-1])}

    paths: list[Path] = []
    for p in map(Path, args.models):
        paths += sorted(p.glob("*.onnx")) if p.is_dir() else [p]
    results = []
    for p in paths:
        log(f"  scoring {p.name}")
        results.append(score_model(p, ts))
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=1))
    if len(results) == 1:
        print_card(results[0])
        return
    results.sort(key=lambda r: (-r["headline_recall"], r["operating"]["fp_per_hour"]))
    print(f"\n  {'model':<36} {'headline':>8} {'at thr':>8} {'recall@0.5':>10} {'FP/h@0.5':>8} {'near-miss':>9}")
    for r in results:
        t05 = next(x for x in r["thresholds"] if x["threshold"] == 0.5)
        thr = f"{r['operating_threshold']:.4g}" if r["operating_threshold"] is not None else "never"
        print(f"  {Path(r['model']).name:<36} {pct(r['headline_recall'])}  {thr:>8} {pct(t05['recall']):>10}"
              f" {t05['fp_per_hour']:8.2f} {pct(r['operating']['near_miss_fire']):>9}")
    if args.cards:
        for r in results:
            print_card(r)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("build", help="download voices and validation audio, synthesise and featurise the test set")
    sp = sub.add_parser("score", help="score one or more .onnx models (files or directories)")
    sp.add_argument("models", nargs="+")
    sp.add_argument("--json", help="also write the full results here")
    sp.add_argument("--cards", action="store_true", help="print a full card per model when ranking several")
    args = ap.parse_args()
    {"build": build, "score": score}[args.cmd](args)


if __name__ == "__main__":
    main()
