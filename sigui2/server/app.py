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
    Hello,
    HeatmapRequest,
    IsiRequest,
    ScatterRequest,
    SelectSpikes,
    SetVisibleUnits,
    TraceViewport,
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
