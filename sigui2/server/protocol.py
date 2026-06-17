"""View payload builders + control-message handling.

The server is the source of truth. Control messages arrive as JSON text; data
replies go out as binary frames (see ``encode.py``), metadata/acks as JSON text.

Phase 0 implements the two de-risking views: trace (min/max LOD) and amplitude
scatter (resident pickable working set). Phase 2 generalizes these builders to
the full view set.
"""

from __future__ import annotations

import math

import numpy as np

from .encode import FrameBuilder
from .lod import scatter as lod_scatter
from .lod import traces as lod_traces
from .session import Session

try:  # the curated default column subset sigui shows; used only for ordering
    from spikeinterface.widgets.sorting_summary import (
        _default_displayed_unit_properties as _DEFAULT_DISPLAYED,
    )
except Exception:  # pragma: no cover - fallback if the private name moves
    _DEFAULT_DISPLAYED = ["firing_rate", "num_spikes", "x", "y", "snr"]


def _json_num(v):
    """Coerce a pandas/numpy scalar to a JSON-safe value (NaN/inf -> None)."""
    if v is None:
        return None
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, np.integer)):
        return int(v)
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return None if (math.isnan(f) or math.isinf(f)) else f


def _uid(u):
    """JSON-friendly unit id (numpy int -> int; numpy/py str stays str)."""
    return int(u) if isinstance(u, np.integer) else (str(u) if isinstance(u, np.str_) else u)


def build_curation_state(session: Session) -> dict:
    """The manual-curation overlay the client renders on the unit table.

    Curation never changes ``unit_ids`` (it is applied only at export), so this
    is a pure annotation layer: which units are merged/removed/split and their
    manual labels, plus the available label categories.
    """
    ctrl = session.controller
    cd = ctrl.curation_data or {}

    labels: dict = {}
    for entry in cd.get("manual_labels", []):
        per_cat = {}
        src = entry.get("labels", {k: v for k, v in entry.items() if k != "unit_id"})
        for cat, vals in src.items():
            if isinstance(vals, list) and vals:
                per_cat[cat] = vals[0]
        if per_cat:
            labels[_uid(entry["unit_id"])] = per_cat

    return {
        "type": "curation",
        "label_definitions": cd.get("label_definitions", {}),
        "merges": [[_uid(u) for u in m["unit_ids"]] for m in cd.get("merges", [])],
        "removed": [_uid(u) for u in cd.get("removed", [])],
        "splits": [_uid(s["unit_id"]) for s in cd.get("splits", [])],
        "labels": labels,
        "can_save": ctrl.analyzer.format != "memory",
        "saved": bool(getattr(ctrl, "current_curation_saved", True)),
    }


def build_units_table(session: Session) -> dict:
    """Per-unit table for the unit-list view: column order + per-unit values.

    Always includes ``num_spikes`` and ``firing_rate`` (derived from the
    Controller, so they exist even when no quality-metrics extension is present),
    then the analyzer's units_table columns ordered by sigui's default-displayed
    subset first. Values are JSON-safe (NaN -> None). Keyed by unit id like
    ``unit_colors`` so the client joins by id.
    """
    ctrl = session.controller
    df = ctrl.get_units_table()
    dur = ctrl.get_num_samples(0) / session.sampling_frequency

    base = ["num_spikes", "firing_rate"]
    df_cols = [c for c in df.columns if c not in base]
    preferred = [c for c in _DEFAULT_DISPLAYED if c in df_cols]
    columns = base + preferred + [c for c in df_cols if c not in preferred]

    rows: dict = {}
    for u in ctrl.unit_ids:
        ns = ctrl.num_spikes.get(u, ctrl.num_spikes.get(str(u), 0))
        row = {"num_spikes": int(ns), "firing_rate": (int(ns) / dur) if dur > 0 else 0.0}
        for c in df_cols:
            row[c] = _json_num(df.loc[u, c])
        key = int(u) if isinstance(u, np.integer) else u
        rows[key] = row
    return {"columns": columns, "rows": rows}


