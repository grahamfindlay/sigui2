// Reusable per-view settings popover (F1 foundation). Drop `<ViewSettings
// view="scatter" />` into any pane: it renders a gear button and, when open, one
// control per descriptor declared for that view in `meta.view_settings_catalog`.
// Changes round-trip through `setViewSetting` (server validates + broadcasts to
// every window); the pane reacts to the resulting `viewSettings` change (a
// client-scope setting re-draws, a server-scope one re-fetches).
//
// This component is intentionally view-agnostic: later phases add settings to
// other views by extending the server catalog only -- no UI change here.
import { CSSProperties, useState } from "react";
import { useSigui } from "../SiguiContext";
import { ViewSettingDescriptor, ViewSettingValue } from "../types";
import { gearStyle } from "./paneStyles";

const panelStyle: CSSProperties = {
  position: "absolute", top: 28, right: 6, zIndex: 5,
  background: "#1b222c", border: "1px solid #3a4654", borderRadius: 4,
  padding: "6px 10px", minWidth: 190, boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
  fontSize: 11, color: "#cde", userSelect: "none",
};
const rowStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 12, padding: "3px 0",
};
const inputStyle: CSSProperties = {
  width: 84, background: "#2a3340", color: "#cde", border: "1px solid #3a4654",
  borderRadius: 3, padding: "1px 4px", fontSize: 11,
};

function Control(
  { d, value, set }:
  { d: ViewSettingDescriptor; value: ViewSettingValue; set: (v: ViewSettingValue) => void },
) {
  if (d.type === "bool") {
    return <input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} />;
  }
  if (d.type === "list") {
    return (
      <select style={inputStyle} value={String(value)} onChange={(e) => set(e.target.value)}>
        {(d.limits ?? []).map((o) => (
          <option key={String(o)} value={String(o)}>{String(o)}</option>
        ))}
      </select>
    );
  }
  // int | float -> number input bounded by limits (the server clamps too).
  const lim = (d.limits as number[] | null | undefined) ?? undefined;
  return (
    <input
      type="number" style={inputStyle} value={Number(value)}
      min={lim?.[0]} max={lim?.[1]} step={d.step ?? (d.type === "int" ? 1 : 0.1)}
      onChange={(e) => {
        const v = d.type === "int" ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
        if (!Number.isNaN(v)) set(v);
      }}
    />
  );
}

export function ViewSettings({ view }: { view: string }) {
  const { meta, viewSettings, setViewSetting } = useSigui();
  const [open, setOpen] = useState(false);
  const descriptors = meta.view_settings_catalog?.[view] ?? [];
  if (descriptors.length === 0) return null; // no settings -> no gear
  const values = viewSettings[view] ?? {};
  return (
    <>
      <button title="view settings" style={gearStyle} onClick={() => setOpen((o) => !o)}>⚙</button>
      {open && (
        // Swallow pointer events so interacting with the panel never reaches the
        // canvas/lasso overlay beneath it.
        <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
          {descriptors.map((d) => (
            <div key={d.name} style={rowStyle}>
              <span>{d.label ?? d.name}</span>
              <Control
                d={d}
                value={values[d.name] ?? d.value}
                set={(v) => setViewSetting(view, d.name, v)}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
