import { useEffect, useRef } from "react";
import { Sock } from "../socket";
import { HeatmapView } from "../heatmapView";
import { labelStyle, paneStyle, canvasStyle } from "./paneStyles";

export function HeatmapPane({ sock }: { sock: Sock }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const view = new HeatmapView(canvasRef.current!);
    sock
      .requestFrame({ type: "heatmap_request", view: "similarity" }, "heatmap_frame")
      .then((f) =>
        view.render(
          f.buffers.matrix as Float32Array,
          f.header.n as number,
          f.header.vmin as number,
          f.header.vmax as number,
        ),
      );
    return () => view.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ ...paneStyle, borderLeft: "1px solid #333" }}>
      <div style={labelStyle}>template similarity</div>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  );
}
