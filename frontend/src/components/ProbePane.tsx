import { useEffect, useMemo, useRef } from "react";
import { Meta, UnitId } from "../types";
import { ProbeView, ProbeUnit, RGB } from "../probeView";
import { labelStyle, paneStyle, canvasStyle } from "./paneStyles";

export function ProbePane(
  { meta, visibleUnits }: { meta: Meta; visibleUnits: UnitId[] },
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ProbeView | null>(null);

  // Probe geometry is static; build it once from metadata.
  const geom = useMemo(() => {
    const units: ProbeUnit[] = meta.unit_ids.map((id) => {
      const p = meta.unit_positions[String(id)] ?? [0, 0];
      const c = meta.unit_colors[String(id)] ?? [150, 150, 150, 255];
      return { id: String(id), x: p[0], y: p[1], color: [c[0], c[1], c[2]] as RGB };
    });
    return { contacts: meta.channel_locations, contours: meta.probe_contours, units };
  }, [meta]);

  useEffect(() => {
    const view = new ProbeView(canvasRef.current!, geom);
    viewRef.current = view;
    view.render(new Set(visibleUnits.map(String)));
    return () => { view.dispose(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.render(new Set(visibleUnits.map(String)));
  }, [visibleUnits]);

  return (
    <div style={{ ...paneStyle, borderLeft: "1px solid #333" }}>
      <div style={labelStyle}>probe · {visibleUnits.length} units shown</div>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  );
}
