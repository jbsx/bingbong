# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy", "onnxruntime", "onnx", "pytest"]
# ///
"""The selection / final split.  uv run scripts/wake-score/test_wake_score.py"""

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

CACHE = Path(tempfile.mkdtemp(prefix="wake-score-test-"))
os.environ["BINGBONG_WAKE_SCORE_CACHE"] = str(CACHE)
_spec = importlib.util.spec_from_file_location("wake_score", Path(__file__).with_name("wake_score.py"))
ws = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ws)


def max_head(path: Path) -> Path:
    """A head whose score is the largest value in its window."""
    import onnx
    from onnx import TensorProto, helper
    x = helper.make_tensor_value_info("x", TensorProto.FLOAT, ["n", 16, 96])
    y = helper.make_tensor_value_info("y", TensorProto.FLOAT, ["n"])
    axes = helper.make_tensor("axes", TensorProto.INT64, [2], [1, 2])
    node = helper.make_node("ReduceMax", ["x", "axes"], ["y"], keepdims=0)
    g = helper.make_graph([node], "max", [x], [y], initializer=[axes])
    m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 18)])
    m.ir_version = 9            # onnxruntime lags the onnx package
    onnx.save(m, path)
    return path


def clip(value: float) -> np.ndarray:
    return np.full((20, 96), value, np.float32)


@pytest.fixture(scope="module")
def world():
    # Six hours of everyday audio. The first half is silent; the second half
    # carries a hot 0.97 frame every minute, so only the final half false-wakes.
    frames = int(6 * 3600 / ws.FRAME_S)
    val = np.zeros((frames, 96), np.float32)
    val[frames // 2 + 100::750] = 0.97
    np.save(ws.VAL_FEATURES, val)
    sel, fin = ws.split_voices("selection"), ws.split_voices("final")
    # Every selection voice's kachow scores 0.8; every final voice's 0.3.
    meta, embs = [], []
    for v in sel + fin:
        meta.append({"kind": "positive", "voice": v, "speaker": "", "group": "g", "indian": False,
                     "variant": "k", "condition": "clean"})
        embs.append(clip(0.8 if v in sel else 0.3))
        meta.append({"kind": "near_miss", "voice": v, "speaker": "", "group": "g", "indian": False,
                     "variant": "chow", "condition": "clean"})
        embs.append(clip(0.0))
    return {"meta": meta, "clips_emb": embs}, max_head(CACHE / "max.onnx")


def test_the_split_is_six_selection_voices_and_five_final_covering_every_test_voice():
    sel, fin = ws.split_voices("selection"), ws.split_voices("final")
    assert len(sel) == 6 and len(fin) == 5
    assert set(sel).isdisjoint(fin)
    assert set(sel) | set(fin) == set(ws.VOICES)
    assert ws.split_voices("all") == list(ws.VOICES)


def test_selection_counts_only_its_voices_and_the_first_half_of_the_audio(world):
    ts, head = world
    r = ws.score_model(head, ts, split="selection")
    assert r["split"] == "selection"
    assert r["counts"]["positive"] == 6
    assert r["validation_hours"] == pytest.approx(3.0, abs=0.01)
    # The first half never false-wakes, so the lowest threshold already holds.
    assert r["operating_threshold"] == pytest.approx(0.05)
    assert r["headline_recall"] == 1.0


def test_final_counts_only_its_voices_and_the_second_half_of_the_audio(world):
    ts, head = world
    r = ws.score_model(head, ts, split="final")
    assert r["counts"]["positive"] == 5
    assert r["validation_hours"] == pytest.approx(3.0, abs=0.01)
    # 60 hot frames an hour push the operating point above 0.95, where the
    # final voices' 0.3 kachows never fire.
    assert r["operating_threshold"] > 0.95
    assert r["headline_recall"] == 0.0


def test_all_is_every_voice_and_every_hour(world):
    ts, head = world
    r = ws.score_model(head, ts)
    assert r["split"] == "all"
    assert r["counts"]["positive"] == 11
    assert r["validation_hours"] == pytest.approx(6.0, abs=0.01)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
