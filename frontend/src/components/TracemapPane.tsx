import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta } from "../types";
import { TracemapView } from "../tracemapView";
import { useSigui } from "../SiguiContext";
import { labelStyle, paneStyle, canvasStyle } from "./paneStyles";
import { GainControl } from "./GainControl";

export function TracemapPane({ sock, meta, paneId }: { sock: Sock; meta: Meta; paneId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TracemapView | null>(null);
  const [gain, setGain] = useState(1);
  // Shared time window (F3): same wiring as TracePane.
  const { timeWindow, emitTimeWindow } = useSigui();
  const emitRef = useRef(emitTimeWindow);
  emitRef.current = emitTimeWindow;

  useEffect(() => {
    const view = new TracemapView(
      canvasRef.current!, sock, paneId, setGain,
      (seg, t0, t1) => emitRef.current({ seg, t0, t1 }), meta.seg_durations,
    );
    viewRef.current = view;
    return () => { view.dispose(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.seek(timeWindow.seg, timeWindow.t0, timeWindow.t1);
  }, [timeWindow]);

  return (
    <div style={{ ...paneStyle, borderTop: "1px solid #333" }}>
      <div style={labelStyle}>tracemap (depth × time)</div>
      <canvas ref={canvasRef} style={canvasStyle} />
      <GainControl gain={gain} onBump={(f) => viewRef.current?.bumpGain(f)} />
    </div>
  );
}
