// Heatmap primitive: an N x N value matrix colormapped to an RGBA image and
// drawn with deck.gl BitmapLayer. Used for the template-similarity view.
import { Deck, OrthographicView } from "@deck.gl/core";
import { BitmapLayer } from "@deck.gl/layers";
import { viridis } from "./colormap";

export class HeatmapView {
  private deck: Deck;
  private canvas: HTMLCanvasElement;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "h" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true,
    } as any);
  }

  // Release the GL context. Idempotent; called when the dockview tab is hidden.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.deck.finalize();
  }

  render(matrix: Float32Array, n: number, vmin: number, vmax: number) {
    if (this.disposed) return; // the similarity frame can land after tab hidden
    if (n === 0) { this.deck.setProps({ layers: [] }); return; }
    const rgba = new Uint8ClampedArray(n * n * 4);
    const span = Math.max(1e-9, vmax - vmin);
    for (let k = 0; k < n * n; k++) {
      const [r, g, b] = viridis((matrix[k] - vmin) / span);
      rgba[k * 4] = r; rgba[k * 4 + 1] = g; rgba[k * 4 + 2] = b; rgba[k * 4 + 3] = 255;
    }
    const layer = new BitmapLayer({
      id: `sim-${n}`,
      image: new ImageData(rgba, n, n),
      bounds: [0, 0, n, n],
      // Crisp cells: nearest-neighbour sampling instead of linear upscaling.
      textureParameters: { minFilter: "nearest", magFilter: "nearest" },
    } as any);
    const w = this.canvas.clientWidth || 400, h = this.canvas.clientHeight || 400;
    const zoom = Math.log2((Math.min(w, h) * 0.92) / n);
    this.deck.setProps({ layers: [layer], initialViewState: { target: [n / 2, n / 2, 0], zoom } });
  }
}
