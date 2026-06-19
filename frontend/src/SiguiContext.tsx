// Shared app state for dockview panels. dockview renders each panel through a
// React portal that is still part of the React tree, so Context propagates into
// panels even though they are mounted imperatively (addPanel). Panels read
// sock/meta/visibility from here instead of receiving props from App.
import { createContext, useContext } from "react";
import { Sock } from "./socket";
import { CurationState, Meta, Selection, UnitId, ViewSettingValue } from "./types";

export interface SiguiCtx {
  sock: Sock;
  meta: Meta;
  visibleUnits: UnitId[];
  setVisibleUnits: (u: UnitId[]) => void;
  curation: CurationState;
  curate: (msg: unknown) => void; // send a curation control message
  // Per-view settings (F1): current shared values + a setter that rounds the
  // change through the server (which validates + broadcasts to every window).
  // The descriptor catalog lives on `meta.view_settings_catalog`.
  viewSettings: Record<string, Record<string, ViewSettingValue>>;
  setViewSetting: (view: string, name: string, value: ViewSettingValue) => void;
  // Application-global settings (F2): current shared values + a setter, same
  // round-trip as the per-view ones. Catalog lives on `meta.main_settings_catalog`.
  mainSettings: Record<string, ViewSettingValue>;
  setMainSetting: (name: string, value: ViewSettingValue) => void;
  // Current scatter region selection (drives the split action + readout).
  selection: Selection | null;
  clearSelection: () => void; // drop the selection everywhere (server + all windows)
  selectionNonce: number; // bumps on clearSelection so the scatter wipes its highlight
  // Individually picked spikes (single click or spikelist row): world coords for
  // the scatter pick-highlight + the action that selects them on the server.
  pickedPoints: [number, number][];
  pickSpikes: (indices: number[], points: [number, number][]) => void;
  // Global indices of the picked spikes (parallel to pickedPoints), shared so
  // every window's "picked spike #N" readout matches the highlight it shows.
  pickedIndices: number[];
  // Shared lasso polygon (world coords) broadcast from whichever window drew it,
  // so every window redraws the same outline + white highlight. null = no lasso.
  lassoPolygon: [number, number][] | null;
}

export const SiguiContext = createContext<SiguiCtx | null>(null);

export function useSigui(): SiguiCtx {
  const c = useContext(SiguiContext);
  if (!c) throw new Error("useSigui must be used inside <SiguiContext.Provider>");
  return c;
}
