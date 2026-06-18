import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { UnitId } from "../types";
import { DensityView } from "../densityView";
import { labelStyle, fpsStyle, paneStyle, canvasStyle } from "./paneStyles";

// Faithful 2D density (full spike set) companion to the decimated amplitude
// scatter. Pan/zoom re-bins over the viewport (server-side), so it stays sharp.
export function DensityPane(
  { sock, visibleUnits }: { sock: Sock; visibleUnits: UnitId[] },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<DensityView | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const view = new DensityView(canvasRef.current!, sock, setCount);
    viewRef.current = view;
    view.init(visibleUnits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.setUnits(visibleUnits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleUnits]);

  return (
    <div style={{ ...paneStyle, borderLeft: "1px solid #333" }}>
      <div style={labelStyle}>density (time × amplitude, full set)</div>
      <div style={fpsStyle}>{count ? `${count.toLocaleString()} spikes` : ""}</div>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  );
}
