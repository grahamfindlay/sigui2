import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta, UnitId } from "../types";
import { ScatterView } from "../scatterView";
import { CachedUnitView } from "../unitCache";
import { DecodedFrame } from "../frame";
import { useSigui } from "../SiguiContext";
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ScatterView | null>(null);
  const cvRef = useRef<CachedUnitView<ScatterUnit> | null>(null);
  const visRef = useRef<UnitId[]>(visibleUnits);
  visRef.current = visibleUnits;
  const [fps, setFps] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [lasso, setLasso] = useState(false);
  const [localSel, setLocalSel] = useState(0);
  const { selection, selectionNonce, clearSelection, pickedPoints, pickSpikes } = useSigui();

  useEffect(() => {
    const view = new ScatterView(canvasRef.current!, overlayRef.current!, {
      onFps: setFps,
      onPick: (gi, point) => { setPick(gi); pickSpikes([gi], [point]); },
      onLassoLocal: setLocalSel,
      // Hand the world-space polygon to the server for the EXACT selection
      // (the rendered points are only a decimated sample). visRef keeps the
      // unit set current without re-creating the view.
      onLasso: (polygon) =>
        sock.send({ type: "select_region", view: "amplitude",
          polygon, unit_ids: visRef.current }),
    });
    viewRef.current = view;
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

  // External clear (toolbar "clear", or post-split) wipes the lasso highlight.
  useEffect(() => {
    viewRef.current?.clearSelection();
    setLocalSel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionNonce]);

  // Picked spikes (single click here, or a spikelist row) highlight at their
  // world coords -- shows even for spikes not in the decimated working set.
  useEffect(() => {
    viewRef.current?.highlightPoints(pickedPoints);
  }, [pickedPoints]);

  const toggleLasso = () => {
    const next = !lasso;
    setLasso(next);
    viewRef.current?.setLassoMode(next);
  };
  const onClear = () => {
    clearSelection();
    viewRef.current?.clearSelection();
    setLocalSel(0);
  };

  const label =
    stress > 0
      ? `STRESS: ${stress.toLocaleString()} points (synthetic)`
      : pick != null
        ? `amplitude scatter · picked spike #${pick}`
        : `amplitude scatter · ${visibleUnits.length} units`;

  const hasSel = selection != null && selection.n > 0;

  return (
    <div style={paneStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={fpsStyle}>{fps ? `${fps.toFixed(0)} fps` : ""}</div>
      <canvas ref={canvasRef} style={canvasStyle} />
      {/* Lasso capture layer: pointer-events toggled on only in lasso mode (see
          ScatterView.setLassoMode) so deck owns pan/zoom otherwise. */}
      <div ref={overlayRef}
        style={{ position: "absolute", inset: 0, zIndex: 1, cursor: "crosshair",
          pointerEvents: "none" }} />
      {stress <= 0 && (
        <div style={{ position: "absolute", bottom: 6, left: 8, zIndex: 2, display: "flex",
          gap: 8, alignItems: "center", fontSize: 11, color: "#9ab", userSelect: "none" }}>
          <button onClick={toggleLasso}
            title="drag to region-select spikes (then Split in the units panel)"
            style={{ fontSize: 11, padding: "2px 8px", borderRadius: 3, cursor: "pointer",
              background: lasso ? "#3a5566" : "#2a3340", color: lasso ? "#dff" : "#cde",
              border: `1px solid ${lasso ? "#6ea8ff" : "#3a4654"}` }}>
            {lasso ? "lasso ✓" : "lasso"}
          </button>
          {(hasSel || localSel > 0) && (
            <>
              <span style={{ color: "#dff", fontVariantNumeric: "tabular-nums" }}>
                {hasSel ? `${selection!.n.toLocaleString()} spikes` : `${localSel} sampled`}
                {hasSel && ` · ${Object.keys(selection!.per_unit).length} unit(s)`}
              </span>
              <span onClick={onClear} style={{ cursor: "pointer", color: "#9bd" }}
                title="clear selection">clear</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
