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

from . import protocol, view_settings
from .schema import (
    ClearSelection,
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
    SetMainSetting,
    SetViewSetting,
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


class ClientHub:
    """Tracks every connected window so shared-session state can be fanned out.

    sigui2 runs one ``Session`` (one Controller) per process, so all browser
    windows are views onto the *same* visibility / curation / selection. When one
    window mutates that shared state we broadcast the new state to the others so
    every monitor stays in sync. Single uvicorn worker -> one process -> this
    in-process set sees all clients.
    """

    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()

    def add(self, ws: WebSocket) -> None:
        self._clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, payload: dict, exclude: WebSocket | None = None) -> None:
        """Send ``payload`` (JSON) to every client except ``exclude``; drop any
        socket that fails (already-closed windows)."""
        dead = []
        for ws in list(self._clients):
            if ws is exclude:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


async def _dispatch(ws: WebSocket, session: Session, hub: ClientHub, msg) -> None:
    ctrl = session.controller

    if isinstance(msg, Hello):
        await ws.send_json(protocol.build_metadata(session))

    elif isinstance(msg, SetVisibleUnits):
        ctrl.set_visible_unit_ids(msg.unit_ids)
        ctrl.update_visible_spikes()
        vis = [protocol._uid(u) for u in ctrl.get_visible_unit_ids()]
        # Broadcast the AUTHORITATIVE visibility to EVERY window (incl. the
        # sender). The Controller may adjust the requested set -- e.g. it caps the
        # number of simultaneously visible units -- so the sender must reconcile
        # its optimistic state too, or windows would disagree. The client
        # echo-guard keeps this single round-trip from looping.
        await hub.broadcast({"type": "visible_units", "unit_ids": vis})

    elif isinstance(msg, TraceViewport):
        frame = await anyio.to_thread.run_sync(
            protocol.build_trace_frame, session,
            msg.t0, msg.t1, msg.width_px, msg.seg, msg.channel_inds,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, ScatterRequest):
        unit_ids = msg.unit_ids or list(ctrl.get_visible_unit_ids())
        # Read the decimation cap from shared session settings (F1), so a
        # SetViewSetting change re-shapes the next fetch like a visibility change.
        max_per_unit = session.view_settings["scatter"]["max_spikes_per_unit"]
        frame = await anyio.to_thread.run_sync(
            protocol.build_scatter_frame, session, msg.view, unit_ids, max_per_unit,
        )
        await ws.send_bytes(frame)

    elif isinstance(msg, SelectSpikes):
        ctrl.set_indices_spike_selected(msg.indices)
        # Shared session: broadcast the pick so every window draws the same
        # highlight at the spikes' world coords (the client sends the points).
        state = protocol.build_selection_state(session)
        state["kind"] = "spikes"
        state["points"] = msg.points
        state["indices"] = msg.indices  # so every window's readout shows the spike #
        await hub.broadcast(state)

    elif isinstance(msg, SelectRegion):
        state = await anyio.to_thread.run_sync(
            protocol.select_region, session, msg.view, msg.polygon, msg.unit_ids,
        )
        # Shared session: include the world-space polygon so every window can
        # reproduce the exact same highlight + outline (zoom-independent).
        state["kind"] = "region"
        state["polygon"] = msg.polygon
        await hub.broadcast(state)

    elif isinstance(msg, ClearSelection):
        ctrl.set_indices_spike_selected([])
        # Clear is shared too: wipe the one Controller selection (so a later
        # split can't act on stale spikes) and tell every window to drop its
        # highlight.
        state = protocol.build_selection_state(session)  # n == 0
        state["kind"] = "clear"
        await hub.broadcast(state)

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

    elif isinstance(msg, SetViewSetting):
        # Shared session state: validate (clamp/coerce) the value, store it, and
        # broadcast the whole per-view dict to EVERY window so all mirror it. The
        # client decides how to react (scope="client" re-draws; scope="server"
        # re-fetches). The client echo-guard keeps this round-trip from looping.
        try:
            value = view_settings.validate(msg.view, msg.name, msg.value)
        except (KeyError, ValueError) as e:
            await ws.send_json({"type": "error", "msg": str(e)})
            return
        session.view_settings[msg.view][msg.name] = value
        await hub.broadcast({
            "type": "view_settings",
            "view": msg.view,
            "settings": session.view_settings[msg.view],
        })

    elif isinstance(msg, SetMainSetting):
        # Application-global setting (F2): validate, write it straight into the
        # Controller (the value owner + enforcer), trigger the Controller's own
        # reaction, and broadcast both the affected derived state and the new
        # main_settings to every window.
        try:
            value = view_settings.main_validate(msg.name, msg.value)
        except (KeyError, ValueError) as e:
            await ws.send_json({"type": "error", "msg": str(e)})
            return
        ctrl.main_settings[msg.name] = value
        if msg.name == "max_visible_units":
            # Re-apply the current visibility so the Controller's cap trims it to
            # the new limit (set_visible_unit_ids truncates from the end, matching
            # upstream mainsettingsview). Raising the cap is a no-op here -- it just
            # lifts the ceiling for future toggles. Reuse the existing visible_units
            # message so every window's existing listener adopts the trimmed set.
            ctrl.set_visible_unit_ids(list(ctrl.get_visible_unit_ids()))
            ctrl.update_visible_spikes()
            vis = [protocol._uid(u) for u in ctrl.get_visible_unit_ids()]
            await hub.broadcast({"type": "visible_units", "unit_ids": vis})
        await hub.broadcast({
            "type": "main_settings",
            "settings": session.main_settings_values(),
        })

    elif isinstance(msg, (MergeUnits, UnmergeUnits, DeleteUnits, RestoreUnits,
                          LabelUnits, SplitUnits, UnsplitUnits, SaveCuration)):
        _apply_curation(session, msg)
        # Mutations are cheap (list ops); broadcast the full curation state so
        # EVERY window re-syncs regardless of whether the action was a no-op.
        await hub.broadcast(protocol.build_curation_state(session))


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
    hub = ClientHub()

    @app.get("/api/meta")
    async def meta():
        return protocol.build_metadata(session)

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        hub.add(ws)
        try:
            while True:
                raw = await ws.receive_json()
                try:
                    msg = _control_adapter.validate_python(raw)
                except ValidationError as e:
                    await ws.send_json({"type": "error", "msg": str(e)})
                    continue
                await _dispatch(ws, session, hub, msg)
        except WebSocketDisconnect:
            pass
        finally:
            hub.remove(ws)

    # Mount static LAST so /api/* and /ws take precedence over the SPA catch-all.
    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="static")

    return app
