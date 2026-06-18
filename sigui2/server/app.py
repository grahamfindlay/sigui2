"""FastAPI app: WebSocket data plane + (optional) static serving of the frontend.

Single-user: one ``Session`` (headless Controller) lives for the process. Control
messages arrive as JSON text and are validated by the pydantic schema; data
replies are binary frames. CPU-bound payload building is offloaded to a thread so
the event loop stays responsive.
"""

from __future__ import annotations

from pathlib import Path

import anyio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import TypeAdapter, ValidationError

from . import protocol
from .schema import (
    ControlMessage,
    CorrelogramRequest,
    DeleteUnits,
    DensityRequest,
    Hello,
    HeatmapRequest,
    IsiRequest,
    LabelUnits,
    MergeUnits,
    RestoreUnits,
    SaveCuration,
    ScatterRequest,
    SelectRegion,
    SelectSpikes,
    SetVisibleUnits,
    SpikelistRequest,
    SplitUnits,
    TracemapRequest,
    TraceViewport,
    UnmergeUnits,
    UnsplitUnits,
    WaveformRequest,
)
from .session import Session

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

_control_adapter: TypeAdapter = TypeAdapter(ControlMessage)


async def _dispatch(ws: WebSocket, session: Session, msg) -> None:
    ctrl = session.controller

    if isinstance(msg, Hello):
        await ws.send_json(protocol.build_metadata(session))

    elif isinstance(msg, SetVisibleUnits):
        ctrl.set_visible_unit_ids(msg.unit_ids)
        ctrl.update_visible_spikes()
        await ws.send_json({
            "type": "ack", "of": "set_visible_units",
            "visible": list(ctrl.get_visible_unit_ids()),
        })

    elif isinstance(msg, TraceViewport):
        frame = await anyio.to_thread.run_sync(
            protocol.build_trace_frame, session,
            msg.t0, msg.t1, msg.width_px, msg.seg, msg.channel_inds,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, ScatterRequest):
        unit_ids = msg.unit_ids or list(ctrl.get_visible_unit_ids())
        frame = await anyio.to_thread.run_sync(
            protocol.build_scatter_frame, session, msg.view, unit_ids,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, SelectSpikes):
        ctrl.set_indices_spike_selected(msg.indices)
        await ws.send_json({
            "type": "ack", "of": "select_spikes",
            "n": len(ctrl.get_indices_spike_selected()),
        })

    elif isinstance(msg, SelectRegion):
        state = await anyio.to_thread.run_sync(
            protocol.select_region, session, msg.view, msg.polygon, msg.unit_ids,
        )
        await ws.send_json(state)

    elif isinstance(msg, TracemapRequest):
        frame = await anyio.to_thread.run_sync(
            protocol.build_tracemap_frame, session, msg.t0, msg.t1, msg.width_px, msg.seg,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, SpikelistRequest):
        rows = await anyio.to_thread.run_sync(
            protocol.build_spikelist, session, msg.offset, msg.limit,
        )
        await ws.send_json(rows)

    elif isinstance(msg, DensityRequest):
        bounds = None
        if None not in (msg.x0, msg.x1, msg.y0, msg.y1):
            bounds = (msg.x0, msg.x1, msg.y0, msg.y1)
        frame = await anyio.to_thread.run_sync(
            protocol.build_density_frame, session, msg.view, bounds,
            msg.width_px, msg.height_px, msg.unit_ids,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, HeatmapRequest):
        frame = await anyio.to_thread.run_sync(
            protocol.build_heatmap_frame, session, msg.view,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, (CorrelogramRequest, IsiRequest)):
        unit_ids = msg.unit_ids or list(ctrl.get_visible_unit_ids())
        builder = (
            protocol.build_correlogram_frame
            if isinstance(msg, CorrelogramRequest)
            else protocol.build_isi_frame
        )
        frame = await anyio.to_thread.run_sync(builder, session, unit_ids)
        await ws.send_bytes(frame)

    elif isinstance(msg, WaveformRequest):
        unit_ids = msg.unit_ids or list(ctrl.get_visible_unit_ids())
        frame = await anyio.to_thread.run_sync(
            protocol.build_waveform_frame, session, unit_ids,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, (MergeUnits, UnmergeUnits, DeleteUnits, RestoreUnits,
                          LabelUnits, SplitUnits, UnsplitUnits, SaveCuration)):
        _apply_curation(session, msg)
        # Mutations are cheap (list ops); echo the full curation state so the
        # client re-syncs regardless of whether the action was a no-op.
        await ws.send_json(protocol.build_curation_state(session))


