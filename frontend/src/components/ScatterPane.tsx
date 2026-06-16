import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta, UnitId } from "../types";
import { ScatterView } from "../scatterView";
import { CachedUnitView } from "../unitCache";
import { DecodedFrame } from "../frame";
import { labelStyle, fpsStyle, paneStyle, canvasStyle } from "./paneStyles";

// One unit's contribution to the scatter, sliced (zero-copy) out of a delta
// frame and cached so toggling visibility never re-fetches it.
interface ScatterUnit {
  position: Float32Array; // (n*2) view-relative x,y
  color: Uint8Array; // (n*4) rgba
  spikeIndex: Int32Array; // (n) global spike indices
}

function splitScatterFrame(frame: DecodedFrame): Map<string, ScatterUnit> {
  const ranges = (frame.header.ranges ?? {}) as Record<string, [number, number]>;
  const position = frame.buffers.position as Float32Array;
  const color = frame.buffers.color as Uint8Array;
  const spikeIndex = frame.buffers.spike_index as Int32Array;
  const out = new Map<string, ScatterUnit>();
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    out.set(k, {
      position: position.subarray(lo * 2, hi * 2),
      color: color.subarray(lo * 4, hi * 4),
      spikeIndex: spikeIndex.subarray(lo, hi),
    });
  }
  return out;
}

export function ScatterPane(
  { sock, visibleUnits, stress }:
  { sock: Sock; meta: Meta; visibleUnits: UnitId[]; stress: number },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cvRef = useRef<CachedUnitView<ScatterUnit> | null>(null);
  const [fps, setFps] = useState(0);
  const [pick, setPick] = useState<number | null>(null);

  useEffect(() => {
    const view = new ScatterView(canvasRef.current!, sock, { onFps: setFps, onPick: setPick });
    if (stress > 0) {
      view.stress(stress);
      return;
    }
    // Assemble the visible units' cached slices into one contiguous buffer set
    // (a local memcpy, no network) and render.
    cvRef.current = new CachedUnitView<ScatterUnit>(
      sock,
      "scatter_frame",
      (missing) => ({ type: "scatter_request", view: "amplitude", unit_ids: missing }),
      splitScatterFrame,
      (visible) => {
        let n = 0;
        for (const { value } of visible) n += value.spikeIndex.length;
        const position = new Float32Array(n * 2);
        const color = new Uint8Array(n * 4);
        const spikeIndex = new Int32Array(n);
        let o = 0;
        for (const { value } of visible) {
          const m = value.spikeIndex.length;
          position.set(value.position, o * 2);
          color.set(value.color, o * 4);
          spikeIndex.set(value.spikeIndex, o);
          o += m;
        }
        view.render(position, color, spikeIndex);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stress > 0) return;
    cvRef.current?.setVisible(visibleUnits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleUnits]);

  const label =
    stress > 0
      ? `STRESS: ${stress.toLocaleString()} points (synthetic)`
      : pick != null
        ? `amplitude scatter · picked spike #${pick}`
        : `amplitude scatter · ${visibleUnits.length} units`;

  return (
    <div style={paneStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={fpsStyle}>{fps ? `${fps.toFixed(0)} fps` : ""}</div>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  );
}
