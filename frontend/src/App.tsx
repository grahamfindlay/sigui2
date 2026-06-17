import { useEffect, useMemo, useRef, useState } from "react";
import { DockviewReact, DockviewReadyEvent } from "dockview";
import { Sock } from "./socket";
import { CurationState, Meta, UnitId } from "./types";
import { SiguiContext } from "./SiguiContext";
import { panelComponents, buildDefaultLayout } from "./panels";

// Report the actual WebGL renderer. "SwiftShader"/"llvmpipe" means software
// rendering (e.g. a remote desktop on a headless host) -- fps would be bogus.
function gpuInfo(): string {
  const c = document.createElement("canvas");
  const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
  if (!gl) return "no WebGL";
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "renderer hidden");
}

export function App() {
  const sockRef = useRef<Sock | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [visibleUnits, setVisibleUnits] = useState<UnitId[]>([]);
  const [curation, setCuration] = useState<CurationState | null>(null);
  const [gpu] = useState(gpuInfo);

  useEffect(() => {
    const sock = new Sock(`ws://${location.host}/ws`);
    sockRef.current = sock;
    sock.on("metadata", (m: Meta) => {
      setMeta(m);
      setCuration(m.curation);
      setVisibleUnits(m.unit_ids.slice(0, Math.min(8, m.unit_ids.length)));
    });
    // Curation mutations echo a fresh state; reflect it everywhere.
    sock.on("curation", (c: CurationState) => setCuration(c));
    sock.ready.then(() => sock.send({ type: "hello" }));
  }, []);

  const curate = (msg: unknown) => sockRef.current?.send(msg);

  // Keep the server's Controller visibility in sync with the UI. Off the data
  // hot path now (views fetch their own per-unit deltas); kept so selection/
  // curation that read Controller.visible_unit_ids stay correct.
  useEffect(() => {
    if (meta && sockRef.current) {
      sockRef.current.send({ type: "set_visible_units", unit_ids: visibleUnits });
    }
  }, [visibleUnits, meta]);

  // Context value is rebuilt when state changes so panels see fresh state.
  const ctx = useMemo(
    () => (meta && curation && sockRef.current
      ? { sock: sockRef.current, meta, visibleUnits, setVisibleUnits, curation, curate }
      : null),
    [meta, visibleUnits, curation],
  );

  if (!ctx || !meta) return <div style={{ padding: 12 }}>connecting…</div>;

  const onReady = (event: DockviewReadyEvent) => buildDefaultLayout(event.api);

  return (
    <div style={{ display: "grid", gridTemplateRows: "26px 1fr", height: "100vh" }}>
      <div style={{ display: "flex", gap: 18, alignItems: "center", padding: "0 10px",
        background: "#1b1b1b", borderBottom: "1px solid #333" }}>
        <strong>sigui2</strong>
        <span style={{ color: "#9ab" }}>GPU: {gpu}</span>
        <span style={{ color: "#9ab" }}>
          {meta.num_units} units · {meta.num_channels} ch · {meta.duration_s.toFixed(0)}s
        </span>
      </div>
      <div style={{ minHeight: 0 }}>
        <SiguiContext.Provider value={ctx}>
          <DockviewReact
            components={panelComponents}
            onReady={onReady}
            className="dockview-theme-abyss"
          />
        </SiguiContext.Provider>
      </div>
    </div>
  );
}
