# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest"]
# ///
"""The driver's kernel split and ranking.  uv run scripts/wake-sweep/test_wake_sweep.py"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

os.environ["BINGBONG_WAKE_SWEEP_CACHE"] = tempfile.mkdtemp(prefix="wake-sweep-test-")
_spec = importlib.util.spec_from_file_location("wake_sweep", Path(__file__).with_name("wake_sweep.py"))
sw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sw)


def cfg(name, steps=20000):
    return {"name": name, "overrides": {"steps": steps}}


def test_a_sweep_that_fits_in_nine_hours_is_one_kernel():
    assert [len(c) for c in sw.chunks([cfg(f"c{i}") for i in range(12)])] == [12]


def test_a_longer_sweep_splits_into_kernels_of_at_most_nine_hours_in_config_order():
    steps = int(100 / sw.MIN_PER_20K_STEPS * 20000)                 # 100 min each
    configs = [cfg(f"c{i}", steps=steps) for i in range(10)]
    parts = sw.chunks(configs)
    assert [c["name"] for p in parts for c in p] == [c["name"] for c in configs]
    for p in parts:
        assert sw.SETUP_MIN + sum(sw.est_minutes(c) for c in p) <= 9 * 60
    assert len(parts) == 2


def result(name, headline, fp=0.4, data="run3"):
    op = {"fp_per_hour": fp, "recall_clean": 0.9, "recall_noisy": 0.5, "recall_echo": 0.4, "near_miss_fire": 0.1}
    return {"name": name, "data": data, "seed": 0, "overrides": {}, "minutes": 5,
            "score": {"split": "selection", "headline_recall": headline, "operating_threshold": 0.5,
                      "operating": op}}


def write(sweep, rows):
    for r in rows:
        d = sw.config_dir(sweep, r["data"], r["name"])
        d.mkdir(parents=True, exist_ok=True)
        (d / "score.json").write_text(json.dumps(r))


def test_ranking_is_by_headline_then_fewer_false_wakes_and_failures_go_last():
    write("rank", [result("control-s0", 0.40), result("a", 0.50, fp=0.45), result("b", 0.50, fp=0.2),
                   {"name": "broke", "data": "run3", "seed": 0, "overrides": {}, "error": "Traceback\nOOM"}])
    rows, _ = sw.ranked("rank")
    assert [r["name"] for r in rows] == ["b", "a", "control-s0", "broke"]


def test_a_knob_inside_the_control_seeds_spread_is_a_tie_and_above_it_is_not():
    write("band", [result("control-s0", 0.40), result("control-s1", 0.46), result("control-s2", 0.43),
                   result("inside", 0.45), result("above", 0.47), result("below", 0.39)])
    rows, bands = sw.ranked("band")
    v = {r["name"]: sw.verdict(r, bands) for r in rows}
    assert bands["run3"]["min"] == 0.40 and bands["run3"]["max"] == 0.46
    assert v["inside"] == "tie (in band)"
    assert v["above"] == "above band"
    assert v["below"] == "below band"
    assert v["control-s1"] == ""


def test_the_winner_is_the_best_config_above_the_band():
    write("win", [result("control-s0", 0.40), result("control-s1", 0.44),
                  result("lucky", 0.43), result("real", 0.46)])
    w, _ = sw.winner(*sw.ranked("win"))
    assert w["name"] == "real"


def test_with_every_knob_inside_the_band_the_control_stands():
    write("tie", [result("control-s0", 0.40), result("control-s1", 0.44), result("knob", 0.44, fp=0.1)])
    w, why = sw.winner(*sw.ranked("tie"))
    assert w["name"] == "control-s1"
    assert "control stands" in why


def test_a_failed_config_is_not_done_so_a_rerun_trains_it_again():
    write("redo", [{"name": "broke", "data": "run3", "seed": 0, "overrides": {}, "error": "OOM"},
                   result("fine", 0.4)])
    assert not sw.is_done("redo", "run3", "broke")
    assert sw.is_done("redo", "run3", "fine")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
