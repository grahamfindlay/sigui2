"""A single-user session: a headless ``spikeinterface_gui`` Controller.

The Controller is the proven data + curation layer over a ``SortingAnalyzer``.
We run it with ``backend="web"``, which (by inspection of
``spikeinterface_gui/controller.py``) creates **no** Qt/Panel signal handler:
``signal_handler`` is referenced only in the ``"qt"``/``"panel"`` ``__init__``
branches and in ``connect_view`` (called only when a view is registered). Pure
data access therefore needs no event loop.

For Phase 1 (server pushes notifications to the browser), attach a
``WebSignalHandler`` whose ``on_*`` methods translate Controller notifications
into WebSocket patches. Phase 0 only exercises data access, so the handler is a
minimal stub.
"""

from __future__ import annotations

import numpy as np


class WebSignalHandler:
    """Minimal stand-in for the Qt/Panel signal handler.

    Phase 0: a no-op that satisfies ``connect_view`` if it is ever called.
    Phase 1 will grow ``on_*`` methods that emit WebSocket patches to the client.
    """

    def __init__(self, controller, parent=None):
        self.controller = controller

    def connect_view(self, view):  # noqa: D401 - matches sigui handler API
        pass

    def activate(self):
        pass

    def deactivate(self):
        pass


class Session:
    """Owns one analyzer + headless Controller and exposes data for the views."""

    def __init__(self, analyzer, with_traces: bool = True, verbose: bool = False):
        from spikeinterface_gui.controller import Controller

        from . import view_settings

        self.analyzer = analyzer
        self.controller = Controller(
            analyzer, backend="web", with_traces=with_traces, verbose=verbose,
            curation=True,  # enable the manual-curation data model (merges/labels/...)
        )

        # Per-view settings (F1): shared session state, mutated via SetViewSetting
        # and broadcast to every window. {view: {name: value}}, seeded from the
        # declarative catalog. The view builders read from here like they read
        # the shared visibility, so a setting change re-shapes the next frame.
        self.view_settings = view_settings.defaults()
        # Application-global settings (F2). The Controller already owns + enforces
        # these (e.g. it caps visibility by main_settings['max_visible_units']), so
        # we keep the VALUE in controller.main_settings (single source of truth) and
        # only push the descriptor defaults into it, leaving any Controller default
        # we don't manage untouched.
        for k, v in view_settings.main_defaults().items():
            self.controller.main_settings[k] = v
        # Attach our handler so any future view wiring / curation notify has a
        # target (Controller's "web" branch leaves signal_handler unset).
        self.controller.signal_handler = WebSignalHandler(self.controller)

        # Seed a deterministic initial visibility (first <=8 units). The shared
        # session reports this live set in build_metadata, so every window --
        # including ones opened later on a second monitor -- adopts the SAME set
        # instead of each clobbering it with its own default. Clamp to the visible
        # cap so it stays correct if max_visible_units is ever defaulted below 8
        # (no change today: 8 < 10).
        cap = self.controller.main_settings["max_visible_units"]
        ids = list(self.controller.unit_ids)
        self.controller.set_visible_unit_ids(ids[: min(8, cap, len(ids))])
        self.controller.update_visible_spikes()

        # Shared time window (F3): {seg, t0, t1} in seconds, mirrored to every
        # window like visibility/settings and mutated via SetTimeWindow. Seeded to
        # segment 0 start (matching the client's first ~2 s fetch); the first
        # window's deck-fit then writes the real window, which broadcasts to peers.
        dur0 = self.controller.get_num_samples(0) / self.sampling_frequency
        self.time_window = {"seg": 0, "t0": 0.0, "t1": float(min(2.0, dur0))}

    # --- convenience accessors used by the LOD layer / views -----------------

    def segment_duration(self, seg: int) -> float:
        """Duration (seconds) of segment ``seg``, sample-derived (not the F2c
        time API). Used to clamp the shared time window in the dispatch handler."""
        return self.controller.get_num_samples(seg) / self.sampling_frequency

    def main_settings_values(self) -> dict:
        """Current values of the F2-managed application-global settings.

        Read straight from ``controller.main_settings`` (the single source of
        truth + enforcer) so the client + a SetMainSetting echo never diverge
        from what the Controller actually applies.
        """
        from . import view_settings

        return {k: self.controller.main_settings[k] for k in view_settings.main_defaults()}

    @property
    def sampling_frequency(self) -> float:
        return self.controller.sampling_frequency

    def spike_times_seconds(self) -> np.ndarray:
        """Per-global-spike time in seconds (float64; view-relative at encode)."""
        return self.controller.spikes["sample_index"] / self.sampling_frequency

    def spike_amplitudes(self) -> np.ndarray | None:
        return self.controller.spike_amplitudes

    def unit_color_rgba_u8(self, unit_id) -> np.ndarray:
        c = np.asarray(self.controller.get_unit_color(unit_id), dtype="float64")
        return (c * 255).astype("uint8")

    def to_unit_ids(self, ids: list) -> list:
        """Map client-sent unit ids (JSON ints/strings) to the Controller's own
        unit-id objects (which may be numpy str/int), matched by ``str()``.

        Curation methods compare against ``curation_data`` lists built from the
        analyzer's unit ids, so identity/type must line up.
        """
        by_str = {str(u): u for u in self.controller.unit_ids}
        return [by_str[str(i)] for i in ids if str(i) in by_str]
