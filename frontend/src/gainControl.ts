// Hover-targeted amplitude-gain keyboard control. The mouse wheel is taken by
// pan/zoom, so +/- (and = as +) adjust the vertical gain of whichever amplitude
// view the cursor is currently over. Returns a cleanup function.
export function attachGainKeys(
  canvas: HTMLCanvasElement, bump: (factor: number) => void,
): () => void {
  let hovered = false;
  const enter = () => { hovered = true; };
  const leave = () => { hovered = false; };
  const onKey = (e: KeyboardEvent) => {
    if (!hovered) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); bump(1.3); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); bump(1 / 1.3); }
  };
  canvas.addEventListener("pointerenter", enter);
  canvas.addEventListener("pointerleave", leave);
  window.addEventListener("keydown", onKey);
  return () => {
    canvas.removeEventListener("pointerenter", enter);
    canvas.removeEventListener("pointerleave", leave);
    window.removeEventListener("keydown", onKey);
  };
}

export const GAIN_MIN = 0.05;
export const GAIN_MAX = 500;
export const clampGain = (g: number) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, g));
