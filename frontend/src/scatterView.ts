// Amplitude scatter: resident, pickable working set rendered with deck.gl.
// Two interaction modes:
//   * pan/zoom (deck controller) + single-click pick (default), and
//   * lasso: drag a freehand polygon to region-select. The polygon is captured
//     in screen pixels, unprojected to world coords (x=time_s, y=amplitude),
//     and handed to `onLasso` so the caller can ask the server for the EXACT
//     spikes inside it (the rendered set is only a per-unit decimated sample, so
//     a local hit-test highlights immediately while the server stays the source
//     of truth for the selection that drives a split).
// Includes a `stress(n)` mode that renders n synthetic points and continuously
// repaints, to measure the raw GPU ceiling on the user's display machine.
import { Deck, OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer, PolygonLayer } from "@deck.gl/layers";

export interface ScatterCallbacks {
  onFps?: (n: number) => void;
  // A single-click pick: the spike's global index + its world (x, y) so the
  // caller can drive the shared pick-highlight (which is coordinate-based, not
  // working-set based, so it shows even for non-sampled spikes).
  onPick?: (globalSpikeIndex: number, point: [number, number]) => void;
  onLasso?: (worldPolygon: [number, number][]) => void; // -> exact server query
  onLassoLocal?: (sampledCount: number) => void; // immediate local highlight count
}

