import { CSSProperties } from "react";

// Fills the dockview panel body (which has a definite size); the absolute canvas
// then fills this. width/height 100% is required now that panels are sized by
// dockview rather than by CSS-grid tracks.
export const paneStyle: CSSProperties = {
  position: "relative", overflow: "hidden", width: "100%", height: "100%", minHeight: 0,
};
export const canvasStyle: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };
export const labelStyle: CSSProperties = {
  position: "absolute", top: 6, left: 8, zIndex: 2, fontSize: 11, color: "#7fd", pointerEvents: "none",
};
export const fpsStyle: CSSProperties = {
  position: "absolute", top: 6, right: 10, zIndex: 2, fontSize: 11, color: "#fd7", pointerEvents: "none",
};
// Gear button that opens a view's settings popover (F1). Top-right corner; panes
// that also show an fps readout nudge it left of this (see ScatterPane).
export const gearStyle: CSSProperties = {
  position: "absolute", top: 4, right: 6, zIndex: 4,
  width: 20, height: 20, padding: 0, lineHeight: "18px", textAlign: "center",
  fontSize: 12, cursor: "pointer",
  background: "#2a3340", color: "#cde", border: "1px solid #3a4654", borderRadius: 3,
};
