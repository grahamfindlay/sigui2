// Compact viridis colormap (9 control points, linearly interpolated).
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142],
  [31, 158, 137], [53, 183, 121], [110, 206, 88], [253, 231, 37],
];

export function viridis(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, isNaN(t) ? 0 : t));
  const s = t * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(s));
  const f = s - i;
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
