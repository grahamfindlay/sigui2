// 2D density overview: a server-computed histogram of the visible units' spikes
// in (time, amplitude) space, drawn as a deck.gl BitmapLayer. Unlike the scatter
// (a per-unit decimated *sample*), this is the FULL spike set, so the density is
// faithful. Viewport-driven like the trace/tracemap views: each pan/zoom settle
// re-requests a histogram binned over exactly the current world range at canvas
// resolution, so zooming in refines the bins instead of magnifying pixels.
import { Deck, OrthographicView } from "@deck.gl/core";
import { BitmapLayer } from "@deck.gl/layers";
import { Sock } from "./socket";
import { DecodedFrame } from "./frame";
import { viridis } from "./colormap";

type UnitId = string | number;
type Bounds = [number, number, number, number]; // x0, y0, x1, y1

export class DensityView {
  private deck: Deck;
  private sock: Sock;
  private canvas: HTMLCanvasElement;
  private unitIds: UnitId[] = [];
  private reqPending = false;
  private lastReq = 0;
  private fitted = false;
  private lastBounds: Bounds | null = null;
  private onCount?: (n: number) => void;

  constructor(canvas: HTMLCanvasElement, sock: Sock, onCount?: (n: number) => void) {
    this.sock = sock;
    this.canvas = canvas;
    this.onCount = onCount;
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "d" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true,
      onViewStateChange: ({ viewState }: any) => {
        this.onView(viewState);
        return viewState;
      },
    } as any);
  }

  private w() { return Math.max(64, this.canvas.clientWidth || 800); }
  private h() { return Math.max(48, this.canvas.clientHeight || 400); }

  async init(unitIds: UnitId[]) {
    this.unitIds = unitIds;
    await this.request(null); // full-range -> server reports bounds, we fit
  }

  // Visibility changed: re-bin the current viewport over the new unit set.
  setUnits(unitIds: UnitId[]) {
    this.unitIds = unitIds;
    this.request(this.lastBounds);
  }

  private onView(viewState: any) {
    const z = viewState.zoom;
    const zx = Array.isArray(z) ? z[0] : z;
    const zy = Array.isArray(z) ? z[1] : z;
    const visW = this.w() / Math.pow(2, zx);
    const visH = this.h() / Math.pow(2, zy);
    const cx = viewState.target[0], cy = viewState.target[1];
    const bounds: Bounds = [cx - visW / 2, cy - visH / 2, cx + visW / 2, cy + visH / 2];
    const now = performance.now();
    if (now - this.lastReq > 120 && !this.reqPending) {
      this.lastReq = now;
      this.request(bounds);
    }
  }

  private async request(bounds: Bounds | null) {
    this.reqPending = true;
    const msg: any = {
      type: "density_request", view: "amplitude", unit_ids: this.unitIds,
      width_px: Math.round(this.w()), height_px: Math.round(this.h()),
    };
    if (bounds) { [msg.x0, msg.y0, msg.x1, msg.y1] = bounds; }
    const frame = await this.sock.requestFrame(msg, "density_frame");
    this.reqPending = false;
    this.draw(frame);
  }

  private draw(frame: DecodedFrame) {
    const { header, buffers } = frame;
    const W = header.width as number, H = header.height as number;
    if (!W || !H) { this.deck.setProps({ layers: [] }); return; }
    const x0 = header.x0 as number, x1 = header.x1 as number;
    const y0 = header.y0 as number, y1 = header.y1 as number;
    const vmax = header.vmax as number;
    const counts = buffers.counts as Float32Array; // (H*W) row-major, row 0 = max y
    this.lastBounds = [x0, y0, x1, y1];
    this.onCount?.(header.n_spikes as number);

    // Log scaling (spike density is heavy-tailed); empty bins are transparent so
    // the dark canvas reads as "no spikes".
    const rgba = new Uint8ClampedArray(W * H * 4);
    const denom = 1 / Math.log1p(Math.max(1e-9, vmax));
    for (let k = 0; k < W * H; k++) {
      const c = counts[k];
      if (c <= 0) { rgba[k * 4 + 3] = 0; continue; }
      const t = Math.min(1, Math.log1p(c) * denom);
      const [r, g, b] = viridis(t);
      rgba[k * 4] = r; rgba[k * 4 + 1] = g; rgba[k * 4 + 2] = b; rgba[k * 4 + 3] = 255;
    }

    const layer = new BitmapLayer({
      id: `density-${this.fitted ? 1 : 0}-${x0.toFixed(4)}-${y0.toFixed(4)}`,
      image: new ImageData(rgba, W, H),
      bounds: [x0, y0, x1, y1],
      textureParameters: { minFilter: "nearest", magFilter: "nearest" },
    } as any);

    const props: any = { layers: [layer] };
    if (!this.fitted) {
      const spanX = Math.max(1e-6, x1 - x0), spanY = Math.max(1e-6, y1 - y0);
      props.initialViewState = {
        target: [(x0 + x1) / 2, (y0 + y1) / 2, 0],
        zoom: [Math.log2((this.w() * 0.92) / spanX), Math.log2((this.h() * 0.92) / spanY)],
      };
      this.fitted = true;
    }
    this.deck.setProps(props);
  }
}
