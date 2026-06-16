import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta } from "../types";
import { TraceView } from "../traceView";
import { labelStyle, fpsStyle, paneStyle, canvasStyle } from "./paneStyles";

export function TracePane({ sock, meta }: { sock: Sock; meta: Meta }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const view = new TraceView(canvasRef.current!, sock, setFps);
    view.init(meta.duration_s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ ...paneStyle, borderBottom: "1px solid #333" }}>
      <div style={labelStyle}>trace (min/max LOD)</div>
      <div style={fpsStyle}>{fps ? `${fps.toFixed(0)} fps` : ""}</div>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  );
}
