---
title: sigui2 Phase 0 de-risking results
scope: sigui2
status: active
source: measurement
created: 2026-06-16
last_updated: 2026-06-16
confidence: high
confirmed_by_user: not_required
---

# Phase 0 de-risking — results

Phase 0 built a vertical slice (trace + amplitude scatter, end to end) to
validate the riskiest assumptions before building breadth. **All exit criteria
met.**

## 1. Headless `Controller` — PASS

`spikeinterface_gui.controller.Controller(analyzer, backend="web")` runs with no
Qt/Panel event loop. `signal_handler` is referenced only in the `"qt"`/`"panel"`
`__init__` branches and in `connect_view` (called only when a view is
registered), so pure data access never touches it. `server/session.py` attaches
its own `WebSignalHandler` after construction.

## 2. Wire bandwidth — PASS (20–90× reduction)

Measured on a synthetic analyzer (`bench/phase0_bandwidth.py`):

| view | current (Panel path) | sigui2 (binary LOD) | reduction |
| --- | --- | --- | --- |
| trace, 1 s × 64 ch | 14.6 MB float32 chunk / 66 MB JSON | 756 KB (1500 min/max bins) | 20–90× |
| amplitude scatter | JSON lists + hex colors, re-sent per refresh | binary xy+rgba, resident, sent once | structural |

## 3. Render fps on real GPU — PASS (5M points @ 60fps)

User-measured in a local browser (Apple GPU), via the `?stress=N` mode:

| points | anti-aliasing ON | anti-aliasing OFF |
| --- | --- | --- |
| 2,000,000 | 15 fps | **60 fps** |
| 5,000,000 | 6 fps | **60 fps** |

**Key finding: `ScatterplotLayer` anti-aliasing was the entire bottleneck.** With
`antialiasing: false` deck.gl hits 5M points at 60fps — 2.5× the ~1–2M target.
deck.gl is comfortably sufficient; a custom regl renderer is **not** needed.
Always disable AA for dense scatter (edge AA is invisible at ~1px radius anyway).

> Caveat that wasted a round-trip: if the browser renders via remote
> desktop/X-forwarding on a headless host, WebGL falls back to a **software**
> rasterizer (SwiftShader/llvmpipe) and fps is meaningless. The app surfaces the
> WebGL renderer string in the status bar; confirm it names a real GPU. Render on
> the **local** machine (port-tunnel the server), never on the compute host.

## 4. Per-spike picking — PASS

deck.gl built-in picking round-trips a clicked spike's global index to
`Controller.set_indices_spike_selected`. Needs `pickingRadius` on the `Deck`
(~8px), else ~1px points are essentially un-clickable.

## Rendering notes folded in

- **Trace LOD:** draw a *connected* min/max envelope (vertical bar per bin +
  connector to the next bin), not disjoint bars (picket fence). Allow up to one
  bin per sample (`n_bins_eff = min(n_bins, n_samples)`) so high zoom draws the
  true sample polyline instead of a 2-sample min/max sawtooth.

## How to run (Phase 0)

Launch with the **workspace venv python directly** — NOT `uv run --project
gfys_workspace`, which builds an ephemeral env that pulls spikeinterface-gui from
GitHub instead of the local editable clone (does not mutate the workspace venv,
but runs the wrong copy). sigui2 is not yet a workspace member (Phase 1 wires it
in).

```bash
# server (synthetic analyzer, no NFS; cached to ~/.cache/sigui2/synthetic.zarr)
PYTHONPATH=/path/to/sigui2 \
  /path/to/gfys_workspace/.venv/bin/python -m sigui2.cli --synthetic

# frontend build (served by the Python server's StaticFiles from frontend/dist)
cd frontend && npm install && npm run build

# tests (Python half, no NFS)
PYTHONPATH=/path/to/sigui2 /path/to/gfys_workspace/.venv/bin/python -m pytest sigui2/tests
```

Open `http://localhost:8000` (main) or `http://localhost:8000/?stress=2000000`
(GPU ceiling test).
