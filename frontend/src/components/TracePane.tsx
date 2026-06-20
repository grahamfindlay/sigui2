import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta } from "../types";
import { TraceView } from "../traceView";
import { useSigui } from "../SiguiContext";
import { labelStyle, fpsStyle, paneStyle, canvasStyle } from "./paneStyles";
import { GainControl } from "./GainControl";

export function TracePane({ sock, meta, paneId }: { sock: Sock; meta: Meta; paneId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TraceView | null>(null);
  const [fps, setFps] = useState(0);
  const [gain, setGain] = useState(1);
  // Shared time window (F3): drive the view's segment + seek; the view's own
  // pan/zoom writes back through emitTimeWindow. A ref keeps the (un-memoized)
  // emitter fresh without re-constructing the view -- its body only touches
  // stable refs, but the ref hop documents the intent and is future-proof.
  const { timeWindow, emitTimeWindow } = useSigui();
  const emitRef = useRef(emitTimeWindow);
  emitRef.current = emitTimeWindow;

  useEffect(() => {
    const view = new TraceView(
      canvasRef.current!, sock, paneId, setFps, setGain,
      (seg, t0, t1) => emitRef.current({ seg, t0, t1 }), meta.seg_durations,
    );
    viewRef.current = view;
    return () => { view.dispose(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seek to the shared window on mount and whenever it changes (a no-op for this
  // pane's own echoed move; the view skips it).
  useEffect(() => {
    viewRef.current?.seek(timeWindow.seg, timeWindow.t0, timeWindow.t1);
  }, [timeWindow]);

  return (
    <div style={{ ...paneStyle, borderBottom: "1px solid #333" }}>
      <div style={labelStyle}>trace (min/max LOD)</div>
      <div style={fpsStyle}>{fps ? `${fps.toFixed(0)} fps` : ""}</div>
      <canvas ref={canvasRef} style={canvasStyle} />
      <GainControl gain={gain} onBump={(f) => viewRef.current?.bumpGain(f)} />
    </div>
  );
}
