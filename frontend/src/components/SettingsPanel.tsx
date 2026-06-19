// Reusable settings popovers. Two entry points share one descriptor renderer:
//   <ViewSettings view="scatter" />  -- per-view (F1): a gear in a pane corner,
//     reading `meta.view_settings_catalog[view]`; changes round-trip through
//     `setViewSetting` and the pane reacts to the resulting `viewSettings` change.
//   <MainSettings />                 -- application-global (F2): a gear in the top
//     toolbar, reading `meta.main_settings_catalog`; changes round-trip through
//     `setMainSetting`. The server applies the global reaction (e.g. trimming
//     visibility for max_visible_units) and broadcasts to every window.
// Both are view/setting-agnostic: later phases add settings by extending the
// server catalog only -- no UI change here.
import { CSSProperties, useState } from "react";
import { useSigui } from "../SiguiContext";
import { ViewSettingDescriptor, ViewSettingValue } from "../types";
import { gearStyle } from "./paneStyles";

// Shared popover chrome (visuals minus positioning); each placement adds its own.
const popoverBase: CSSProperties = {
  background: "#1b222c", border: "1px solid #3a4654", borderRadius: 4,
  padding: "6px 10px", minWidth: 190, boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
  fontSize: 11, color: "#cde", userSelect: "none",
};
// Per-view popover: anchored to the pane's top-right (the pane is position:relative).
const panelStyle: CSSProperties = { ...popoverBase, position: "absolute", top: 28, right: 6, zIndex: 5 };
// Toolbar popover: drops down from its gear (wrapped in a position:relative span).
const toolbarPanelStyle: CSSProperties = {
  ...popoverBase, position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 10,
};
// Toolbar gear: same look as the pane gear but in normal flow, not absolute.
const toolbarGearStyle: CSSProperties = {
  width: 20, height: 20, padding: 0, lineHeight: "18px", textAlign: "center",
  fontSize: 12, cursor: "pointer",
  background: "#2a3340", color: "#cde", border: "1px solid #3a4654", borderRadius: 3,
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

// One labelled control row per descriptor; shared by both popovers.
function SettingsRows(
  { descriptors, values, set }:
  {
    descriptors: ViewSettingDescriptor[];
    values: Record<string, ViewSettingValue>;
    set: (name: string, value: ViewSettingValue) => void;
  },
) {
  return (
    <>
      {descriptors.map((d) => (
        <div key={d.name} style={rowStyle}>
          <span>{d.label ?? d.name}</span>
          <Control d={d} value={values[d.name] ?? d.value} set={(v) => set(d.name, v)} />
        </div>
      ))}
    </>
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
          <SettingsRows
            descriptors={descriptors} values={values}
            set={(name, v) => setViewSetting(view, name, v)}
          />
        </div>
      )}
    </>
  );
}

export function MainSettings() {
  const { meta, mainSettings, setMainSetting } = useSigui();
  const [open, setOpen] = useState(false);
  const descriptors = meta.main_settings_catalog ?? [];
  if (descriptors.length === 0) return null; // no globals -> no gear
  return (
    // position:relative so the dropdown anchors to the gear, not the toolbar.
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button title="settings" style={toolbarGearStyle} onClick={() => setOpen((o) => !o)}>⚙</button>
      {open && (
        <div style={toolbarPanelStyle} onPointerDown={(e) => e.stopPropagation()}>
          <SettingsRows
            descriptors={descriptors} values={mainSettings}
            set={(name, v) => setMainSetting(name, v)}
          />
        </div>
      )}
    </div>
  );
}
