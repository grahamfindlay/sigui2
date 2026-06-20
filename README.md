# sigui2

> [!CAUTION]
> This is incomplete, experimental, and the TypeScript frontend in particular is heavily vibe-coded! 
> It is not suitable for real use yet, and there is no guarantee that it ever will be!

A performant, browser-first rewrite of the SpikeInterface GUI.

`sigui2` serves a browser app from a thin Python backend that reuses the 
data + curation layer of `spikeinterface-gui` (`spikeinterface_gui.controller.Controller`), 
running it headless (no Qt/Panel event loop) behind a FastAPI/WebSocket service.

The browser does GPU rendering (deck.gl / WebGL2) of server-aggregated, 
binary-encoded data, eliminating the two bottlenecks of the old Panel/Bokeh web mode: 
JSON serialization of full-resolution arrays, and the absence of a GPU rendering path
at Neuropixels scale.

See the design plan for the full architecture. For shipped work, what's next, and
ideas under consideration, see **[docs/ROADMAP.md](docs/ROADMAP.md)**. Developer
notes live in `docs/developer_notes/`.

## Architecture 

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
