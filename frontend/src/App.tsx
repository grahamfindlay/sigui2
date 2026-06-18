import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DockviewReact, DockviewReadyEvent } from "dockview";
import { Sock } from "./socket";
import { CurationState, Meta, Selection, UnitId } from "./types";
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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectionNonce, setSelectionNonce] = useState(0);
  const [pickedPoints, setPickedPoints] = useState<[number, number][]>([]);
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
    // A scatter lasso (select_region) echoes the exact selection summary.
    sock.on("selection", (s: Selection) => setSelection(s));
    sock.ready.then(() => sock.send({ type: "hello" }));
  }, []);

  const curate = (msg: unknown) => sockRef.current?.send(msg);
  // Select explicit spikes on the server + drive the scatter pick-highlight by
  // their world coords (so it shows even for non-sampled spikes).
  const pickSpikes = (indices: number[], points: [number, number][]) => {
    sockRef.current?.send({ type: "select_spikes", indices });
    setPickedPoints(points);
  };
  // Clear the selection everywhere; the nonce makes the scatter wipe its lasso
  // highlight (which it owns) without a back-reference from here.
  const clearSelection = () => {
    setSelection(null);
    setPickedPoints([]);
    setSelectionNonce((n) => n + 1);
  };

  // Toggling visibility changes the working set, so any selection is now stale --
  // drop it (the scatter view clears its own highlight on re-render).
  useEffect(() => { setSelection(null); setPickedPoints([]); }, [visibleUnits]);

  // Keep the server's Controller visibility in sync with the UI. Off the data
  // hot path now (views fetch their own per-unit deltas); kept so selection/
  // curation that read Controller.visible_unit_ids stay correct. Sent in a
  // LAYOUT effect so it precedes panels' passive-effect data fetches in the same
  // commit (child passive effects run before parent passive effects, but every
  // layout effect runs before every passive effect) -- the spikelist reads the
  // server's visible-spike set, so its window must be fetched against fresh
  // visibility, not the previous toggle.
  useLayoutEffect(() => {
    if (meta && sockRef.current) {
      sockRef.current.send({ type: "set_visible_units", unit_ids: visibleUnits });
    }
  }, [visibleUnits, meta]);

  // Context value is rebuilt when state changes so panels see fresh state.
  const ctx = useMemo(
    () => (meta && curation && sockRef.current
      ? { sock: sockRef.current, meta, visibleUnits, setVisibleUnits, curation, curate,
          selection, clearSelection, selectionNonce, pickedPoints, pickSpikes }
      : null),
    [meta, visibleUnits, curation, selection, selectionNonce, pickedPoints],
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
