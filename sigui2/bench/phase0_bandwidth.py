"""Phase 0 de-risk: headless Controller + wire-bandwidth baseline vs. sigui2 LOD.

Runs entirely on a synthetic analyzer (no NFS). It answers the two questions the
Phase 0 gate cares about that don't require a browser yet:

1. Does ``Controller`` run headless (``backend="web"``, no Qt/Panel loop)?
2. How many bytes/refresh does the current full-resolution + JSON path move, vs.
   sigui2's min/max-decimated + binary path? (Exit target: >= 10x reduction.)

The browser-side 60fps validation is the next slice (needs the frontend).

Run:
    uv run --project gfys_workspace python sigui2/bench/phase0_bandwidth.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

# Make the sigui2 package importable without installing it yet.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sigui2.server.lod import scatter as lod_scatter  # noqa: E402
from sigui2.server.lod import traces as lod_traces  # noqa: E402
from sigui2.server.session import Session  # noqa: E402


def _fmt_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:,.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def json_size(obj) -> int:
    """Bytes of the JSON encoding (proxy for the Bokeh list/hex-string path)."""
    return len(json.dumps(obj).encode("utf-8"))


def bench_traces(session: Session, window_s: float, viewport_px: int) -> None:
    ctrl = session.controller
    fs = session.sampling_frequency
    seg = 0
    n_samples_total = ctrl.get_num_samples(seg)
    start = 0
    end = min(int(window_s * fs), n_samples_total)

    traces = ctrl.get_traces(segment_index=seg, start_frame=start, end_frame=end)
    n_samp, n_chan = traces.shape

    # Baseline A: current path ships the full-resolution chunk.
    raw_bytes = traces.astype("float32").nbytes
    # ...and the trace view duplicates the x array per channel ([times]*n).
    x_full = np.arange(n_samp) / fs
    raw_plus_x_bytes = raw_bytes + x_full.astype("float32").nbytes * n_chan
    # Baseline B: as the current code actually does it -> Python lists -> JSON.
    # (Estimate from a representative single channel to avoid a giant dumps.)
    one_ch_json = json_size(traces[:, 0].astype(float).tolist())
    one_x_json = json_size(x_full.tolist())
    json_bytes = (one_ch_json + one_x_json) * n_chan

    # sigui2: min/max decimate to the viewport, send binary float32.
    t0 = time.perf_counter()
    dec = lod_traces.decimate_window(traces, viewport_px, fs)
    dt = time.perf_counter() - t0
    new_bytes = dec["x"].nbytes + dec["ymin"].nbytes + dec["ymax"].nbytes
    n_bins = dec["ymin"].shape[0]

    print(f"\n=== TRACE VIEW  ({window_s:g}s window, {n_chan} ch, {n_samp:,} samples) ===")
    print(f"  current (full float32 chunk, x duplicated): {_fmt_bytes(raw_plus_x_bytes)}")
    print(f"  current (Python lists -> JSON, est.):       {_fmt_bytes(json_bytes)}")
    print(f"  sigui2  (min/max -> {n_bins} bins, binary):  {_fmt_bytes(new_bytes)}"
          f"   [decimate {dt*1e3:.1f} ms]")
    print(f"  reduction vs float32 chunk: {raw_plus_x_bytes / new_bytes:,.0f}x")
    print(f"  reduction vs JSON path:     {json_bytes / new_bytes:,.0f}x")


def bench_scatter(session: Session, n_visible: int) -> None:
    ctrl = session.controller
    amps = session.spike_amplitudes()
    if amps is None:
        print("\n=== SCATTER VIEW: no spike_amplitudes extension; skipping ===")
        return
    x_all = session.spike_times_seconds()

    unit_ids = list(ctrl.unit_ids)[:n_visible]
    ctrl.set_visible_unit_ids(unit_ids)
    idx_by_unit = {u: ctrl.get_spike_indices(u) for u in unit_ids}
    n_total_visible = sum(idx_by_unit[u].size for u in unit_ids)

    t0 = time.perf_counter()
    ws = lod_scatter.build_working_set(
        idx_by_unit, x_all, amps, unit_ids, max_per_unit=100_000
    )
    dt = time.perf_counter() - t0
    n_pts = ws["x"].size

    # sigui2 binary: x(f32) + y(f32) + rgba(u8) — sent ONCE, resident on GPU.
    new_bytes = ws["x"].nbytes + ws["y"].nbytes + n_pts * 4
    # current path: Python float lists for x,y + a hex color string per point,
    # re-sent on every refresh.
    sample = slice(0, min(n_pts, 5000))
    x_json = json_size(ws["x"][sample].astype(float).tolist())
    y_json = json_size(ws["y"][sample].astype(float).tolist())
    color_json = json_size(["#1f77b4"] * (sample.stop - sample.start))
    per_pt_json = (x_json + y_json + color_json) / max(1, sample.stop - sample.start)
    json_bytes = per_pt_json * n_pts

    print(f"\n=== SCATTER VIEW  ({n_visible} visible units, "
          f"{n_total_visible:,} spikes -> {n_pts:,} drawn) ===")
    print(f"  current (lists + hex color -> JSON, per refresh): {_fmt_bytes(json_bytes)}")
    print(f"  sigui2  (binary xy+rgba, resident, sent once):    {_fmt_bytes(new_bytes)}"
          f"   [build {dt*1e3:.1f} ms]")
    print(f"  reduction: {json_bytes / new_bytes:,.0f}x  (plus: re-sent every refresh vs once)")

    # Analytic extrapolation to a Neuropixels-scale working set.
    for target in (1_000_000, 2_000_000):
        b = target * (4 + 4 + 4)
        print(f"  @ {target:,} resident points: {_fmt_bytes(b)} binary (one upload)")


def main() -> None:
    print("Building synthetic analyzer (no NFS)...")
    from sigui2.testing import make_synthetic_analyzer

    t0 = time.perf_counter()
    analyzer = make_synthetic_analyzer(
        num_units=20, num_channels=64, duration_s=120.0, firing_rate=12.0
    )
    print(f"  built in {time.perf_counter()-t0:.1f}s")

    print("\nConstructing HEADLESS Controller (backend='web')...")
    t0 = time.perf_counter()
    session = Session(analyzer, with_traces=True, verbose=False)
    ctrl = session.controller
    print(f"  OK in {time.perf_counter()-t0:.1f}s  "
          f"[no Qt/Panel; signal_handler={type(ctrl.signal_handler).__name__}]")
    print(f"  units={ctrl.unit_ids.size}  channels={ctrl.num_channels}  "
          f"spikes={ctrl.spikes.size:,}  fs={session.sampling_frequency:g}Hz")

    bench_traces(session, window_s=1.0, viewport_px=1500)
    bench_scatter(session, n_visible=10)

    print("\nPhase 0 headless-Controller gate: PASS")


if __name__ == "__main__":
    main()
