// One context-aware keybinding dispatcher for the whole app (foundation F4).
//
// Replaces the scattered per-view `window` keydown listeners -- formerly each
// amplitude view owned its own listener for the gain +/- keys. There is now a
// single installed window listener that matches the pressed key against a
// registry of bindings; a binding fires only when its `context` is "global" or
// equals the currently active pane. The active pane is set by whichever pane the
// pointer is over (see PaneFocus in panels.tsx), lifting the proven per-canvas
// hover model up to one shared signal.
//
// Both React components (via the `useKeybinding` hook) and the imperative view
// classes (via gainControl.attachGainKeys) register here, so there is exactly
// one keyboard entry point and one place that owns preventDefault.
//
// BROWSER-/OS-SAFE COMBO POLICY (the app runs in a browser, often on macOS, so
// `preventDefault` can't reclaim a key the OS swallows before the page sees it):
//   - AVOID Ctrl/Cmd + arrows -- macOS Mission Control (Ctrl+↑), App Exposé
//     (Ctrl+↓) and Spaces (Ctrl+←/→) grab these at the OS level. Use Alt+arrows.
//   - AVOID Ctrl/Cmd + letters -- browser/OS reserved (Cmd+D bookmark, Cmd+S
//     save, Cmd+R reload, Cmd+M minimize, Cmd+F find, ...). Prefer BARE letters
//     for pane-scoped actions (safe because typing surfaces are guarded below;
//     matches upstream's bare c/g/m/n label keys).
//   - AVOID Alt + letters expressed via `e.key` -- on macOS Option composes a
//     special char (Option+d -> "∂"), so the combo won't match. If a modifier
//     letter is unavoidable, switch that combo to `e.code` (layout-independent).
//   - A Linux/headless test harness does NOT reproduce macOS OS-level key
//     interception, so it can pass on combos that are dead on a real Mac.
import { useEffect, useRef } from "react";

export type KeyContext = string; // "global" or a dockview pane id

export interface Binding {
  combo: string; // canonical combo, e.g. "alt+arrowup", "+", "space"
  context: KeyContext; // "global" (always live) or a pane id (live when active)
  run: (e: KeyboardEvent) => void;
  when?: () => boolean; // optional extra gate (e.g. a future curation flag)
  label?: string; // human description, for a possible help legend later
}

let activeContext: KeyContext | null = null;
const bindings = new Set<Binding>();

// Set by the pane the pointer is over. A pane-scoped binding is live only while
// its pane id is the active context.
export function setActiveContext(ctx: KeyContext | null): void {
  activeContext = ctx;
}

const keyName = (e: KeyboardEvent) => (e.key === " " ? "space" : e.key.toLowerCase());

// Canonical combo for an event. Ctrl and Meta are unified to "ctrl" so Cmd works
// on macOS. Shift is folded in only for NAMED keys (ArrowUp, etc.) -- for a
// printable character Shift is already encoded in the character ("+" IS shift+"="),
// so folding it in would make the legacy gain keys ("+", "=", "-", "_") unmatchable.
export function comboOf(e: KeyboardEvent): string {
  const isNamedKey = e.key.length > 1; // " " is length 1 -> treated as printable
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (isNamedKey && e.shiftKey) mods.push("shift");
  return [...mods, keyName(e)].join("+");
}

export function register(b: Binding): () => void {
  bindings.add(b);
  return () => { bindings.delete(b); };
}

function onKeyDown(e: KeyboardEvent): void {
  const combo = comboOf(e);
  const t = e.target as HTMLElement | null;
  if (t) {
    const tag = t.tagName;
    // Never hijack a typing surface.
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
    // A focused button activates on Space/Enter; don't ALSO fire those bindings
    // (would double-act). Other keys (+/-/arrows) over a focused button are fine.
    if (tag === "BUTTON" && (combo === "space" || combo === "enter")) return;
  }
  // Most specific wins: a binding scoped to the active context beats a "global"
  // one with the same combo.
  let chosen: Binding | null = null;
  for (const b of bindings) {
    if (b.combo !== combo) continue;
    if (b.context !== "global" && b.context !== activeContext) continue;
    if (b.when && !b.when()) continue;
    if (!chosen || (chosen.context === "global" && b.context !== "global")) chosen = b;
  }
  if (chosen) {
    e.preventDefault();
    chosen.run(e);
  }
}

window.addEventListener("keydown", onKeyDown);

export interface KeybindingOpts {
  context?: KeyContext;
  when?: () => boolean;
  enabled?: boolean;
  label?: string;
}

// React-side registration. Keeps the latest handler/when in refs so the binding
// registration stays stable (no re-register churn) while always seeing fresh
// component state -- important when used inside a frequently re-rendering view
// like the virtualized unit table.
export function useKeybinding(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts: KeybindingOpts = {},
): void {
  const { context = "global", when, enabled = true, label } = opts;
  const handlerRef = useRef(handler);
  const whenRef = useRef(when);
  handlerRef.current = handler;
  whenRef.current = when;
  useEffect(() => {
    if (!enabled) return;
    return register({
      combo, context, label,
      run: (e) => handlerRef.current(e),
      when: () => (whenRef.current ? whenRef.current() : true),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combo, context, enabled, label]);
}
