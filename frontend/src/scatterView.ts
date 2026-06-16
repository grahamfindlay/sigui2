// Amplitude scatter: resident, pickable working set rendered with deck.gl.
// Includes a `stress(n)` mode that renders n synthetic points and continuously
// repaints, to measure the raw GPU ceiling on the user's display machine.
import { Deck, OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer } from "@deck.gl/layers";
import { Sock } from "./socket";

export interface ScatterCallbacks {
  onFps?: (n: number) => void;
  onPick?: (globalSpikeIndex: number) => void;
}

export class ScatterView {
  private deck: Deck;
  private sock: Sock;
  private canvas: HTMLCanvasElement;
  private spikeIndex: Int32Array = new Int32Array(0);
  private cb: ScatterCallbacks;
  private version = 0;
  private fitted = false;

  constructor(canvas: HTMLCanvasElement, sock: Sock, cb: ScatterCallbacks = {}) {
    this.sock = sock;
    this.canvas = canvas;
    this.cb = cb;
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "ortho" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true, // full HiDPI (fit was the real bottleneck, not pixels)
      pickingRadius: 8, // small points need a pick tolerance, else clicks miss
      onClick: (info: any) => {
        if (info && info.index >= 0 && this.spikeIndex.length) {
          const gi = this.spikeIndex[info.index];
          this.sock.send({ type: "select_spikes", indices: [gi] });
          this.cb.onPick?.(gi);
        }
      },
    });
    setInterval(() => this.reportFps(), 500);
  }

  private reportFps() {
    const fps = (this.deck as any).metrics?.fps;
    if (fps) this.cb.onFps?.(fps);
  }

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

  render(position: Float32Array, color: Uint8Array, spikeIndex: Int32Array) {
    this.spikeIndex = spikeIndex;
    const n = spikeIndex.length;
    // New layer id per update so deck.gl fully recreates GPU buffers instead of
    // reusing them -- reusing leaves stale points/colors when the point count
    // shrinks (e.g. deselecting units).
    const layer = new ScatterplotLayer({
      id: `spikes-${++this.version}`,
      data: { length: n, attributes: {
        getPosition: { value: position, size: 2 },
        getFillColor: { value: color, size: 4 },
      } },
      radiusUnits: "pixels",
      getRadius: 1.2,
      radiusMinPixels: 1,
      stroked: false,
      filled: true,
      antialiasing: false, // halves fragment cost; edge AA is invisible at ~1px
      pickable: true,
    });
    const props: any = { layers: [layer] };
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
      phase += 0.02;
      this.deck.setProps({
        viewState: {
          target: [base.target[0] + Math.sin(phase) * 5, base.target[1], 0],
          zoom: base.zoom,
        },
      });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
