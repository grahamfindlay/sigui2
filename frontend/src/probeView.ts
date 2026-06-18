// Probe view: unit positions on the probe geometry. Each unit is a dot at its
// computed (x, y) location, colored by unit; currently-visible units are bright,
// the rest dim, so the panel reads as a spatial map of which units sit where.
// Contact locations and each probe's planar contour are drawn underneath for
// context. Static geometry (from metadata) -- only the visible highlight
// re-renders on toggle.
import { Deck, OrthographicView } from "@deck.gl/core";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";

export type RGB = [number, number, number];

export interface ProbeUnit {
  id: string;
  x: number;
  y: number;
  color: RGB;
}

export interface ProbeGeometry {
  contacts: [number, number][];
  contours: [number, number][][];
  units: ProbeUnit[];
}

export class ProbeView {
  private deck: Deck;
  private canvas: HTMLCanvasElement;
  private geom: ProbeGeometry;
  private fitted = false;
  private version = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, geom: ProbeGeometry) {
    this.canvas = canvas;
    this.geom = geom;
    this.deck = new Deck({
      canvas,
      views: [new OrthographicView({ id: "p" })],
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

  private fit() {
    const pts = this.geom.contacts.length ? this.geom.contacts
      : this.geom.units.map((u) => [u.x, u.y] as [number, number]);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of pts) {
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    const m = 20;
    xmin -= m; xmax += m; ymin -= m; ymax += m;
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 400;
    const spanX = Math.max(1e-6, xmax - xmin), spanY = Math.max(1e-6, ymax - ymin);
    return {
      target: [(xmin + xmax) / 2, (ymin + ymax) / 2, 0],
      zoom: [Math.log2((w * 0.9) / spanX), Math.log2((h * 0.9) / spanY)],
    };
  }

  render(visible: Set<string>) {
    if (this.disposed) return;
    this.version++;
    const layers: any[] = [];

    if (this.geom.contours.length) {
      layers.push(new PathLayer({
        id: `probe-contour-${this.version}`,
        data: this.geom.contours,
        getPath: (d: any) => d,
        getColor: [127, 200, 80, 160],
        getWidth: 1, widthUnits: "pixels", widthMinPixels: 1,
      } as any));
    }

    if (this.geom.contacts.length) {
      const cpos = new Float32Array(this.geom.contacts.length * 2);
      this.geom.contacts.forEach(([x, y], i) => { cpos[i * 2] = x; cpos[i * 2 + 1] = y; });
      layers.push(new ScatterplotLayer({
        id: `probe-contacts-${this.version}`,
        data: { length: this.geom.contacts.length, attributes: {
          getPosition: { value: cpos, size: 2 },
        } },
        radiusUnits: "pixels", getRadius: 2, radiusMinPixels: 1,
        stroked: false, filled: true, antialiasing: false,
        getFillColor: [90, 90, 96, 200], pickable: false,
      } as any));
    }

    // Units: bright if visible, dim otherwise. Built as one layer with per-unit
    // color/alpha; a fresh id each render so buffers don't go stale.
    const us = this.geom.units;
    const upos = new Float32Array(us.length * 2);
    const ucol = new Uint8Array(us.length * 4);
    const urad = new Float32Array(us.length);
    us.forEach((u, i) => {
      const on = visible.has(u.id);
      upos[i * 2] = u.x; upos[i * 2 + 1] = u.y;
      ucol[i * 4] = u.color[0]; ucol[i * 4 + 1] = u.color[1]; ucol[i * 4 + 2] = u.color[2];
      ucol[i * 4 + 3] = on ? 255 : 55;
      urad[i] = on ? 7 : 4;
    });
    layers.push(new ScatterplotLayer({
      id: `probe-units-${this.version}`,
      data: { length: us.length, attributes: {
        getPosition: { value: upos, size: 2 },
        getFillColor: { value: ucol, size: 4 },
        getRadius: { value: urad, size: 1 },
      } },
      radiusUnits: "pixels", radiusMinPixels: 2,
      stroked: false, filled: true, antialiasing: true, pickable: false,
    } as any));

    const props: any = { layers };
    if (!this.fitted) { props.initialViewState = this.fit(); this.fitted = true; }
    this.deck.setProps(props);
  }
}
