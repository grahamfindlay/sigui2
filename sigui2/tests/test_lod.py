"""LOD aggregation tests (no analyzer needed)."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sigui2.server.lod import traces as lod_traces  # noqa: E402


def _signal(n):
    rng = np.random.default_rng(0)
    return (rng.standard_normal((n, 4)) * 10).astype("float32")


def test_high_and_mid_zoom_send_raw_polyline():
    # < 16 samples/pixel (high AND intermediate zoom) -> raw samples, no envelope
    # (avoids the min/max-vs-pixel aliasing beat).
    px = 1000
    for spp in (2, 8, 15):  # samples per pixel, all below the cutoff
        traces = _signal(spp * px)
        dec = lod_traces.decimate_window(traces, px, 30_000.0)
        assert dec["raw"] is True
        assert "ymax" not in dec
        assert dec["y"].shape[0] == traces.shape[0]  # all samples kept


def test_wide_zoom_bins_to_viewport():
    # >= 16 samples/pixel -> bin to ~viewport width, envelope has min < max.
    px = 1000
    traces = _signal(100 * px)
    dec = lod_traces.decimate_window(traces, px, 30_000.0)
    assert dec["raw"] is False
    assert dec["ymin"].shape[0] == px
    assert np.any(dec["ymin"] < dec["ymax"])  # real envelope
    assert np.all(dec["ymin"] <= dec["ymax"])


def test_x_is_monotonic_and_window_relative():
    dec = lod_traces.decimate_window(_signal(50_000), 800, 30_000.0)
    x = dec["x"]
    assert x[0] >= 0
    assert np.all(np.diff(x) > 0)
