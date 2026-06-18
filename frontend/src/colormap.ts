// Compact viridis colormap (9 control points, linearly interpolated).
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [110, 206, 88], [253, 231, 37],
];

function lerpStops(stops: [number, number, number][], t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, isNaN(t) ? 0 : t));
  const s = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(s));
  const f = s - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function viridis(t: number): [number, number, number] {
  return lerpStops(VIRIDIS, t);
}

// Diverging blue–white–red (RdBu reversed): t=0 deep blue (negative),
// t=0.5 white (zero), t=1 deep red (positive). For signed data (traces).
const DIVERGING: [number, number, number][] = [
  [5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240],
  [247, 247, 247],
  [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31],
];

export function diverging(t: number): [number, number, number] {
  return lerpStops(DIVERGING, t);
}
