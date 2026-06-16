import { useEffect, useRef } from "react";
import { Sock } from "../socket";
import { Meta, UnitId } from "../types";
import { HistogramGridView, RGB } from "../histogramGridView";
import { CachedUnitView } from "../unitCache";
import { DecodedFrame } from "../frame";
import { labelStyle, paneStyle, canvasStyle } from "./paneStyles";

// One unit's 1D histogram row (ISI or auto-correlogram counts), sliced out of a
// delta frame (zero-copy) and cached. Bin edges are frame-global, not per-unit.
interface HistUnit {
  row: Float32Array; // (n_bins) counts
}

function splitHistFrame(frame: DecodedFrame): Map<string, HistUnit> {
  const ids = (frame.header.unit_ids ?? []) as (string | number)[];
  const nBins = (frame.header.n_bins as number) ?? 0;
  const counts = frame.buffers.counts as Float32Array;
  const out = new Map<string, HistUnit>();
  ids.forEach((u, i) => out.set(String(u), { row: counts.subarray(i * nBins, (i + 1) * nBins) }));
  return out;
}

// Generic pane for per-unit 1D histograms (ISI, auto-correlogram). They share a
// frame shape (bin edges + per-unit count rows), so one component serves both,
// each with its own CachedUnitView.
export function HistogramPane(
  { sock, meta, visibleUnits, requestType, replyType, label, borderLeft }:
  {
    sock: Sock; meta: Meta; visibleUnits: UnitId[];
    requestType: string; replyType: string; label: string; borderLeft?: boolean;
  },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cvRef = useRef<CachedUnitView<HistUnit> | null>(null);

  useEffect(() => {
    const view = new HistogramGridView(canvasRef.current!);
    cvRef.current = new CachedUnitView<HistUnit>(
      sock,
      replyType,
      (missing) => ({ type: requestType, unit_ids: missing }),
      splitHistFrame,
      (visible, lastFrame) => {
        if (!lastFrame || visible.length === 0) {
          view.render(new Float32Array(0), new Float32Array(0), 0, 0, []);
          return;
        }
        const bins = lastFrame.buffers.bins as Float32Array;
        const nBins = lastFrame.header.n_bins as number;
        const counts = new Float32Array(visible.length * nBins);
        const colors: RGB[] = [];
        visible.forEach(({ unit, value }, i) => {
          counts.set(value.row, i * nBins);
          const c = meta.unit_colors[String(unit)] ?? [150, 150, 150, 255];
          colors.push([c[0], c[1], c[2]]);
        });
        view.render(bins, counts, visible.length, nBins, colors);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cvRef.current?.setVisible(visibleUnits);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleUnits]);

  return (
    <div style={{ ...paneStyle, borderTop: "1px solid #333", borderLeft: borderLeft ? "1px solid #333" : undefined }}>
      <div style={labelStyle}>{label}</div>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  );
}
