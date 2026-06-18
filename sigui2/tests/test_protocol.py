"""End-to-end test of the Python half: protocol + binary frames over the WS.

Uses Starlette's TestClient (no real server / browser needed). Runs on the
synthetic analyzer, so it needs no NFS.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import msgpack
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sigui2.server.app import create_app  # noqa: E402
from sigui2.server.session import Session  # noqa: E402

_DTYPE = {"<f4": np.float32, "|u1": np.uint8, "<i4": np.int32, "<f8": np.float64}


def decode_frame(blob: bytes) -> tuple[dict, dict]:
    """Inverse of encode.FrameBuilder: -> (header, {name: ndarray})."""
    (hlen,) = struct.unpack("<I", blob[:4])
    header = msgpack.unpackb(blob[4 : 4 + hlen], raw=False)
    payload = blob[4 + hlen :]
    out = {}
    for buf in header["buffers"]:
        raw = payload[buf["offset"] : buf["offset"] + buf["nbytes"]]
        arr = np.frombuffer(raw, dtype=_DTYPE[buf["dtype"]])
        if len(buf["shape"]) > 1:
            arr = arr.reshape(buf["shape"])
        out[buf["name"]] = arr
    return header, out


@pytest.fixture(scope="module")
def client():
    from starlette.testclient import TestClient

    from sigui2.testing import make_synthetic_analyzer

    analyzer = make_synthetic_analyzer(
        num_units=8, num_channels=32, duration_s=20.0, firing_rate=15.0
    )
    session = Session(analyzer)
    return TestClient(create_app(session))


def test_metadata(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
    assert meta["type"] == "metadata"
    assert meta["num_units"] == 8
    assert meta["num_channels"] == 32
    assert meta["has_spike_amplitudes"] is True
    assert len(meta["unit_ids"]) == 8

    # Probe view + tracemap ordering.
    assert len(meta["unit_positions"]) == meta["num_units"]
    assert len(meta["channel_order"]) == meta["num_channels"]
    assert sorted(meta["channel_order"]) == list(range(meta["num_channels"]))
    assert isinstance(meta["probe_contours"], list)

    # Unit-list table: always carries num_spikes + firing_rate, one row per unit.
    assert meta["metric_columns"][:2] == ["num_spikes", "firing_rate"]
    assert set(str(k) for k in meta["unit_metrics"]) == set(str(u) for u in meta["unit_ids"])
    u0 = meta["unit_ids"][0]
    row = meta["unit_metrics"][str(u0)] if str(u0) in meta["unit_metrics"] else meta["unit_metrics"][u0]
    assert isinstance(row["num_spikes"], int) and row["num_spikes"] > 0
    assert isinstance(row["firing_rate"], (int, float)) and row["firing_rate"] > 0


def test_trace_frame_binned(client):
    # 1 s @ 30 kHz over 1000 px = 30 samples/pixel -> binned min/max envelope.
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "trace_viewport", "t0": 0.0, "t1": 1.0, "width_px": 1000})
        header, bufs = decode_frame(ws.receive_bytes())
    assert header["type"] == "trace_frame"
    assert header["raw"] is False
    n = header["n_points"]
    n_chan = len(header["channel_inds"])
    assert bufs["x"].shape == (n,)
    assert bufs["ymin"].shape == (n_chan, n)
    assert bufs["ymax"].shape == (n_chan, n)
    assert np.all(bufs["ymin"] <= bufs["ymax"] + 1e-3)


def test_trace_frame_raw_at_high_zoom(client):
    # 10 ms @ 30 kHz over 1000 px = 0.3 samples/pixel -> raw polyline, no ymax.
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "trace_viewport", "t0": 0.0, "t1": 0.01, "width_px": 1000})
        header, bufs = decode_frame(ws.receive_bytes())
    assert header["raw"] is True
    n = header["n_points"]
    n_chan = len(header["channel_inds"])
    assert bufs["x"].shape == (n,)
    assert bufs["ymin"].shape == (n_chan, n)
    assert "ymax" not in bufs


def test_scatter_frame_and_select(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
        units = meta["unit_ids"][:4]
        ws.send_json({"type": "set_visible_units", "unit_ids": units})
        ack = ws.receive_json()
        assert ack["type"] == "ack"

        ws.send_json({"type": "scatter_request", "view": "amplitude", "unit_ids": units})
        header, bufs = decode_frame(ws.receive_bytes())
        assert header["type"] == "scatter_frame"
        n = header["n"]
        assert bufs["position"].shape == (n, 2)
        assert bufs["color"].shape == (n, 4)
        assert bufs["spike_index"].shape == (n,)
        assert set(int(u) for u in units) <= set(int(k) for k in header["ranges"])

        # pick the first point -> its global spike index -> select round-trip
        picked = int(bufs["spike_index"][0])
        ws.send_json({"type": "select_spikes", "indices": [picked]})
        ack = ws.receive_json()
        assert ack["type"] == "ack" and ack["n"] == 1


def _range(ranges: dict, unit):
    """Look up a unit's [lo, hi) in a frame's ranges dict (keys may be int/str)."""
    if unit in ranges:
        return ranges[unit]
    return ranges[str(unit)]


def test_scatter_per_unit_determinism(client):
    """A unit's scatter payload must be byte-identical whether it is fetched on
    its own or batched with other units. This is the invariant the client-side
    per-unit cache (delta protocol) relies on: a cached unit stays valid no
    matter what else is visible. Guards against re-introducing co-visibility
    apportionment in build_working_set.
    """
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
        u0, u1 = meta["unit_ids"][0], meta["unit_ids"][1]

        def fetch(units):
            ws.send_json({"type": "scatter_request", "view": "amplitude", "unit_ids": units})
            return decode_frame(ws.receive_bytes())

        _, b0 = fetch([u0])
        _, b1 = fetch([u1])
        hboth, bboth = fetch([u0, u1])

    # Combined frame = u0's block immediately followed by u1's block, and each
    # block equals the corresponding standalone single-unit fetch exactly.
    lo0, hi0 = _range(hboth["ranges"], u0)
    lo1, hi1 = _range(hboth["ranges"], u1)
    assert lo0 == 0 and hi0 == b0["spike_index"].size  # u0 first, full size
    assert lo1 == hi0 and hi1 == hi0 + b1["spike_index"].size  # u1 contiguous after

    assert np.array_equal(bboth["spike_index"][lo0:hi0], b0["spike_index"])
    assert np.array_equal(bboth["spike_index"][lo1:hi1], b1["spike_index"])
    assert np.array_equal(bboth["position"][lo0:hi0], b0["position"])
    assert np.array_equal(bboth["position"][lo1:hi1], b1["position"])
    assert np.array_equal(bboth["color"][lo0:hi0], b0["color"])


def _rect(x0, x1, y0, y1):
    """Axis-aligned rectangle polygon (CCW) for a lasso region query."""
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def test_select_region_exact_and_split(client):
    """A lasso region selects the EXACT spikes inside it (full per-spike arrays,
    not the decimated render), and a split turns the selection into a pending
    per-unit split. Uses unit 3, which no other curation test touches (the merge
    test leaves 0/1 merged; the unmerge test uses 4-7)."""
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
        u3 = meta["unit_ids"][3]
        dur = meta["duration_s"]
        nspk = meta["unit_metrics"][str(u3)]["num_spikes"]

        ws.send_json({"type": "set_visible_units", "unit_ids": [u3]})
        assert ws.receive_json()["type"] == "ack"

        # A rectangle enclosing the whole plane selects EVERY spike of u3.
        big = _rect(-1.0, dur + 1.0, -1e9, 1e9)
        ws.send_json({"type": "select_region", "view": "amplitude",
                      "polygon": big, "unit_ids": [u3]})
        s = ws.receive_json()
        assert s["type"] == "selection"
        assert s["n"] == nspk                       # exact, > the working-set sample
        assert s["per_unit"][str(u3)] == nspk

        # A degenerate (<3-vertex) polygon clears the selection.
        ws.send_json({"type": "select_region", "polygon": [[0, 0], [1, 1]],
                      "unit_ids": [u3]})
        assert ws.receive_json()["n"] == 0

        # Re-select all, then split u3 into (selected, rest) -> a pending split.
        ws.send_json({"type": "select_region", "view": "amplitude",
                      "polygon": big, "unit_ids": [u3]})
        assert ws.receive_json()["n"] == nspk
        ws.send_json({"type": "split_units"})
        c = ws.receive_json()
        assert c["type"] == "curation"
        assert str(u3) in [str(x) for x in c["splits"]]
        assert c["saved"] is False

        # Unsplit removes it again.
        ws.send_json({"type": "unsplit_units", "unit_ids": [u3]})
        c = ws.receive_json()
        assert str(u3) not in [str(x) for x in c["splits"]]


def test_waveform_frame(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
        assert len(meta["channel_locations"]) == meta["num_channels"]
        assert meta["n_template_samples"] > 0 and meta["template_abs_max"] > 0
        units = meta["unit_ids"][:3]
        ws.send_json({"type": "waveform_request", "unit_ids": units})
        header, bufs = decode_frame(ws.receive_bytes())
    assert header["type"] == "waveform_frame"
    ns = header["n_samples"]
    assert len(header["units"]) == len(units)
    # flat values buffer = sum of each unit's (n_channels * n_samples)
    assert bufs["values"].size == sum(u["n_channels"] * ns for u in header["units"])
    u0 = header["units"][0]
    assert len(u0["channels"]) == u0["n_channels"]
    seg = bufs["values"][u0["offset"]: u0["offset"] + u0["n_channels"] * ns]
    assert seg.size == u0["n_channels"] * ns


def test_tracemap_frame(client):
    # 1 s @ 30 kHz binned to 200 columns -> a (n_chan, n_cols) image.
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "tracemap_request", "t0": 0.0, "t1": 1.0, "width_px": 200})
        header, bufs = decode_frame(ws.receive_bytes())
    assert header["type"] == "tracemap_frame"
    nch, ncol = header["n_chan"], header["n_cols"]
    assert nch == 32 and ncol <= 200
    assert bufs["image"].shape == (nch, ncol)  # row = depth-ordered channel, col = time
    assert header["color_limit"] > 0


def test_spikelist_window(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
        units = meta["unit_ids"][:3]
        ws.send_json({"type": "set_visible_units", "unit_ids": units})
        assert ws.receive_json()["type"] == "ack"

        ws.send_json({"type": "spikelist_request", "offset": 0, "limit": 50})
        r = ws.receive_json()
        assert r["type"] == "spikelist"
        assert r["total"] > 0 and r["offset"] == 0
        assert len(r["rows"]) == min(50, r["total"])
        row0 = r["rows"][0]
        assert {"i", "unit", "seg", "sample", "t", "amp", "selected"} <= set(row0)
        # Every listed spike belongs to a visible unit.
        vis = {str(u) for u in units}
        assert all(str(row["unit"]) in vis for row in r["rows"])

        # Selecting a spike marks exactly that row in the next window.
        ws.send_json({"type": "select_spikes", "indices": [row0["i"]]})
        assert ws.receive_json()["type"] == "ack"
        ws.send_json({"type": "spikelist_request", "offset": 0, "limit": 50})
        r2 = ws.receive_json()
        sel_rows = [row for row in r2["rows"] if row["selected"]]
        assert [row["i"] for row in sel_rows] == [row0["i"]]


def test_density_frame(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
        units = meta["unit_ids"][:4]
        ws.send_json({"type": "set_visible_units", "unit_ids": units})
        assert ws.receive_json()["type"] == "ack"

        # No bounds -> server bins the full data range and reports it back.
        ws.send_json({"type": "density_request", "view": "amplitude",
                      "unit_ids": units, "width_px": 128, "height_px": 64})
        header, bufs = decode_frame(ws.receive_bytes())
        assert header["type"] == "density_frame"
        W, H = header["width"], header["height"]
        assert W <= 128 and H <= 64
        assert bufs["counts"].shape == (H, W)
        assert header["x0"] < header["x1"] and header["y0"] < header["y1"]
        assert header["n_spikes"] > 0 and header["vmax"] > 0
        # Auto-range covers every spike, so the histogram total == n_spikes.
        assert int(round(float(bufs["counts"].sum()))) == header["n_spikes"]

        # Explicit viewport bounds are echoed back unchanged.
        ws.send_json({"type": "density_request", "unit_ids": units,
                      "x0": 0.0, "x1": 1.0, "y0": -200.0, "y1": 200.0,
                      "width_px": 50, "height_px": 40})
        h2, b2 = decode_frame(ws.receive_bytes())
        assert abs(h2["x0"]) < 1e-9 and abs(h2["x1"] - 1.0) < 1e-9
        assert b2["counts"].shape == (h2["height"], h2["width"])


def test_heatmap_frame(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "heatmap_request", "view": "similarity"})
        header, bufs = decode_frame(ws.receive_bytes())
    assert header["type"] == "heatmap_frame"
    n = header["n"]
    assert bufs["matrix"].shape == (n, n)
    assert header["vmin"] <= header["vmax"]


def test_curation_merge_label_delete_restore(client):
    """Curation mutations round-trip and the echoed state reflects them."""
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        meta = ws.receive_json()
        assert "quality" in meta["curation"]["label_definitions"]
        u0, u1, u2 = meta["unit_ids"][:3]

        def act(m):
            ws.send_json(m)
            c = ws.receive_json()
            assert c["type"] == "curation"
            return c

        c = act({"type": "merge_units", "unit_ids": [u0, u1]})
        assert any(set(map(str, g)) == {str(u0), str(u1)} for g in c["merges"])
        assert c["saved"] is False  # any mutation un-saves

        c = act({"type": "label_units", "unit_ids": [u2], "category": "quality", "label": "good"})
        assert c["labels"][str(u2)]["quality"] == "good"

        c = act({"type": "delete_units", "unit_ids": [u2]})
        assert str(u2) in [str(x) for x in c["removed"]]

        c = act({"type": "restore_units", "unit_ids": [u2]})
        assert str(u2) not in [str(x) for x in c["removed"]]

        # clearing a label drops the unit from the labels map
        c = act({"type": "label_units", "unit_ids": [u2], "category": "quality", "label": None})
        assert str(u2) not in c["labels"]


def test_curation_unmerge_partial_and_dissolve(client):
    """Unmerging a subset keeps the group (>=2 remain); unmerging down to <2
    dissolves the whole group. Uses units 4-7 to stay independent of the other
    curation test (shared module-scoped Session)."""
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        a, b, c_, d = ws.receive_json()["unit_ids"][4:8]

        def act(m):
            ws.send_json(m)
            r = ws.receive_json()
            assert r["type"] == "curation"
            return r

        act({"type": "merge_units", "unit_ids": [a, b, c_, d]})

        # remove 2 of 4 -> the other 2 stay merged
        r = act({"type": "unmerge_units", "unit_ids": [a, b]})
        grp = next((set(map(str, g)) for g in r["merges"]
                    if str(c_) in [str(x) for x in g]), None)
        assert grp == {str(c_), str(d)}

        # remove 1 more -> only 1 would remain -> dissolve the whole group
        r = act({"type": "unmerge_units", "unit_ids": [c_]})
        flat = {str(x) for g in r["merges"] for x in g}
        assert not ({str(a), str(b), str(c_), str(d)} & flat)


def test_isi_and_correlogram_frames(client):
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        units = ws.receive_json()["unit_ids"][:4]
        for req, reply in [("isi_request", "isi_frame"),
                           ("correlogram_request", "correlogram_frame")]:
            ws.send_json({"type": req, "unit_ids": units})
            header, bufs = decode_frame(ws.receive_bytes())
            assert header["type"] == reply
            n_units, n_bins = header["n_units"], header["n_bins"]
            assert n_units == len(units)
            assert bufs["counts"].shape == (n_units, n_bins)
            assert bufs["bins"].size >= n_bins  # edges (n_bins+1) or centers