def _unmerge(ctrl, unit_ids: list) -> None:
    """Remove ``unit_ids`` from their merge group(s).

    The Controller's ``remove_units_from_merge_if_possible`` only acts when >=2
    units would remain (a merge needs >=2 members), so removing all-but-one (or
    all) of a group is otherwise a silent no-op. Here, if the removal would leave
    fewer than 2 members we **dissolve the whole group** (every member becomes
    un-merged), which is the intuitive result.
    """
    sel = {str(u) for u in unit_ids}
    merges = ctrl.curation_data["merges"]
    dissolve_idx = []
    for i, m in enumerate(merges):
        hit = [u for u in m["unit_ids"] if str(u) in sel]
        if not hit:
            continue
        if len(m["unit_ids"]) - len(hit) >= 2:
            ctrl.remove_units_from_merge_if_possible(hit)  # partial; group survives
        else:
            dissolve_idx.append(i)
    # Partial removals don't change list length, so these indices stay valid.
    if dissolve_idx:
        ctrl.make_manual_restore_merge(dissolve_idx)


def _split(ctrl, restrict_unit_ids: list | None = None) -> None:
    """Split each unit covered by the current spike selection.

    ``make_manual_split_if_possible(unit_id)`` reads the *global* selection and
    requires every selected spike to belong to ``unit_id``. A lasso can span
    several units, so we group the selection by unit and split each one with its
    own subset (selected-in-it vs the rest), restoring the full selection after.
    Units that are removed / in a merge / not visible are silently skipped by the
    Controller, which is the intended behavior.
    """
    import numpy as np

    sel = np.asarray(ctrl.get_indices_spike_selected())
    if sel.size == 0:
        return
    uidx = ctrl.spikes["unit_index"][sel]
    restrict = None if restrict_unit_ids is None else {str(u) for u in restrict_unit_ids}
    try:
        for ui in np.unique(uidx):
            unit_id = ctrl.unit_ids[int(ui)]
            if restrict is not None and str(unit_id) not in restrict:
                continue
            ctrl.set_indices_spike_selected(sel[uidx == ui])
            ctrl.make_manual_split_if_possible(unit_id)
    finally:
        ctrl.set_indices_spike_selected(sel)


def _unsplit(ctrl, unit_ids: list) -> None:
    """Remove any pending split(s) for ``unit_ids`` (mirror of unmerge/restore)."""
    sel = {str(u) for u in unit_ids}
    splits = ctrl.curation_data["splits"]
    idx = [i for i, s in enumerate(splits) if str(s["unit_id"]) in sel]
    if idx:
        ctrl.make_manual_restore_split(idx)


def _apply_curation(session: Session, msg) -> None:
    ctrl = session.controller
    if isinstance(msg, SaveCuration):
        if ctrl.analyzer.format != "memory":
            ctrl.save_curation_in_analyzer()
        return

    # Split uses the current selection; its unit_ids (if any) only *restrict* it
    # and may be None, so handle it before the mandatory id-mapping below.
    if isinstance(msg, SplitUnits):
        restrict = session.to_unit_ids(msg.unit_ids) if msg.unit_ids else None
        _split(ctrl, restrict)
        ctrl.current_curation_saved = False
        return

    unit_ids = session.to_unit_ids(msg.unit_ids)
    if isinstance(msg, MergeUnits):
        ctrl.make_manual_merge_if_possible(unit_ids)
    elif isinstance(msg, UnmergeUnits):
        _unmerge(ctrl, unit_ids)
    elif isinstance(msg, DeleteUnits):
        ctrl.make_manual_delete_if_possible(unit_ids)
    elif isinstance(msg, RestoreUnits):
        ctrl.make_manual_restore(unit_ids)
    elif isinstance(msg, UnsplitUnits):
        _unsplit(ctrl, unit_ids)
    elif isinstance(msg, LabelUnits):
        for u in unit_ids:
            ctrl.set_label_to_unit(u, msg.category, msg.label)
    # any mutation un-saves the curation
    ctrl.current_curation_saved = False


def create_app(session: Session) -> FastAPI:
    app = FastAPI(title="sigui2", version="0.0.1")

    @app.get("/api/meta")
    async def meta():
        return protocol.build_metadata(session)

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        try:
            while True:
                raw = await ws.receive_json()
                try:
                    msg = _control_adapter.validate_python(raw)
                except ValidationError as e:
                    await ws.send_json({"type": "error", "msg": str(e)})
                    continue
                await _dispatch(ws, session, msg)
        except WebSocketDisconnect:
            pass

    # Mount static LAST so /api/* and /ws take precedence over the SPA catch-all.
    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="static")

    return app
