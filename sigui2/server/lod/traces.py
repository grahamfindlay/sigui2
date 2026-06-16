"""Trace level-of-detail: min/max decimation.

For a viewport ``W`` screen-pixels wide over a time window, we only need ~``2*W``
(min, max) pairs per channel to be visually lossless. This bounds the wire
payload to a few hundred KB regardless of zoom, vs. the current path that ships
the full-resolution chunk (and as JSON).

Phase 0 computes the decimation on the fly from ``Controller.get_traces``. A
precomputed multi-level pyramid (so extreme zoom-out never reads raw) is a
Phase 1+ optimization that slots in behind ``minmax_decimate`` unchanged.
"""

from __future__ import annotations

import numpy as np


def minmax_decimate(
    traces: np.ndarray, n_bins: int
) -> tuple[np.ndarray, np.ndarray]:
    """Reduce ``(n_samples, n_channels)`` traces to per-bin (min, max).

    Returns ``(ymin, ymax)``, each ``(n_bins_eff, n_channels)`` float32, where
    ``n_bins_eff = min(n_bins, n_samples)``. When the viewport has >= 1 sample per
    bin (high zoom), each bin holds exactly one sample so ``min == max`` and the
    caller draws the true sample polyline (no min/max sawtooth). When zoomed out,
    each bin spans many samples and the (min, max) envelope is visually lossless.
    """
    n_samples = traces.shape[0]
    if n_samples == 0:
        empty = np.zeros((0, traces.shape[1]), dtype="float32")
        return empty, empty

    n_bins_eff = min(int(n_bins), n_samples)
    if n_bins_eff < 1:
        t = traces.astype("float32", copy=False)
        return t, t

    # reduceat over uneven bin starts (strictly increasing because n_bins_eff
    # <= n_samples // 2 guarantees no repeated start indices).
    starts = np.linspace(0, n_samples, n_bins_eff + 1).astype(np.intp)[:-1]
    ymin = np.minimum.reduceat(traces, starts, axis=0).astype("float32", copy=False)
    ymax = np.maximum.reduceat(traces, starts, axis=0).astype("float32", copy=False)
    return ymin, ymax


def bin_centers_seconds(
    n_samples: int, n_bins_eff: int, sampling_frequency: float
) -> np.ndarray:
    """X coordinates (seconds, **relative to window start**) for each bin.

    View-relative to keep float32 precision over long (48 h @ 30 kHz) recordings
    where absolute sample indices exceed 2**31. The server holds absolute time as
    float64; only the relative offsets sent to the GPU are float32.
    """
    if n_bins_eff < 1:
        return np.zeros(0, dtype="float32")
    bin_width = n_samples / n_bins_eff
    centers = (np.arange(n_bins_eff) + 0.5) * bin_width
    return (centers / sampling_frequency).astype("float32")


# min/max binning only looks clean (and is phase-stable) when each bin holds
# MANY samples. Below this many samples per pixel, even at 1 bin/pixel the bins
# hold too few samples, so the envelope beats against the pixel grid and the
# trace looks "stepped"/blocky in a way that flips with a sub-pixel pan. Below
# the cutoff we send the raw samples (drawn as a true polyline, GPU-antialiased)
# instead of an envelope — cheap at that zoom, and beat-free.
_RAW_BELOW_SAMPLES_PER_PIXEL = 16


def decimate_window(
    traces: np.ndarray, viewport_px: int, sampling_frequency: float
) -> dict:
    """Reduce one viewport. Returns either a raw-samples payload or a min/max
    envelope, chosen by samples-per-pixel:

    * ``{"raw": True,  "x", "y"}``          when < 16 samples/pixel (high+mid zoom)
    * ``{"raw": False, "x", "ymin","ymax"}`` when >= 16 samples/pixel (wide zoom)

    ``x`` is seconds relative to the window start (float32). ``y``/``ymin``/``ymax``
    are ``(n_samples_or_bins, n_channels)`` float32.
    """
    n_samples = traces.shape[0]
    px = max(1, int(viewport_px))
    if n_samples < _RAW_BELOW_SAMPLES_PER_PIXEL * px:
        x = (np.arange(n_samples, dtype="float64") / sampling_frequency).astype("float32")
        return {"raw": True, "x": x, "y": traces.astype("float32", copy=False)}
    ymin, ymax = minmax_decimate(traces, px)
    x = bin_centers_seconds(n_samples, ymin.shape[0], sampling_frequency)
    return {"raw": False, "x": x, "ymin": ymin, "ymax": ymax}
