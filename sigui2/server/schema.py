"""Pydantic schema for the control plane (client -> server JSON messages).

A discriminated union on ``type`` validates and parses each incoming message, so
the websocket handler dispatches on real typed models instead of raw dicts. The
data plane (server -> client) stays binary frames (see ``encode.py``).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field


class Hello(BaseModel):
    type: Literal["hello"]


class SetVisibleUnits(BaseModel):
    type: Literal["set_visible_units"]
    unit_ids: list[Any]  # unit ids may be ints or strings (zarr stores strings)


class TraceViewport(BaseModel):
    type: Literal["trace_viewport"]
    t0: float
    t1: float
    width_px: int
    seg: int = 0
    channel_inds: list[int] | None = None


class ScatterRequest(BaseModel):
    type: Literal["scatter_request"]
    view: str = "amplitude"
    unit_ids: list[Any] | None = None


class SelectSpikes(BaseModel):
    type: Literal["select_spikes"]
    indices: list[int] = Field(default_factory=list)
    # World coords ([x=time_s, y=amplitude], ...) of the picked spikes, so the
    # selection broadcast can reproduce the highlight in every window.
    points: list[list[float]] = Field(default_factory=list)


class ClearSelection(BaseModel):
    type: Literal["clear_selection"]


class SelectRegion(BaseModel):
    type: Literal["select_region"]
    view: str = "amplitude"
    # Lasso vertices in scatter world coords ([x=time_s, y=amplitude], ...). The
    # server hit-tests the *full* per-spike arrays of ``unit_ids`` (exact, not the
    # decimated working set the client renders), so the selection is authoritative.
    polygon: list[list[float]] = Field(default_factory=list)
    unit_ids: list[Any] | None = None  # restrict to these units (visible by default)


class TracemapRequest(BaseModel):
    type: Literal["tracemap_request"]
    t0: float
    t1: float
    width_px: int
    seg: int = 0


class SpikelistRequest(BaseModel):
    type: Literal["spikelist_request"]
    offset: int = 0
    limit: int = 200


class DensityRequest(BaseModel):
    type: Literal["density_request"]
    view: str = "amplitude"
    # Viewport bounds in scatter world coords (x=time_s, y=amplitude). All four
    # None -> the server bins the full data range and returns the bounds it used.
    x0: float | None = None
    x1: float | None = None
    y0: float | None = None
    y1: float | None = None
    width_px: int = 1024
    height_px: int = 512
    unit_ids: list[Any] | None = None  # visible by default


class HeatmapRequest(BaseModel):
    type: Literal["heatmap_request"]
    view: str = "similarity"


class CorrelogramRequest(BaseModel):
    type: Literal["correlogram_request"]
    unit_ids: list[Any] | None = None


class IsiRequest(BaseModel):
    type: Literal["isi_request"]
    unit_ids: list[Any] | None = None


class WaveformRequest(BaseModel):
    type: Literal["waveform_request"]
    unit_ids: list[Any] | None = None


class SetViewSetting(BaseModel):
    type: Literal["set_view_setting"]
    # The view this setting belongs to (e.g. "scatter"), its descriptor name, and
    # the new value. The server validates against the view_settings catalog and
    # echoes the cleaned per-view dict to every window (shared session state).
    view: str
    name: str
    value: Any


# --- curation control plane (mutations -> server echoes a "curation" state) ---


class MergeUnits(BaseModel):
    type: Literal["merge_units"]
    unit_ids: list[Any]


class UnmergeUnits(BaseModel):
    type: Literal["unmerge_units"]
    unit_ids: list[Any]


class DeleteUnits(BaseModel):
    type: Literal["delete_units"]
    unit_ids: list[Any]


class RestoreUnits(BaseModel):
    type: Literal["restore_units"]
    unit_ids: list[Any]


class LabelUnits(BaseModel):
    type: Literal["label_units"]
    unit_ids: list[Any]
    category: str
    label: str | None = None  # None clears the category for those units


class SplitUnits(BaseModel):
    type: Literal["split_units"]
    # Split using the current server-side spike selection (from the last
    # select_region), grouped by unit so each affected unit is split into
    # (selected-in-it, rest). Optionally restrict to these unit ids.
    unit_ids: list[Any] | None = None


class UnsplitUnits(BaseModel):
    type: Literal["unsplit_units"]
    unit_ids: list[Any]


class SaveCuration(BaseModel):
    type: Literal["save_curation"]


ControlMessage = Annotated[
    Union[
        Hello, SetVisibleUnits, TraceViewport, ScatterRequest, SelectSpikes,
        SelectRegion, ClearSelection, TracemapRequest, SpikelistRequest, DensityRequest,
        HeatmapRequest, CorrelogramRequest, IsiRequest, WaveformRequest,
        SetViewSetting,
        MergeUnits, UnmergeUnits, DeleteUnits, RestoreUnits, LabelUnits,
        SplitUnits, UnsplitUnits, SaveCuration,
    ],
    Field(discriminator="type"),
]
