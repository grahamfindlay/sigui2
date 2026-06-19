import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DockviewReact, DockviewReadyEvent } from "dockview";
import { Sock } from "./socket";
import { CurationState, Meta, Selection, SelectionMsg, UnitId, ViewSettingValue } from "./types";
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

// Order-insensitive key for a visible-unit set. Used to suppress echoing a
// server-pushed visibility change straight back to the server (which would
// ping-pong between windows). Sorted so a mere reordering -- e.g. the server
// returning the same set in a different order -- never looks like a change.
const visKey = (u: UnitId[]) => u.map(String).sort().join(",");

export function App() {
  const sockRef = useRef<Sock | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [visibleUnits, setVisibleUnits] = useState<UnitId[]>([]);
  const [curation, setCuration] = useState<CurationState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selectionNonce, setSelectionNonce] = useState(0);
  const [pickedPoints, setPickedPoints] = useState<[number, number][]>([]);
  const [pickedIndices, setPickedIndices] = useState<number[]>([]);
  const [lassoPolygon, setLassoPolygon] = useState<[number, number][] | null>(null);
  // Per-view settings (F1): shared session values, keyed {view: {name: value}}.
  const [viewSettings, setViewSettings] = useState<Record<string, Record<string, ViewSettingValue>>>({});
  const [gpu] = useState(gpuInfo);
  // Key of the visible set we last sent to (or adopted from) the server. The
  // set_visible_units layout effect skips re-sending when it still matches,
  // which dedupes redundant sends and breaks the multi-window echo loop.
  const lastSentVisible = useRef<string | null>(null);

  useEffect(() => {
    const sock = new Sock(`ws://${location.host}/ws`);
    sockRef.current = sock;
    sock.on("metadata", (m: Meta) => {
      setMeta(m);
      setCuration(m.curation);
      // Adopt the current shared per-view settings (a late-joining window picks
      // up whatever the others have set).
      setViewSettings(m.view_settings ?? {});
      // Adopt the server's live shared visibility so a window opened later on a
      // second monitor inherits the current set instead of overriding it. Seed
      // the guard so this adoption doesn't immediately echo back as a send.
      lastSentVisible.current = visKey(m.default_visible_units);
      setVisibleUnits(m.default_visible_units);
    });
    // Curation mutations echo a fresh state; reflect it everywhere.
    sock.on("curation", (c: CurationState) => setCuration(c));
    // Shared scatter selection. The server broadcasts every selection change to
    // all windows with enough to redraw it: a region carries its world-space
    // polygon (redraw outline + white highlight), a pick carries the spikes'
    // world coords (yellow highlight), and "clear" wipes it. region/pick are
    // mutually exclusive, matching the single shared Controller selection.
    sock.on("selection", (s: SelectionMsg) => {
      if (s.kind === "spikes") {
        setSelection(null); setLassoPolygon(null);
        setPickedPoints(s.points ?? []); setPickedIndices(s.indices ?? []);
      } else if (s.kind === "clear") {
        setSelection(null); setLassoPolygon(null);
        setPickedPoints([]); setPickedIndices([]);
      } else { // region (or a plain summary)
        setSelection(s.n > 0 ? { n: s.n, per_unit: s.per_unit } : null);
        setLassoPolygon(s.polygon ?? null);
        setPickedPoints([]); setPickedIndices([]);
      }
    });
    // Authoritative visibility from the server (shared session). Fires both when
    // another window changes it AND to confirm our own change -- the Controller
    // may adjust the set (e.g. it caps the visible count), so we always adopt the
    // server's set. Pre-seed the guard so the layout effect treats it as
    // already-sent (no echo back), then setVisibleUnits is a no-op when it
    // already matches (order-insensitive key).
    sock.on("visible_units", (m: { unit_ids: UnitId[] }) => {
      lastSentVisible.current = visKey(m.unit_ids);
      setVisibleUnits(m.unit_ids);
    });
    // A per-view setting changed (this window's own change, re-affirmed, or
    // another window's). Adopt the authoritative per-view dict. No echo-guard is
    // needed: nothing re-sends on viewSettings state change (unlike visibility),
    // so adopting a broadcast can't loop -- only the explicit setter sends.
    sock.on("view_settings", (m: { view: string; settings: Record<string, ViewSettingValue> }) =>
      setViewSettings((prev) => ({ ...prev, [m.view]: m.settings })));
    sock.ready.then(() => sock.send({ type: "hello" }));
  }, []);

  const curate = (msg: unknown) => sockRef.current?.send(msg);
  // Change a per-view setting: send it to the server (which validates + echoes
  // the cleaned per-view dict to every window) and optimistically apply it
  // locally so the change feels instant. A scope="server" setting's re-fetch is
  // driven by the resulting viewSettings change in the owning pane.
  const setViewSetting = (view: string, name: string, value: ViewSettingValue) => {
    sockRef.current?.send({ type: "set_view_setting", view, name, value });
    setViewSettings((prev) => ({ ...prev, [view]: { ...(prev[view] ?? {}), [name]: value } }));
  };
  // Select explicit spikes on the server + drive the scatter pick-highlight by
  // their world coords (so it shows even for non-sampled spikes).
  const pickSpikes = (indices: number[], points: [number, number][]) => {
    sockRef.current?.send({ type: "select_spikes", indices, points });
    // optimistic; the broadcast re-affirms both (points + indices) everywhere
    setPickedPoints(points); setPickedIndices(indices);
  };
  // Clear the selection everywhere: tell the server to drop the (shared) spike
  // selection so it broadcasts a clear to all windows, and optimistically wipe
  // our own highlight. The nonce makes the scatter wipe the highlight it owns.
  const clearSelection = () => {
    sockRef.current?.send({ type: "clear_selection" });
    setSelection(null);
    setPickedPoints([]);
    setPickedIndices([]);
    setLassoPolygon(null);
    setSelectionNonce((n) => n + 1);
  };

  // Toggling visibility changes the working set, so any selection is now stale --
  // drop it (the scatter view clears its own highlight on re-render).
  useEffect(() => {
    setSelection(null); setPickedPoints([]); setPickedIndices([]); setLassoPolygon(null);
  }, [visibleUnits]);

  // Keep the server's Controller visibility in sync with the UI. Off the data
  // hot path now (views fetch their own per-unit deltas); kept so selection/
  // curation that read Controller.visible_unit_ids stay correct. Sent in a
  // LAYOUT effect so it precedes panels' passive-effect data fetches in the same
  // commit (child passive effects run before parent passive effects, but every
  // layout effect runs before every passive effect) -- the spikelist reads the
  // server's visible-spike set, so its window must be fetched against fresh
  // visibility, not the previous toggle.
  useLayoutEffect(() => {
    if (!meta || !sockRef.current) return;
    // Skip when this is the set we last sent or adopted (a server-pushed
    // visibility pre-seeds the key), so we neither resend redundantly nor bounce
    // a remote change back into the broadcast loop.
    const k = visKey(visibleUnits);
    if (k === lastSentVisible.current) return;
    lastSentVisible.current = k;
    sockRef.current.send({ type: "set_visible_units", unit_ids: visibleUnits });
  }, [visibleUnits, meta]);

  // Context value is rebuilt when state changes so panels see fresh state.
  const ctx = useMemo(
    () => (meta && curation && sockRef.current
      ? { sock: sockRef.current, meta, visibleUnits, setVisibleUnits, curation, curate,
          selection, clearSelection, selectionNonce, pickedPoints, pickedIndices, pickSpikes,
          lassoPolygon, viewSettings, setViewSetting }
      : null),
    [meta, visibleUnits, curation, selection, selectionNonce, pickedPoints, pickedIndices,
     lassoPolygon, viewSettings],
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
