// Amplitude-gain keyboard control, now routed through the single app keybinding
// dispatcher (see keybindings.ts) instead of each view owning a `window`
// listener. The mouse wheel is taken by pan/zoom, so +/- (and = as +, _ as -)
// adjust the vertical gain of whichever amplitude view is the active pane -- the
// pane the pointer is over, set by PaneFocus. Bindings are scoped to `paneId` so
// "+" only bumps the hovered amplitude view. Returns a cleanup that unregisters.
import { register } from "./keybindings";

export function attachGainKeys(paneId: string, bump: (factor: number) => void): () => void {
  const offs = [
    register({ combo: "+", context: paneId, label: "increase gain", run: () => bump(1.3) }),
    register({ combo: "=", context: paneId, label: "increase gain", run: () => bump(1.3) }),
    register({ combo: "-", context: paneId, label: "decrease gain", run: () => bump(1 / 1.3) }),
    register({ combo: "_", context: paneId, label: "decrease gain", run: () => bump(1 / 1.3) }),
  ];
  return () => offs.forEach((off) => off());
}

export const GAIN_MIN = 0.05;
export const GAIN_MAX = 500;
export const clampGain = (g: number) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, g));
