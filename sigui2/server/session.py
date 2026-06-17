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

        self.analyzer = analyzer
        self.controller = Controller(
            analyzer, backend="web", with_traces=with_traces, verbose=verbose,
            curation=True,  # enable the manual-curation data model (merges/labels/...)
        )
        # Attach our handler so any future view wiring / curation notify has a
        # target (Controller's "web" branch leaves signal_handler unset).
        self.controller.signal_handler = WebSignalHandler(self.controller)

    # --- convenience accessors used by the LOD layer / views -----------------

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