def build_metadata(session: Session) -> dict:
    """JSON metadata the client needs to lay out views."""
    ctrl = session.controller
    fs = session.sampling_frequency
    seg = 0
    n_samples = ctrl.get_num_samples(seg)
    unit_ids = [int(u) if isinstance(u, np.integer) else u for u in ctrl.unit_ids]

    colors = {}
    for u in ctrl.unit_ids:
        rgba = session.unit_color_rgba_u8(u)
        key = int(u) if isinstance(u, np.integer) else u
        colors[key] = [int(v) for v in rgba]

    units = build_units_table(session)

    loc = ctrl.get_contact_location()  # (n_channels, 2)
    wf_min, wf_max = ctrl.get_waveforms_range()

    return {
        "type": "metadata",
        "num_units": len(unit_ids),
        "num_channels": int(ctrl.num_channels),
        "sampling_frequency": float(fs),
        "duration_s": float(n_samples / fs),
        "num_samples": int(n_samples),
        "unit_ids": unit_ids,
        "unit_colors": colors,
        "default_visible_units": [unit_ids[0]] if unit_ids else [],
        "has_spike_amplitudes": session.spike_amplitudes() is not None,
        "metric_columns": units["columns"],
        "unit_metrics": units["rows"],
        "curation": build_curation_state(session),
        # Probe geometry + template shape for the waveform view.
        "channel_locations": [[float(x), float(y)] for x, y in loc],
        "nbefore": int(ctrl.nbefore),
        "n_template_samples": int(ctrl.templates_average.shape[1]),
        "template_abs_max": float(max(abs(wf_min), abs(wf_max))),
    }


def build_trace_frame(
    session: Session,
    t0: float,
    t1: float,
    width_px: int,
    seg: int = 0,
    channel_inds: list[int] | None = None,
) -> bytes:
    """Min/max-decimated trace frame for the viewport [t0, t1] seconds."""
    ctrl = session.controller
    fs = session.sampling_frequency
    start = max(0, int(t0 * fs))
    end = min(ctrl.get_num_samples(seg), int(t1 * fs))
    if end <= start:
        end = min(ctrl.get_num_samples(seg), start + 2)

    traces = ctrl.get_traces(segment_index=seg, start_frame=start, end_frame=end)
    if channel_inds is not None:
        traces = traces[:, channel_inds]
    else:
        channel_inds = list(range(traces.shape[1]))

    dec = lod_traces.decimate_window(traces, width_px, fs)
    # x is relative to window start; the window's absolute t0 (float64 on the
    # server) goes only as a scalar in the header to preserve client-side
    # precision. Raw mode sends one y per channel (client draws a polyline);
    # binned mode sends the (ymin, ymax) envelope. To keep the client one path,
    # raw's single y is sent under "ymin" and the client aliases ymax := ymin.
    header = {
        "type": "trace_frame",
        "seg": int(seg),
        "t0": float(start / fs),
        "t1": float(end / fs),
        "raw": bool(dec["raw"]),
        "channel_inds": [int(c) for c in channel_inds],
    }
    fb = FrameBuilder()
    fb.add("x", dec["x"])  # (n_points,) seconds from window start
    if dec["raw"]:
        header["n_points"] = int(dec["x"].size)
        fb.add("ymin", dec["y"].T.copy())  # (n_chan, n_points)
    else:
        header["n_points"] = int(dec["ymin"].shape[0])
        fb.add("ymin", dec["ymin"].T.copy())  # (n_chan, n_bins)
        fb.add("ymax", dec["ymax"].T.copy())
    return fb.build(header)


def build_scatter_frame(
    session: Session,
    view: str,
    unit_ids: list,
    max_per_unit: int = 100_000,
) -> bytes:
    """Resident, pickable scatter working set for the visible units.

    ``view='amplitude'`` -> y is spike amplitude; x is spike time (seconds).
    """
    ctrl = session.controller
    x_all = session.spike_times_seconds()
    if view == "amplitude":
        y_all = session.spike_amplitudes()
    else:
        raise ValueError(f"unknown scatter view {view!r}")
    if y_all is None:
        return FrameBuilder().build({"type": "scatter_frame", "view": view, "n": 0})

    idx_by_unit = {u: ctrl.get_spike_indices(u) for u in unit_ids}
    ws = lod_scatter.build_working_set(
        idx_by_unit, x_all, y_all, unit_ids, max_per_unit=max_per_unit
    )

    n = ws["x"].size
    rgba = np.zeros((n, 4), dtype="uint8")
    ranges_out = {}
    for u in unit_ids:
        lo, hi = ws["ranges"][u]
        rgba[lo:hi] = session.unit_color_rgba_u8(u)
        key = int(u) if isinstance(u, np.integer) else u
        ranges_out[key] = [int(lo), int(hi)]

    header = {"type": "scatter_frame", "view": view, "n": int(n), "ranges": ranges_out}
    fb = FrameBuilder()
    fb.add("position", np.column_stack([ws["x"], ws["y"]]).astype("float32"))
    fb.add("color", rgba)
    fb.add("spike_index", ws["spike_index"].astype("int32"))
    return fb.build(header)


