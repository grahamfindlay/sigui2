// Waveform view: per-unit average templates drawn at probe geometry. Each
// channel's template is a small polyline anchored at the channel's (x, y)
// location; units are overlaid and colored. deck.gl LineLayer with binary
// attributes (same hot-path approach as the trace view).
import { Deck, OrthographicView } from "@deck.gl/core";
import { LineLayer } from "@deck.gl/layers";
import { attachGainKeys, clampGain } from "./gainControl";

export type RGB = [number, number, number];
export interface WaveUnitData {
  channels: number[]; // channel indices into geom.locations
  values: Float32Array; // (n_channels * n_samples), row-major per channel
  color: RGB;
}
export interface WaveGeom {
  locations: [number, number][]; // channel (x, y)
  nbefore: number; // sample index of the template peak
  nSamples: number;
  absMax: number; // global |template| max, for amplitude scaling
}

export class WaveformView {
  private deck: Deck;
  private canvas: HTMLCanvasElement;
  private version = 0;
  private fitted = false;
  private pitch = 0;
  private gain = 1;
  private units: WaveUnitData[] = [];
  private geom: WaveGeom | null = null;
  private onGain?: (g: number) => void;
  private detachGain: () => void;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, onGain?: (g: number) => void) {
    this.canvas = canvas;
    this.onGain = onGain;
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "wf" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true,
    } as any);
    this.detachGain = attachGainKeys(canvas, (f) => this.bumpGain(f));
  }

  // Release the GL context + the window keydown listener (attachGainKeys).
  // Idempotent; called when the dockview tab is hidden.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detachGain();
    this.deck.finalize();
  }

  bumpGain(factor: number) {
    this.gain = clampGain(this.gain * factor);
    this.draw();
    this.onGain?.(this.gain);
  }

  // Median nearest-neighbour channel distance, used to scale waveforms relative
  // to the contact spacing. Computed once (O(n^2), fine for <=384 channels).
  private computePitch(loc: [number, number][]): number {
    const n = loc.length;
    if (n < 2) return 0;
    const nn: number[] = [];
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const d = Math.hypot(loc[i][0] - loc[j][0], loc[i][1] - loc[j][1]);
        if (d > 0 && d < m) m = d;
      }
      if (Number.isFinite(m)) nn.push(m);
    }
    if (!nn.length) return 0;
    nn.sort((a, b) => a - b);
    return nn[Math.floor(nn.length / 2)];
  }

  private fit(loc: [number, number][]) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of loc) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    const pad = this.pitch * 1.3;
    xmin -= pad; xmax += pad; ymin -= pad; ymax += pad;
    const w = this.canvas.clientWidth || 500, h = this.canvas.clientHeight || 400;
    const spanX = Math.max(1e-6, xmax - xmin), spanY = Math.max(1e-6, ymax - ymin);
    return {
      target: [(xmin + xmax) / 2, (ymin + ymax) / 2, 0],
      zoom: [Math.log2(w / spanX), Math.log2(h / spanY)],
    };
  }

  render(units: WaveUnitData[], geom: WaveGeom) {
    this.units = units;
    this.geom = geom;
    this.draw();
  }

  private draw() {
    const geom = this.geom;
    if (this.disposed || !geom) return; // a fetch can resolve after tab hidden
    const units = this.units;
    if (!this.pitch) this.pitch = this.computePitch(geom.locations) || 20;
    const xs = (0.7 * this.pitch) / Math.max(1, geom.nSamples);
    // 0.8 puts the largest template at ~0.8 of a contact pitch by default;
    // the user scales further with the +/- gain.
    const ys = (0.8 * this.pitch * this.gain) / Math.max(1e-6, geom.absMax);

    let nSeg = 0;
    for (const u of units) nSeg += u.channels.length * Math.max(0, geom.nSamples - 1);
    const src = new Float32Array(nSeg * 2);
    const tgt = new Float32Array(nSeg * 2);
    const col = new Uint8Array(nSeg * 4);
    let p = 0;
    for (const u of units) {
      for (let j = 0; j < u.channels.length; j++) {
        const loc = geom.locations[u.channels[j]];
        if (!loc) continue;
        const cx = loc[0], cy = loc[1];
        const row = u.values.subarray(j * geom.nSamples, (j + 1) * geom.nSamples);
        for (let i = 0; i < geom.nSamples - 1; i++) {
          // flipY: world +y is down on screen, so a negative trough (cy - val)
          // deflects downward, the conventional orientation.
          src[p * 2] = cx + (i - geom.nbefore) * xs; src[p * 2 + 1] = cy - row[i] * ys;
          tgt[p * 2] = cx + (i + 1 - geom.nbefore) * xs; tgt[p * 2 + 1] = cy - row[i + 1] * ys;
          col[p * 4] = u.color[0]; col[p * 4 + 1] = u.color[1]; col[p * 4 + 2] = u.color[2]; col[p * 4 + 3] = 255;
          p++;
        }
      }
    }

    const layer = new LineLayer({
      id: `wf-${++this.version}`,
      data: { length: p, attributes: {
        getSourcePosition: { value: src, size: 2 },
        getTargetPosition: { value: tgt, size: 2 },
        getColor: { value: col, size: 4 },
      } },
      getWidth: 1,
      widthUnits: "pixels",
    } as any);

    const props: any = { layers: [layer] };
    if (!this.fitted && geom.locations.length) {
      props.initialViewState = this.fit(geom.locations);
      this.fitted = true;
    }
    this.deck.setProps(props);
  }
}
