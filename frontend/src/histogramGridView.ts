// Stacked per-unit 1D histograms (ISI, auto-correlogram) drawn as vertical bars
// with deck.gl LineLayer, one row per visible unit, colored by unit.
import { Deck, OrthographicView } from "@deck.gl/core";
import { SolidPolygonLayer } from "@deck.gl/layers";

export type RGB = [number, number, number];

export class HistogramGridView {
  private deck: Deck;
  private canvas: HTMLCanvasElement;
  private version = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "hg" })],
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      controller: true,
      useDevicePixels: true,
    } as any);
  }

  render(bins: Float32Array, counts: Float32Array, nUnits: number, nBins: number, colors: RGB[]) {
    if (nUnits === 0 || nBins === 0) { this.deck.setProps({ layers: [] }); return; }

    // Bin edges (length nBins+1). If only centers were sent, derive edges.
    let edges: Float32Array;
    if (bins.length >= nBins + 1) {
      edges = bins;
    } else {
      edges = new Float32Array(nBins + 1);
      const bw = nBins > 1 ? bins[1] - bins[0] : 1;
      for (let i = 0; i < nBins; i++) edges[i] = bins[i] - bw / 2;
      edges[nBins] = bins[nBins - 1] + bw / 2;
    }
    const xmin = edges[0], xmax = edges[nBins];

    // One filled "step" polygon per unit (no inter-bar gaps). OrthographicView
    // has flipY (y down), so the row baseline sits at the BOTTOM of the band
    // (u + 0.9) and bars rise upward toward smaller y.
    const data: { polygon: number[][]; color: RGB }[] = [];
    for (let u = 0; u < nUnits; u++) {
      const row = counts.subarray(u * nBins, (u + 1) * nBins);
      let mx = 1e-9;
      for (let i = 0; i < nBins; i++) mx = Math.max(mx, row[i]);
      const base = u + 0.9;
      const poly: number[][] = [[edges[0], base]];
      for (let i = 0; i < nBins; i++) {
        const yh = base - (0.8 * row[i]) / mx;
        poly.push([edges[i], yh], [edges[i + 1], yh]);
      }
      poly.push([edges[nBins], base]);
      data.push({ polygon: poly, color: colors[u] ?? [150, 150, 150] });
    }

    const layer = new SolidPolygonLayer({
      id: `hg-${++this.version}`,
      data,
      getPolygon: (d: any) => d.polygon,
      getFillColor: (d: any) => [d.color[0], d.color[1], d.color[2], 230],
    } as any);

    const w = this.canvas.clientWidth || 400, h = this.canvas.clientHeight || 300;
    const spanX = Math.max(1e-6, xmax - xmin);
    this.deck.setProps({
      layers: [layer],
      initialViewState: {
        target: [(xmin + xmax) / 2, (nUnits - 1) / 2 + 0.4, 0],
        zoom: [Math.log2(w / spanX), Math.log2(h / (nUnits + 0.5))],
      },
    });
  }
}