def _unit_index_map(ctrl) -> dict[str, int]:
    return {str(u): i for i, u in enumerate(ctrl.unit_ids)}


def build_waveform_frame(session: Session, unit_ids: list) -> bytes:
    """Per-unit average templates on each unit's sparse channels.

    Per-unit and self-contained (delta-protocol cacheable like the scatter view):
    a unit's template bytes don't depend on which other units are requested. The
    flat ``values`` buffer holds each unit's (n_channels, n_samples) template
    row-major; the header carries each unit's channel indices + float offset, and
    the client positions every channel's waveform at its probe location.
    """
    ctrl = session.controller
    templates = ctrl.templates_average  # (n_units, n_samples, n_channels)
    mask = ctrl.get_sparsity_mask()
    idx_map = _unit_index_map(ctrl)
    n_samples = int(templates.shape[1])

    vals, units_hdr, offset = [], [], 0
    for u in unit_ids:
        ui = idx_map.get(str(u))
        if ui is None:
            continue
        chans = np.nonzero(mask[ui])[0]
        t = np.ascontiguousarray(templates[ui][:, chans].T, dtype="float32")  # (n_chan, n_samples)
        vals.append(t.ravel())
        units_hdr.append({
            "id": _uid(ctrl.unit_ids[ui]),
            "channels": [int(c) for c in chans],
            "n_channels": int(chans.size),
            "offset": int(offset),
        })
        offset += t.size

    values = np.concatenate(vals) if vals else np.zeros(0, dtype="float32")
    header = {"type": "waveform_frame", "n_samples": n_samples, "units": units_hdr}
    return FrameBuilder().add("values", values).build(header)


def build_heatmap_frame(session: Session, view: str = "similarity") -> bytes:
    """N x N matrix heatmap (template similarity). Client colormaps it."""
    ctrl = session.controller
    if view == "similarity":
        mat = ctrl.get_similarity()
    else:
        raise ValueError(f"unknown heatmap view {view!r}")
    if mat is None:
        return FrameBuilder().build({"type": "heatmap_frame", "view": view, "n": 0})
    mat = np.ascontiguousarray(mat, dtype="float32")
    n = int(mat.shape[0])
    header = {
        "type": "heatmap_frame", "view": view, "n": n,
        "vmin": float(np.nanmin(mat)), "vmax": float(np.nanmax(mat)),
        "unit_ids": [str(u) for u in ctrl.unit_ids],
    }
    return FrameBuilder().add("matrix", mat).build(header)


def _stacked_hist(matrix, bins, unit_ids, ctrl, frame_type: str) -> bytes:
    """Shared builder for per-visible-unit 1D histograms (ISI, ACG)."""
    if matrix is None:
        return FrameBuilder().build({"type": frame_type, "n_units": 0, "n_bins": 0})
    idx_map = _unit_index_map(ctrl)
    keep = [str(u) for u in unit_ids if str(u) in idx_map]
    inds = [idx_map[u] for u in keep]
    counts = (
        np.stack([matrix[i] for i in inds]).astype("float32")
        if inds else np.zeros((0, matrix.shape[-1]), dtype="float32")
    )
    header = {
        "type": frame_type, "n_units": len(inds),
        "n_bins": int(counts.shape[1]) if inds else 0, "unit_ids": keep,
    }
    fb = FrameBuilder()
    fb.add("bins", np.asarray(bins, dtype="float32"))  # bin edges
    fb.add("counts", counts)  # (n_units, n_bins)
    return fb.build(header)


def build_isi_frame(session: Session, unit_ids: list) -> bytes:
    ctrl = session.controller
    return _stacked_hist(ctrl.isi_histograms, ctrl.isi_bins, unit_ids, ctrl, "isi_frame")


def build_correlogram_frame(session: Session, unit_ids: list) -> bytes:
    """Auto-correlograms (diagonal of the CCG cube) for the visible units."""
    ctrl = session.controller
    ccg, bins = ctrl.correlograms, ctrl.correlograms_bins
    acg = None if ccg is None else np.stack([ccg[i, i] for i in range(ccg.shape[0])])
    return _stacked_hist(acg, bins, unit_ids, ctrl, "correlogram_frame")
