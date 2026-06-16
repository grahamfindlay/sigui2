"""Scatter level-of-detail: per-unit decimation + density binning.

Two layers (see plan):

* **Interactive layer** — a stable, stratified per-unit sample (cap ~50k-200k per
  unit, global ceiling ~1-2M) that stays resident on the GPU and is fully
  pickable. Streamed once per unit; visibility toggles are a mask, not a re-send.
* **Overview layer** — a server-side 2D density image used when the user zooms
  out past the working-set budget. Pixels only, no picking.
"""

from __future__ import annotations

import numpy as np


def stratified_indices(indices: np.ndarray, max_count: int) -> np.ndarray:
    """Down-select ``indices`` to <= ``max_count`` points, stably and evenly.

    ``indices`` are assumed time-ordered (as ``Controller`` stores per-unit spike
    indices), so an even stride is a stratified-in-time sample. Deterministic:
    same input -> same output (no RNG), which keeps frames cacheable.
    """
    n = indices.size
    if n <= max_count or max_count <= 0:
        return indices
    pick = np.linspace(0, n - 1, max_count).astype(np.intp)
    return indices[pick]


def build_working_set(
    spike_indices_by_unit: dict,
    x_values: np.ndarray,
    y_values: np.ndarray,
    visible_unit_ids: list,
    max_per_unit: int = 100_000,
) -> dict:
    """Assemble the resident, pickable scatter working set for the given units.

    Returns per-unit slices into a single concatenated (x, y, spike_index) set so
    the client can keep one GPU buffer and toggle units via offsets.

    ``x_values``/``y_values`` are the full per-spike arrays (e.g. spike times and
    spike_amplitudes), indexed by global spike index.

    **Determinism (delta-protocol invariant).** Each unit's sample is a pure
    function of that unit's spike train and ``max_per_unit`` alone -- it does NOT
    depend on which *other* units are in the request. That is what lets the
    client cache a unit's scatter once and reuse it across visibility toggles:
    the bytes for unit ``u`` are identical whether ``u`` is fetched on its own or
    batched with others. (An earlier version apportioned ``max_per_unit`` down by
    the co-visible total to honour a global cap; that made a unit's sample depend
    on its batch, which is incompatible with per-unit caching, so it was removed.
    The global ceiling is now a soft per-unit budget; the zoomed-out "everything"
    case is the job of the 2D density overview layer, not this working set.)
    """
    xs, ys, idxs, ranges = [], [], [], {}
    offset = 0
    for unit_id in visible_unit_ids:
        sel = stratified_indices(spike_indices_by_unit[unit_id], max_per_unit)
        xs.append(x_values[sel].astype("float32", copy=False))
        ys.append(y_values[sel].astype("float32", copy=False))
        idxs.append(sel.astype("int32", copy=False))
        ranges[unit_id] = (offset, offset + sel.size)
        offset += sel.size

    if xs:
        x = np.concatenate(xs)
        y = np.concatenate(ys)
        spike_index = np.concatenate(idxs)
    else:
        x = np.zeros(0, dtype="float32")
        y = np.zeros(0, dtype="float32")
        spike_index = np.zeros(0, dtype="int32")

    return {"x": x, "y": y, "spike_index": spike_index, "ranges": ranges}


def density_image(
    x: np.ndarray,
    y: np.ndarray,
    x_range: tuple[float, float],
    y_range: tuple[float, float],
    width: int = 1024,
    height: int = 512,
) -> np.ndarray:
    """2D histogram (counts) for the zoomed-out overview layer.

    Returned as ``(height, width)`` so it maps directly to an image/texture.
    """
    counts, _, _ = np.histogram2d(
        x, y, bins=[width, height], range=[x_range, y_range]
    )
    return counts.T.astype("float32")
