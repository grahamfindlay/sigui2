// Multichannel trace view: min/max LOD frames drawn as vertical segments
// (one per bin per channel) with deck.gl LineLayer. Zoom/pan re-requests a
// frame sized to the viewport, so wire payload stays ~constant with zoom.
import { Deck, OrthographicView } from "@deck.gl/core";
import { LineLayer } from "@deck.gl/layers";
import { Sock } from "./socket";
import { DecodedFrame } from "./frame";
import { attachGainKeys, clampGain } from "./gainControl";

export class TraceView {
  private deck: Deck;
  private sock: Sock;
  private durationS = 1;
  private reqPending = false;
  private lastReq = 0;
  private fitted = false;
  private onFps?: (n: number) => void;
  private onGain?: (g: number) => void;
  private canvas: HTMLCanvasElement;
  private ampGain = 1;
  private lastFrame: DecodedFrame | null = null;
  private fpsTimer?: ReturnType<typeof setInterval>;
  private detachGain: () => void;
  private disposed = false;

  constructor(
    canvas: HTMLCanvasElement, sock: Sock,
    onFps?: (n: number) => void, onGain?: (g: number) => void,
  ) {
    this.sock = sock;
    this.canvas = canvas;
    this.onFps = onFps;
    this.onGain = onGain;
    this.detachGain = attachGainKeys(canvas, (f) => this.bumpGain(f));
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "t" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true, // full HiDPI (see ScatterView note)
      onViewStateChange: ({ viewState }: any) => {
        this.onView(viewState);
        return viewState;
      },
    } as any);
    this.fpsTimer = setInterval(() => {
      const fps = (this.deck as any).metrics?.fps;
      if (fps) this.onFps?.(fps);
    }, 500);
  }

  // Release the GL context + FPS timer + the window keydown listener attached by
  // attachGainKeys. Idempotent; called when the dockview tab is hidden.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.fpsTimer);
    this.detachGain();
    this.deck.finalize();
  }

  // Use the canvas's CSS size (available immediately) rather than deck.width,
  // which is 0 until deck measures on its first frame -- reading it too early
  // mis-fit the traces into a sub-region of large canvases.
  private w() { return Math.max(200, this.canvas.clientWidth || 800); }
  private h() { return Math.max(100, this.canvas.clientHeight || 300); }

  async init(durationS: number) {
    this.durationS = durationS;
    await this.request(0, Math.min(2, durationS));
  }

  bumpGain(factor: number) {
    this.ampGain = clampGain(this.ampGain * factor);
    if (this.lastFrame) this.draw(this.lastFrame);
    this.onGain?.(this.ampGain);
  }

  private onView(viewState: any) {
    const zx = Array.isArray(viewState.zoom) ? viewState.zoom[0] : viewState.zoom;
    const visW = this.w() / Math.pow(2, zx);
    const cx = viewState.target[0];
    const t0 = Math.max(0, cx - visW / 2);
    const t1 = Math.min(this.durationS, cx + visW / 2);
    const now = performance.now();
    if (now - this.lastReq > 120 && !this.reqPending && t1 > t0) {
      this.lastReq = now;
      this.request(t0, t1);
    }
  }

  private async request(t0: number, t1: number) {
    this.reqPending = true;
    const frame = await this.sock.requestFrame(
      { type: "trace_viewport", t0, t1, width_px: this.w() },
      "trace_frame",
    );
    this.reqPending = false;
    this.draw(frame);
  }

  private draw(frame: DecodedFrame) {
    if (this.disposed) return; // a frame can land after the tab was hidden
    this.lastFrame = frame;
    const { header, buffers } = frame;
    const n = header.n_points as number;
    const chans = header.channel_inds as number[];
    const nChan = chans.length;
    const t0 = header.t0 as number;
    const t1 = header.t1 as number;
    const raw = header.raw as boolean;
    const x = buffers.x as Float32Array;
    const ymin = buffers.ymin as Float32Array;            // raw: the single y series
    const ymax = (raw ? buffers.ymin : buffers.ymax) as Float32Array;
    if (n === 0) return;

    let maxAbs = 1e-6;
    for (let k = 0; k < ymin.length; k++) maxAbs = Math.max(maxAbs, Math.abs(ymin[k]));
    if (!raw)
      for (let k = 0; k < ymax.length; k++) maxAbs = Math.max(maxAbs, Math.abs(ymax[k]));
    // Per-frame autoscale (loudest channel ~0.5 of the inter-channel gap) times
    // the user amplitude gain (+/- keys / corner control).
    const gain = (0.5 / maxAbs) * this.ampGain;

    let src: Float32Array, tgt: Float32Array, N: number;
    if (raw) {
      // High/mid zoom: connected polyline through actual samples (GPU-antialiased,
      // no min/max beat).
      const segPerChan = Math.max(0, n - 1);
      N = nChan * segPerChan;
      src = new Float32Array(N * 2);
      tgt = new Float32Array(N * 2);
      let p = 0;
      for (let c = 0; c < nChan; c++) {
        const rowOff = c * n;
        for (let i = 0; i < n - 1; i++) {
          src[p * 2] = t0 + x[i];     src[p * 2 + 1] = c + ymin[rowOff + i] * gain;
          tgt[p * 2] = t0 + x[i + 1]; tgt[p * 2 + 1] = c + ymin[rowOff + i + 1] * gain;
          p++;
        }
      }
    } else {
      // Wide zoom: min/max envelope -- vertical bar per bin + connector to the
      // next bin (reads as a continuous filled waveform).
      const segPerChan = 2 * n - 1;
      N = nChan * segPerChan;
      src = new Float32Array(N * 2);
      tgt = new Float32Array(N * 2);
      let p = 0;
      for (let c = 0; c < nChan; c++) {
        const rowOff = c * n;
        let prevX = 0, prevHi = 0, first = true;
        for (let i = 0; i < n; i++) {
          const xx = t0 + x[i];
          const lo = c + ymin[rowOff + i] * gain;
          const hi = c + ymax[rowOff + i] * gain;
          if (!first) {
            src[p * 2] = prevX; src[p * 2 + 1] = prevHi;
            tgt[p * 2] = xx; tgt[p * 2 + 1] = lo;
            p++;
          }
          src[p * 2] = xx; src[p * 2 + 1] = lo;
          tgt[p * 2] = xx; tgt[p * 2 + 1] = hi;
          p++;
          prevX = xx; prevHi = hi; first = false;
        }
      }
    }

    const layer = new LineLayer({
      id: "traces",
      data: { length: N, attributes: {
        getSourcePosition: { value: src, size: 2 },
        getTargetPosition: { value: tgt, size: 2 },
      } },
      getColor: [80, 170, 235],
      getWidth: 1,
      widthUnits: "pixels",
    } as any);

    const props: any = { layers: [layer] };
    if (!this.fitted) {
      const spanX = Math.max(1e-6, t1 - t0);
      props.initialViewState = {
        target: [(t0 + t1) / 2, (nChan - 1) / 2, 0],
        zoom: [Math.log2(this.w() / spanX), Math.log2(this.h() / (nChan + 1))],
      };
      this.fitted = true;
    }
    this.deck.setProps(props);
  }
}