// Even-odd point-in-polygon (matches the server's test) over world coords.
function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export class ScatterView {
  private deck: Deck;
  private canvas: HTMLCanvasElement;
  private overlay: HTMLElement;
  private position: Float32Array = new Float32Array(0);
  private _color: Uint8Array = new Uint8Array(0);
  private spikeIndex: Int32Array = new Int32Array(0);
  private cb: ScatterCallbacks;
  private version = 0;
  private fitted = false;
  // lasso state
  private lassoMode = false;
  private drawing = false;
  private path: [number, number][] = [];
  private highlightPos: Float32Array | null = null; // lasso region (white)
  private pickHi: Float32Array | null = null; // explicitly picked spikes (yellow)
  private fpsTimer?: ReturnType<typeof setInterval>;
  private stressRAF = 0;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement, overlay: HTMLElement, cb: ScatterCallbacks = {},
  ) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.cb = cb;
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "ortho" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true, // full HiDPI (fit was the real bottleneck, not pixels)
      pickingRadius: 8, // small points need a pick tolerance, else clicks miss
      onClick: (info: any) => {
        if (this.lassoMode) return; // clicks belong to the lasso when it's active
        if (info && info.index >= 0 && this.spikeIndex.length) {
          const gi = this.spikeIndex[info.index];
          const x = this.position[info.index * 2], y = this.position[info.index * 2 + 1];
          // The caller (ScatterPane) sends select_spikes + sets the pick highlight.
          this.cb.onPick?.(gi, [x, y]);
        }
      },
    });
    // Lasso pointer events come from the overlay (see setLassoMode), not the
    // canvas, so they never reach deck's controller.
    overlay.addEventListener("pointerdown", this.onDown);
    this.fpsTimer = setInterval(() => this.reportFps(), 500);
  }

  // Release the GL context + every timer/listener this view owns, so a hidden
  // dockview tab (which React unmounts) doesn't leak a live WebGL context toward
  // the browser's ~16-context cap. Idempotent.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.fpsTimer);
    if (this.stressRAF) cancelAnimationFrame(this.stressRAF);
    this.overlay.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    this.deck.finalize();
  }

  private reportFps() {
    const fps = (this.deck as any).metrics?.fps;
    if (fps) this.cb.onFps?.(fps);
  }

  // --- lasso ---------------------------------------------------------------

  setLassoMode(on: boolean) {
    this.lassoMode = on;
    // The overlay swallows pointer events while lassoing, so deck's controller
    // never sees them (no pan/zoom) and the overlay's own crosshair cursor
    // shows. Toggling deck's `controller` prop alone is unreliable and wouldn't
    // change the cursor (deck manages the canvas cursor itself). pointer-events:
    // none when off lets pan/zoom + click-pick pass straight to the canvas.
    this.overlay.style.pointerEvents = on ? "auto" : "none";
    if (!on) this.drawing = false;
  }

  clearSelection() {
    this.highlightPos = null;
    this.pickHi = null;
    this.path = [];
    this.cb.onLassoLocal?.(0);
    this.paint();
  }

  // Highlight explicitly picked spikes at their world coords (from a single
  // click or the spikelist). Coordinate-based, so it shows even for spikes that
  // aren't in the decimated working set. Independent of the lasso highlight.
  highlightPoints(points: [number, number][]) {
    if (!points.length) { this.pickHi = null; this.paint(); return; }
    const hp = new Float32Array(points.length * 2);
    for (let k = 0; k < points.length; k++) { hp[k * 2] = points[k][0]; hp[k * 2 + 1] = points[k][1]; }
    this.pickHi = hp;
    this.paint();
  }

  // Render a completed lasso from a shared, world-space polygon: the outline +
  // white dots for the sampled points inside it. Used by the window that drew it
  // AND by other windows reproducing it from the broadcast. World coords, so it
  // covers the same points regardless of each window's zoom. null -> wipe it.
  showLasso(polygon: [number, number][] | null) {
    if (!polygon || polygon.length < 3) {
      this.highlightPos = null;
      this.path = [];
      this.paint();
      return;
    }
    this.path = polygon;
    this.highlightLocal(); // sets highlightPos + reports the local sampled count
    this.paint();
  }

  private toWorld(e: PointerEvent): [number, number] | null {
    const vp = (this.deck as any).getViewports?.()[0];
    if (!vp) return null;
    const r = this.canvas.getBoundingClientRect();
    const [x, y] = vp.unproject([e.clientX - r.left, e.clientY - r.top]);
    return [x, y];
  }

  private onDown = (e: PointerEvent) => {
    if (!this.lassoMode || e.button !== 0) return;
    e.preventDefault();
    const w = this.toWorld(e);
    if (!w) return;
    this.drawing = true;
    this.path = [w];
    this.highlightPos = null; // start fresh; previous highlight goes away
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp, { once: true });
    this.paint();
  };

  private onMove = (e: PointerEvent) => {
    if (!this.drawing) return;
    const w = this.toWorld(e);
    if (!w) return;
    // Append on meaningful movement to keep the path light (~screen-pixel res).
    const last = this.path[this.path.length - 1];
    if (!last || Math.hypot(w[0] - last[0], w[1] - last[1]) > 0) this.path.push(w);
    this.paint();
  };

  private onUp = () => {
    window.removeEventListener("pointermove", this.onMove);
    if (!this.drawing) return;
    this.drawing = false;
    if (this.path.length >= 3) {
      this.highlightLocal();
      this.cb.onLasso?.(this.path.slice());
    } else {
      this.path = [];
      this.cb.onLassoLocal?.(0);
    }
    this.paint();
  };

  // Highlight the rendered (sampled) points inside the lasso for instant
  // feedback. The authoritative selection (incl. non-sampled spikes) comes from
  // the server via onLasso.
  private highlightLocal() {
    const pos = this.position;
    const np = pos.length / 2;
    const keep: number[] = [];
    for (let i = 0; i < np; i++) {
      if (pointInPolygon(pos[i * 2], pos[i * 2 + 1], this.path)) keep.push(i);
    }
    const hp = new Float32Array(keep.length * 2);
    for (let k = 0; k < keep.length; k++) {
      hp[k * 2] = pos[keep[k] * 2];
      hp[k * 2 + 1] = pos[keep[k] * 2 + 1];
    }
    this.highlightPos = hp;
    this.cb.onLassoLocal?.(keep.length);
  }

  // --- rendering -----------------------------------------------------------

  private fit(position: Float32Array) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < position.length; i += 2) {
      const x = position[i], y = position[i + 1];
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    const w = this.canvas.clientWidth || 800, h = this.canvas.clientHeight || 300;
    const spanX = Math.max(1e-6, xmax - xmin), spanY = Math.max(1e-6, ymax - ymin);
    const zx = Math.log2((w * 0.9) / spanX), zy = Math.log2((h * 0.9) / spanY);
    return { target: [(xmin + xmax) / 2, (ymin + ymax) / 2, 0], zoom: [zx, zy] };
  }

  private composeLayers(): any[] {
    const layers: any[] = [];
    const n = this.spikeIndex.length;
    // New layer id per update so deck.gl fully recreates GPU buffers instead of
    // reusing them -- reusing leaves stale points/colors when the point count
    // shrinks (e.g. deselecting units).
    layers.push(new ScatterplotLayer({
      id: `spikes-${this.version}`,
      data: { length: n, attributes: {
        getPosition: { value: this.position, size: 2 },
        getFillColor: { value: this._color, size: 4 },
      } },
      radiusUnits: "pixels",
      getRadius: 1.2,
      radiusMinPixels: 1,
      stroked: false,
      filled: true,
      antialiasing: false, // halves fragment cost; edge AA is invisible at ~1px
      pickable: true,
    } as any));
    if (this.highlightPos && this.highlightPos.length) {
      layers.push(new ScatterplotLayer({
        id: `sel-${this.version}`,
        data: { length: this.highlightPos.length / 2, attributes: {
          getPosition: { value: this.highlightPos, size: 2 },
        } },
        radiusUnits: "pixels", getRadius: 2.4, radiusMinPixels: 2,
        stroked: false, filled: true, antialiasing: false,
        getFillColor: [255, 255, 255, 235], pickable: false,
      } as any));
    }
    if (this.pickHi && this.pickHi.length) {
      layers.push(new ScatterplotLayer({
        id: `pick-${this.version}`,
        data: { length: this.pickHi.length / 2, attributes: {
          getPosition: { value: this.pickHi, size: 2 },
        } },
        radiusUnits: "pixels", getRadius: 3.6, radiusMinPixels: 3,
        stroked: true, filled: true, antialiasing: true,
        getFillColor: [255, 225, 0, 255], getLineColor: [25, 25, 25, 255],
        lineWidthUnits: "pixels", getLineWidth: 1, pickable: false,
      } as any));
    }
    if (this.path.length >= 2) {
      layers.push(new PolygonLayer({
        id: `lasso-${this.version}`,
        data: [{ polygon: this.path }],
        getPolygon: (d: any) => d.polygon,
        stroked: true, filled: true,
        getFillColor: [255, 235, 80, 25],
        getLineColor: [255, 235, 80, 220],
        getLineWidth: 1.5, lineWidthUnits: "pixels", pickable: false,
      } as any));
    }
    return layers;
  }

  private paint() {
    this.deck.setProps({ layers: this.composeLayers() });
  }

  render(position: Float32Array, color: Uint8Array, spikeIndex: Int32Array) {
    this.version++;
    this.position = position;
    this._color = color;
    this.spikeIndex = spikeIndex;
    // The working set changed (units toggled / curation): any prior selection is
    // stale, so drop both highlights + the lasso outline.
    this.highlightPos = null;
    this.pickHi = null;
    this.path = [];
    this.cb.onLassoLocal?.(0);

    const n = spikeIndex.length;
    const props: any = { layers: this.composeLayers() };
    // Fit once so toggling units doesn't reset the user's pan/zoom.
    if (!this.fitted && n > 0) {
      props.initialViewState = this.fit(position);
      this.fitted = true;
    }
    this.deck.setProps(props);
  }

  // Stress test: n random points + continuous repaint to read steady-state fps.
  stress(n: number) {
    const position = new Float32Array(n * 2);
    const color = new Uint8Array(n * 4);
    const spikeIndex = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      position[i * 2] = Math.random() * 1000;
      position[i * 2 + 1] = Math.random() * 1000;
      color[i * 4] = 80 + ((i * 13) % 175);
      color[i * 4 + 1] = 120 + ((i * 7) % 135);
      color[i * 4 + 2] = 200;
      color[i * 4 + 3] = 255;
      spikeIndex[i] = i;
    }
    this.render(position, color, spikeIndex);
    // Nudge the view every frame so deck.gl repaints and metrics.fps reflects
    // real render cost rather than idle.
    let phase = 0;
    const base = this.fit(position);
    const loop = () => {
      if (this.disposed) return;
      phase += 0.02;
      this.deck.setProps({
        viewState: {
          target: [base.target[0] + Math.sin(phase) * 5, base.target[1], 0],
          zoom: base.zoom,
        },
      });
      this.stressRAF = requestAnimationFrame(loop);
    };
    this.stressRAF = requestAnimationFrame(loop);
  }
}
