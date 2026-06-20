// Segment navigation + time-seek control (F3), mounted in the top toolbar. It
// drives the shared {seg,t0,t1} window (SiguiContext.emitTimeWindow); the
// trace/tracemap views seek to it and also write it back here when panned, so the
// scrollbar handle tracks a mouse drag. All seeks preserve the current window
// WIDTH (an explicit window-size control is roadmap T1) -- a seek only moves the
// window, it never resizes it.
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useSigui } from "../SiguiContext";

const inputStyle: CSSProperties = {
  background: "#2a3340", color: "#cde", border: "1px solid #3a4654",
  borderRadius: 3, padding: "1px 4px", fontSize: 11,
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function TimeNav() {
  const { meta, timeWindow, emitTimeWindow } = useSigui();
  const nSeg = meta.num_segments ?? 1;
  const seg = timeWindow.seg;
  const segDur = (s: number) => meta.seg_durations?.[s] ?? meta.duration_s;
  const dur = Math.max(1e-6, segDur(seg));
  const width = Math.max(1e-6, timeWindow.t1 - timeWindow.t0);

  // Move to a (segment, start), preserving the current width clamped into the
  // target segment. The server re-clamps too, but doing it here keeps the
  // controlled inputs honest before the round-trip lands.
  const goTo = (s: number, start: number) => {
    const d = Math.max(1e-6, segDur(s));
    const w = Math.min(width, d);
    const t0 = clamp(start, 0, d - w);
    emitTimeWindow({ seg: s, t0, t1: t0 + w });
  };

  // "Go to time" box: typed digits stay buffered (a local string) so typing
  // doesn't seek per keystroke (commit on Enter/blur); re-syncs whenever the
  // window changes. The ↑/↓ arrow keys instead step the trace IMMEDIATELY, paging
  // by exactly one window forward/back (handled below, bypassing the browser's
  // grid-snapping); the spinner buttons step immediately too (native step `w`,
  // grid-snapped) via the native `change` event. A ref carries the latest commit
  // so the imperatively-attached listener never goes stale.
  const [startStr, setStartStr] = useState(timeWindow.t0.toFixed(2));
  useEffect(() => setStartStr(timeWindow.t0.toFixed(2)), [timeWindow]);
  const startRef = useRef<HTMLInputElement>(null);
  const commitBoxRef = useRef<() => void>(() => {});
  commitBoxRef.current = () => {
    const el = startRef.current;
    if (!el) return;
    const v = parseFloat(el.value);
    if (!Number.isNaN(v)) goTo(seg, v);
  };
  useEffect(() => {
    const el = startRef.current;
    if (!el) return;
    const onCommit = () => commitBoxRef.current();
    el.addEventListener("change", onCommit);
    return () => el.removeEventListener("change", onCommit);
  }, []);

  // Scrollbar: seek only when the value is RELEASED, not on every intermediate
  // step of a drag. React's onChange maps to the continuous `input` event (one
  // seek per step -> the trace crawls to the target); the native `change` event
  // fires once on release. So `drag` tracks the handle live (no emit) and the
  // native-change listener commits the final position. A ref carries the latest
  // goTo so the imperatively-attached listener never goes stale or re-subscribes.
  const [drag, setDrag] = useState<number | null>(null);
  const commitRef = useRef<(v: number) => void>(() => {});
  commitRef.current = (v: number) => { goTo(seg, v); setDrag(null); };
  const rangeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = rangeRef.current;
    if (!el) return;
    const onCommit = () => commitRef.current(parseFloat(el.value));
    el.addEventListener("change", onCommit);
    return () => el.removeEventListener("change", onCommit);
  }, []);

  const w = Math.min(width, dur);
  const maxStart = Math.max(0, dur - w);
  const step = Math.max(dur / 1000, 1e-4);

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{ display: "flex", alignItems: "center", gap: 6, color: "#9ab", fontSize: 11 }}
    >
      {nSeg > 1 && (
        <select
          title="segment" style={inputStyle} value={seg}
          onChange={(e) => goTo(parseInt(e.target.value, 10), 0)}
        >
          {Array.from({ length: nSeg }, (_, i) => (
            <option key={i} value={i}>seg {i}</option>
          ))}
        </select>
      )}
      <input
        ref={rangeRef}
        type="range" title="seek (window start)" min={0} max={maxStart} step={step}
        // While dragging, `drag` moves the handle live; the window only seeks on
        // release (native `change`). When not dragging, follow the shared window
        // (so a trace pan moves the handle too).
        value={drag ?? Math.min(timeWindow.t0, maxStart)}
        onChange={(e) => setDrag(parseFloat(e.target.value))}
        style={{ width: 200 }}
      />
      <input
        ref={startRef}
        type="number" title="go to time (s) — ↑/↓ step one window; type + Enter to jump"
        min={0} max={dur} step={w}
        value={startStr}
        onChange={(e) => setStartStr(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commitBoxRef.current(); return; }
          // Page by exactly ONE window per arrow press. preventDefault stops the
          // browser's own step-snapping (which would land on a ragged grid
          // multiple); we step the window itself so it's clean + immediate.
          if (e.key === "ArrowUp") { e.preventDefault(); goTo(seg, timeWindow.t0 + width); }
          else if (e.key === "ArrowDown") { e.preventDefault(); goTo(seg, timeWindow.t0 - width); }
        }}
        style={{ ...inputStyle, width: 70 }}
      />
      <span style={{ whiteSpace: "nowrap" }}>
        {timeWindow.t0.toFixed(1)}–{timeWindow.t1.toFixed(1)} / {dur.toFixed(0)}s
      </span>
    </div>
  );
}
