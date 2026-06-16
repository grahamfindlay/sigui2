// Shared app state for dockview panels. dockview renders each panel through a
// React portal that is still part of the React tree, so Context propagates into
// panels even though they are mounted imperatively (addPanel). Panels read
// sock/meta/visibility from here instead of receiving props from App.
import { createContext, useContext } from "react";
import { Sock } from "./socket";
import { Meta, UnitId } from "./types";

export interface SiguiCtx {
  sock: Sock;
  meta: Meta;
  visibleUnits: UnitId[];
  setVisibleUnits: (u: UnitId[]) => void;
}

export const SiguiContext = createContext<SiguiCtx | null>(null);

export function useSigui(): SiguiCtx {
  const c = useContext(SiguiContext);
  if (!c) throw new Error("useSigui must be used inside <SiguiContext.Provider>");
  return c;
}
