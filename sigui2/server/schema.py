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


class HeatmapRequest(BaseModel):
    type: Literal["heatmap_request"]
    view: str = "similarity"


class CorrelogramRequest(BaseModel):
    type: Literal["correlogram_request"]
    unit_ids: list[Any] | None = None


class IsiRequest(BaseModel):
    type: Literal["isi_request"]
    unit_ids: list[Any] | None = None


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


class SaveCuration(BaseModel):
    type: Literal["save_curation"]


ControlMessage = Annotated[
    Union[
        Hello, SetVisibleUnits, TraceViewport, ScatterRequest, SelectSpikes,
        HeatmapRequest, CorrelogramRequest, IsiRequest,
        MergeUnits, UnmergeUnits, DeleteUnits, RestoreUnits, LabelUnits, SaveCuration,
    ],
    Field(discriminator="type"),
]
