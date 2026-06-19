import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta } from "../types";
import { TracemapView } from "../tracemapView";
import { labelStyle, paneStyle, canvasStyle } from "./paneStyles";
import { GainControl } from "./GainControl";

export function TracemapPane({ sock, meta, paneId }: { sock: Sock; meta: Meta; paneId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TracemapView | null>(null);
  const [gain, setGain] = useState(1);

  useEffect(() => {
    const view = new TracemapView(canvasRef.current!, sock, paneId, setGain);
    viewRef.current = view;
    view.init(meta.duration_s);
    return () => { view.dispose(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ ...paneStyle, borderTop: "1px solid #333" }}>
      <div style={labelStyle}>tracemap (depth × time)</div>
      <canvas ref={canvasRef} style={canvasStyle} />
      <GainControl gain={gain} onBump={(f) => viewRef.current?.bumpGain(f)} />
    </div>
  );
}
