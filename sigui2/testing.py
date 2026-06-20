"""Synthetic SortingAnalyzer for offline / CI development.

Lets the server, protocol, and LOD code be developed and unit-tested without a
mounted production NFS (per the workspace TESTING convention: real-data tests are
marked ``@pytest.mark.requires_nfs``; everything else should run on a synthetic
analyzer).
"""

from __future__ import annotations


# Extensions the sigui2 views consume. Kept in dependency order so a single
# ``analyzer.compute(...)`` call resolves cleanly.
DEFAULT_EXTENSIONS = [
    "random_spikes",
    "waveforms",
    "templates",
    "noise_levels",
    "unit_locations",
    "spike_amplitudes",
    "spike_locations",
    "correlograms",
    "isi_histograms",
    "template_similarity",
]


def make_synthetic_analyzer(
    num_units: int = 20,
    num_channels: int = 64,
    duration_s: float = 60.0,
    sampling_frequency: float = 30_000.0,
    firing_rate: float = 8.0,
    seed: int = 42,
    extensions: list[str] | None = None,
    durations: list[float] | None = None,
):
    """Build an in-memory ``SortingAnalyzer`` with the extensions sigui2 needs.

    Parameters mirror the knobs that matter for bandwidth/perf work: more units,
    channels, and duration push the scatter/trace data sizes up. Pass ``durations``
    (a list of per-segment lengths in seconds) for a MULTI-segment recording --
    used to exercise F3 segment navigation; defaults to a single ``duration_s``
    segment.
    """
    from spikeinterface.core import (
        create_sorting_analyzer,
        generate_ground_truth_recording,
    )

    recording, sorting = generate_ground_truth_recording(
        durations=durations if durations is not None else [duration_s],
        sampling_frequency=sampling_frequency,
        num_channels=num_channels,
        num_units=num_units,
        generate_sorting_kwargs=dict(firing_rates=firing_rate, refractory_period_ms=4.0),
        seed=seed,
    )

    analyzer = create_sorting_analyzer(
        sorting, recording, format="memory", sparse=True
    )
    analyzer.compute(extensions if extensions is not None else DEFAULT_EXTENSIONS)
    return analyzer


def cached_synthetic_analyzer(cache_dir=None, rebuild: bool = False, **kwargs):
    """Build the synthetic analyzer once and reuse it across dev restarts.

    The in-memory build costs ~40s; persisting it to zarr makes subsequent
    launches near-instant. ``kwargs`` are forwarded to ``make_synthetic_analyzer``
    on first build.
    """
    import shutil
    from pathlib import Path

    from spikeinterface import load_sorting_analyzer

    cache_dir = Path(cache_dir) if cache_dir else (Path.home() / ".cache" / "sigui2")
    # Key the cache by segment layout so single- and multi-segment builds (F3
    # segment-nav testing) don't collide on disk.
    nseg = len(kwargs["durations"]) if kwargs.get("durations") else 1
    folder = cache_dir / (f"synthetic_{nseg}seg.zarr" if nseg > 1 else "synthetic.zarr")
    if folder.exists() and not rebuild:
        return load_sorting_analyzer(folder)
    if folder.exists():
        shutil.rmtree(folder)

    analyzer = make_synthetic_analyzer(**kwargs)
    cache_dir.mkdir(parents=True, exist_ok=True)
    return analyzer.save_as(format="zarr", folder=folder)


if __name__ == "__main__":
    a = make_synthetic_analyzer()
    print(a)
    print("spikes:", a.sorting.to_spike_vector().size)
