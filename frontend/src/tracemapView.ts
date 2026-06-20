// Tracemap: traces as a depth × time image (channels = rows, time = columns),
// colormapped with a diverging map symmetric about zero. Same viewport/refetch
// mechanism as the line trace view (a frame sized to the viewport width arrives
// per pan/zoom), but rendered as a deck.gl BitmapLayer. A contrast "gain"
// scales the color limit (wheel is taken by zoom, so +/- like the other views).
import { Deck, OrthographicView } from "@deck.gl/core";
import { BitmapLayer } from "@deck.gl/layers";
import { Sock } from "./socket";
import { DecodedFrame } from "./frame";
import { diverging } from "./colormap";
import { attachGainKeys, clampGain } from "./gainControl";

// Quantized {seg,t0,t1} key (matches App.tsx / traceView): recognizes the
// server's echo of this view's own pan so it isn't re-seeked.
const winKey = (seg: number, t0: number, t1: number) =>
  `${seg}:${t0.toFixed(4)}:${t1.toFixed(4)}`;

export class TracemapView {
  private deck: Deck;
  private sock: Sock;
  private canvas: HTMLCanvasElement;
  private durationS = 1;
  private reqPending = false;
  private lastReq = 0;
  private fitted = false;
  private onGain?: (g: number) => void;
  private colorGain = 1; // higher = more contrast (smaller effective color limit)
  private lastFrame: DecodedFrame | null = null;
  private detachGain: () => void;
  private disposed = false;
  // F3 segment + time-seek (mirrors TraceView): see that class for the rationale
  // of each field (segment fetched, write-back, per-seg durations, self-echo key,
  // programmatic-move guard, preserved vertical viewport).
  private seg = 0;
  private onWindow?: (seg: number, t0: number, t1: number) => void;
  private segDurations: number[];
  private lastWindowKey: string | null = null;
  private applyingExternal = false;
  private lastTargetY = 0;
  private lastZoomY = 0;

  constructor(
    canvas: HTMLCanvasElement, sock: Sock, paneId: string, onGain?: (g: number) => void,
    onWindow?: (seg: number, t0: number, t1: number) => void, segDurations?: number[],
  ) {
    this.sock = sock;
    this.canvas = canvas;
    this.onGain = onGain;
    this.onWindow = onWindow;
    this.segDurations = segDurations ?? [];
    this.detachGain = attachGainKeys(paneId, (f) => this.bumpGain(f));
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "tm" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true,
      onViewStateChange: ({ viewState }: any) => {
        this.onView(viewState);
        return viewState;
      },
    } as any);
  }

  // Release the GL context + the dispatcher gain bindings (attachGainKeys).
  // Idempotent; called when the dockview tab is hidden.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.detachGain();
    this.deck.finalize();
  }

  private w() { return Math.max(200, this.canvas.clientWidth || 800); }
  private h() { return Math.max(100, this.canvas.clientHeight || 300); }

  // Drive the view to the shared {seg,t0,t1} window (F3); see TraceView.seek.
  seek(seg: number, t0: number, t1: number) {
    const k = winKey(seg, t0, t1);
    if (this.fitted && k === this.lastWindowKey) return;
    const segChanged = seg !== this.seg;
    this.seg = seg;
    this.durationS = this.segDurations[seg] ?? this.durationS;
    this.lastWindowKey = k;
    this.applyingExternal = true;
    if (segChanged) {
      this.fitted = false;
    } else if (this.fitted) {
      const cx = (t0 + t1) / 2;
      const spanX = Math.max(1e-6, t1 - t0);
      this.deck.setProps({
        initialViewState: {
          target: [cx, this.lastTargetY, 0],
          zoom: [Math.log2(this.w() / spanX), this.lastZoomY],
        },
      } as any);
    }
    setTimeout(() => { this.applyingExternal = false; }, 0);
    this.request(t0, t1);
  }

  bumpGain(factor: number) {
    this.colorGain = clampGain(this.colorGain * factor);
    if (this.lastFrame) this.draw(this.lastFrame);
    this.onGain?.(this.colorGain);
  }

  private onView(viewState: any) {
    this.lastTargetY = viewState.target[1];
    const zy = viewState.zoom;
    this.lastZoomY = Array.isArray(zy) ? zy[1] : 0;
    if (this.applyingExternal) return;
    const zx = Array.isArray(viewState.zoom) ? viewState.zoom[0] : viewState.zoom;
    const visW = this.w() / Math.pow(2, zx);
    const cx = viewState.target[0];
    const t0 = Math.max(0, cx - visW / 2);
    const t1 = Math.min(this.durationS, cx + visW / 2);
    const now = performance.now();
    if (now - this.lastReq > 120 && !this.reqPending && t1 > t0) {
      this.lastReq = now;
      this.lastWindowKey = winKey(this.seg, t0, t1);
      this.request(t0, t1);
      this.onWindow?.(this.seg, t0, t1);
    }
  }

  private async request(t0: number, t1: number) {
    this.reqPending = true;
    const frame = await this.sock.requestFrame(
      { type: "tracemap_request", t0, t1, width_px: this.w(), seg: this.seg },
      "tracemap_frame",
    );
    this.reqPending = false;
    this.draw(frame);
  }

  private draw(frame: DecodedFrame) {
    if (this.disposed) return; // a frame can land after the tab was hidden
    this.lastFrame = frame;
    // Test hook (F3 harness reads the last frame's segment + window).
    (globalThis as any).__siguiLastTracemap = {
      seg: frame.header.seg, t0: frame.header.t0, t1: frame.header.t1,
    };
    const { header, buffers } = frame;
    const nChan = header.n_chan as number;
    const nCols = header.n_cols as number;
    const t0 = header.t0 as number;
    const t1 = header.t1 as number;
    const limit = (header.color_limit as number) / this.colorGain;
    const image = buffers.image as Float32Array; // (n_chan, n_cols) row-major
    if (!nChan || !nCols) return;

    const rgba = new Uint8ClampedArray(nChan * nCols * 4);
    const inv = 1 / (2 * Math.max(1e-12, limit));
    for (let k = 0; k < nChan * nCols; k++) {
      // map [-limit, +limit] -> [0, 1] for the diverging colormap
      const [r, g, b] = diverging((image[k] + limit) * inv);
      rgba[k * 4] = r; rgba[k * 4 + 1] = g; rgba[k * 4 + 2] = b; rgba[k * 4 + 3] = 255;
    }
    // ImageData is row-major (width, height) = (nCols, nChan); row 0 = first
    // depth-ordered channel, mapped to the top of the bounds box.
    const layer = new BitmapLayer({
      id: `tracemap-${this.fitted ? 1 : 0}-${t0.toFixed(4)}`,
      image: new ImageData(rgba, nCols, nChan),
      bounds: [t0, 0, t1, nChan],
      textureParameters: { minFilter: "nearest", magFilter: "nearest" },
    } as any);

    const props: any = { layers: [layer] };
    if (!this.fitted) {
      const spanX = Math.max(1e-6, t1 - t0);
      this.lastTargetY = nChan / 2;
      this.lastZoomY = Math.log2(this.h() / (nChan + 1));
      props.initialViewState = {
        target: [(t0 + t1) / 2, this.lastTargetY, 0],
        zoom: [Math.log2(this.w() / spanX), this.lastZoomY],
      };
      this.fitted = true;
    }
    this.deck.setProps(props);
  }
}
