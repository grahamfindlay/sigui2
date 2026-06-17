// Shared app state for dockview panels. dockview renders each panel through a
// React portal that is still part of the React tree, so Context propagates into
// panels even though they are mounted imperatively (addPanel). Panels read
// sock/meta/visibility from here instead of receiving props from App.
import { createContext, useContext } from "react";
import { Sock } from "./socket";
import { CurationState, Meta, Selection, UnitId } from "./types";

export interface SiguiCtx {
  sock: Sock;
  meta: Meta;
  visibleUnits: UnitId[];
  setVisibleUnits: (u: UnitId[]) => void;
  curation: CurationState;
  curate: (msg: unknown) => void; // send a curation control message
  // Current scatter region selection (drives the split action + readout).
  selection: Selection | null;
  clearSelection: () => void; // drop the selection everywhere (also clears the lasso)
  selectionNonce: number; // bumps on clearSelection so the scatter wipes its highlight
}

export const SiguiContext = createContext<SiguiCtx | null>(null);

export function useSigui(): SiguiCtx {
  const c = useContext(SiguiContext);
  if (!c) throw new Error("useSigui must be used inside <SiguiContext.Provider>");
  return c;
}
