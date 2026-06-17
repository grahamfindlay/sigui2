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
