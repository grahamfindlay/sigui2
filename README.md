# sigui2

A performant, browser-first rewrite of the SpikeInterface GUI.

`sigui2` serves a browser app from a thin Python backend. The browser does GPU
rendering (deck.gl / WebGL2) of **server-aggregated, binary-encoded** data,
eliminating the two bottlenecks of the current Panel/Bokeh web mode: JSON
serialization of full-resolution arrays, and the absence of a GPU rendering path
at Neuropixels scale.

It **reuses** the proven data + curation layer of `spikeinterface-gui`
(`spikeinterface_gui.controller.Controller`) as a dependency, running it
*headless* (no Qt/Panel event loop) behind a FastAPI/WebSocket service.

See the design plan for the full architecture. Status: **Phase 0** (de-risking
vertical slice).

## Architecture (one line)

```
Browser (deck.gl + WebWorker)  <--binary frames / msgpack-->  FastAPI  -->  Controller (headless)  -->  SortingAnalyzer
```

## Layout

```
sigui2/
  server/        FastAPI app, session (headless Controller), protocol, encode
    lod/         server-side level-of-detail aggregation (traces, scatter, heatmap)
  frontend/      TypeScript app (deck.gl), built to static assets (Phase 0+)
  testing.py     synthetic SortingAnalyzer for offline/CI development
  bench/         benchmarks (Phase 0 bandwidth, etc.)
```
