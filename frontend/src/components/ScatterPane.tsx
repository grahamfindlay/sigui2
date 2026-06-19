import { useEffect, useRef, useState } from "react";
import { Sock } from "../socket";
import { Meta, UnitId } from "../types";
import { ScatterView } from "../scatterView";
import { CachedUnitView } from "../unitCache";
import { DecodedFrame } from "../frame";
import { useSigui } from "../SiguiContext";
import { ViewSettings } from "./SettingsPanel";
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
  const maxSpikesRef = useRef<number | undefined>(undefined);
  const [fps, setFps] = useState(0);
  const [lasso, setLasso] = useState(false);
  const [localSel, setLocalSel] = useState(0);
  const { selection, selectionNonce, clearSelection, pickedPoints, pickedIndices, pickSpikes, lassoPolygon, viewSettings } = useSigui();

  useEffect(() => {
    const view = new ScatterView(canvasRef.current!, overlayRef.current!, {
      onFps: setFps,
      onPick: (gi, point) => pickSpikes([gi], [point]),
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
      return () => view.dispose();
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
    return () => { view.dispose(); viewRef.current = null; };
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

  // Shared lasso (this window's own or another window's): redraw the outline +
  // white highlight from the broadcast world-space polygon. Runs on mount too,
  // so re-showing the scatter tab restores the current shared selection.
  useEffect(() => {
    viewRef.current?.showLasso(lassoPolygon);
  }, [lassoPolygon]);

  // Client-scope setting: point size only repaints the existing working set.
  // Runs on mount too, so a window opened late adopts the current shared size.
  useEffect(() => {
    const px = viewSettings.scatter?.scatter_size;
    if (typeof px === "number") viewRef.current?.setPointSize(px);
  }, [viewSettings.scatter?.scatter_size]);

  // Server-scope setting: max spikes/unit changes the server-side decimation, so
  // drop the per-unit cache and re-fetch the visible units. Skip the initial
  // value (the first fetch already used the server's current cap); only react to
  // an actual change, here or in another window.
  useEffect(() => {
    if (stress > 0) return;
    const cap = viewSettings.scatter?.max_spikes_per_unit;
    if (typeof cap !== "number") return;
    if (maxSpikesRef.current !== undefined && maxSpikesRef.current !== cap) {
      cvRef.current?.invalidateAll();
      cvRef.current?.setVisible(visRef.current);
    }
    maxSpikesRef.current = cap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSettings.scatter?.max_spikes_per_unit]);

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
      : pickedIndices.length === 1
        ? `amplitude scatter · picked spike #${pickedIndices[0]}`
        : pickedIndices.length > 1
          ? `amplitude scatter · ${pickedIndices.length} spikes picked`
          : `amplitude scatter · ${visibleUnits.length} units`;

  const hasSel = selection != null && selection.n > 0;

  return (
    <div style={paneStyle}>
      <div style={labelStyle}>{label}</div>
      {/* fps sits left of the settings gear (top-right) so they don't overlap. */}
      <div style={{ ...fpsStyle, right: 32 }}>{fps ? `${fps.toFixed(0)} fps` : ""}</div>
      {stress <= 0 && <ViewSettings view="scatter" />}
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
