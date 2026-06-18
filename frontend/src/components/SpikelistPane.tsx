// Spikelist: a virtualized, windowed table of the currently-visible spikes. The
// full set can be millions of rows, so the server holds the ordered index and
// ships only a window ([offset, offset+LIMIT)); as the user scrolls past the
// loaded edges we fetch the next window. Clicking a row selects that spike
// (round-trips to the Controller and highlights here + in the scatter).
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Sock } from "../socket";
import { Meta, Selection, SpikeRow, UnitId } from "../types";

const LIMIT = 500; // rows per fetched window
const EDGE = 60; // refetch when the viewport comes within this many rows of an edge

interface SpikelistMsg { type: "spikelist"; total: number; offset: number; rows: SpikeRow[]; }

export function SpikelistPane(
  { sock, meta, visibleUnits, selection, pickedPoints, pickSpikes }:
  {
    sock: Sock; meta: Meta; visibleUnits: UnitId[]; selection: Selection | null;
    pickedPoints: [number, number][];
    pickSpikes: (indices: number[], points: [number, number][]) => void;
  },
) {
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<SpikeRow[]>([]);
  const offsetRef = useRef(0);
  const rowsLenRef = useRef(0);
  const pendingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  offsetRef.current = offset;
  rowsLenRef.current = rows.length;

  const fetchWindow = (off: number) => {
    pendingRef.current = true;
    sock.send({ type: "spikelist_request", offset: Math.max(0, Math.floor(off)), limit: LIMIT });
  };

  useEffect(() => {
    sock.on("spikelist", (m: SpikelistMsg) => {
      pendingRef.current = false;
      setTotal(m.total);
      setOffset(m.offset);
      setRows(m.rows);
    });
    fetchWindow(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Visibility changes the underlying set; a selection/pick change flips the
  // `selected` flags. Re-pull the current window (offset 0 on a visibility change
  // since totals shift) so the table stays in sync both ways with the scatter.
  useEffect(() => { fetchWindow(0); /* eslint-disable-next-line */ }, [visibleUnits]);
  useEffect(() => { if (rowsLenRef.current) fetchWindow(offsetRef.current); /* eslint-disable-next-line */ }, [selection, pickedPoints]);

  const rowVirtualizer = useVirtualizer({
    count: total, getScrollElement: () => scrollRef.current,
    estimateSize: () => 20, overscan: 20,
  });
  const items = rowVirtualizer.getVirtualItems();

  // Slide the loaded window when the viewport nears an unloaded edge.
  useEffect(() => {
    if (!items.length || pendingRef.current) return;
    const first = items[0].index, last = items[items.length - 1].index;
    const loStart = offset, loEnd = offset + rows.length;
    if (first < loStart + EDGE && loStart > 0) fetchWindow(first - LIMIT / 2);
    else if (last > loEnd - EDGE && loEnd < total) fetchWindow(loStart + LIMIT / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, offset, rows.length, total]);

  // Selecting a row drives the shared pick state: it selects the spike on the
  // server (so this list re-highlights via the pickedPoints effect) and shows
  // it in the scatter at (t, amp) -- its true scatter coords.
  const onClick = (r: SpikeRow) => pickSpikes([r.i], [[r.t, r.amp ?? 0]]);

  const tmpl = "70px 60px 90px 90px 1fr";
  const cell: React.CSSProperties = {
    padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    display: "flex", alignItems: "center",
  };
  const numCell: React.CSSProperties = { ...cell, justifyContent: "flex-end", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", background: "#161616" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 8px",
        borderBottom: "1px solid #333", background: "#1b1b1b", fontSize: 11, color: "#9ab" }}>
        <span>{total.toLocaleString()} visible spikes</span>
        {selection != null && selection.n > 0 && (
          <span style={{ color: "#dff" }}>· {selection.n.toLocaleString()} selected</span>
        )}
      </div>
      <div ref={scrollRef} style={{ overflow: "auto", fontSize: 11, color: "#cdd" }}>
        <div style={{ display: "grid", gridTemplateColumns: tmpl, position: "sticky", top: 0,
          zIndex: 1, background: "#1b1b1b", borderBottom: "1px solid #333", height: 22,
          color: "#9ab", userSelect: "none" }}>
          <div style={cell}>spike</div>
          <div style={cell}>unit</div>
          <div style={numCell}>t (s)</div>
          <div style={numCell}>amp</div>
          <div style={cell}>sample</div>
        </div>
        <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
          {items.map((vi) => {
            const r = rows[vi.index - offset];
            const col = r ? (meta.unit_colors[String(r.unit)] ?? [150, 150, 150, 255]) : null;
            return (
              <div key={vi.index} onClick={() => r && onClick(r)}
                style={{ position: "absolute", top: 0, left: 0, width: "100%",
                  transform: `translateY(${vi.start}px)`, height: vi.size,
                  display: "grid", gridTemplateColumns: tmpl, cursor: r ? "pointer" : "default",
                  background: r?.selected ? "#33415a" : "transparent",
                  boxShadow: r?.selected ? "inset 3px 0 0 #6ea8ff" : undefined,
                  borderBottom: "1px solid #1f1f1f" }}>
                {r ? (
                  <>
                    <div style={cell}>#{r.i}</div>
                    <div style={{ ...cell, gap: 5 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 2, flex: "0 0 auto",
                        background: `rgb(${col![0]},${col![1]},${col![2]})` }} />
                      {String(r.unit)}
                    </div>
                    <div style={numCell}>{r.t.toFixed(4)}</div>
                    <div style={numCell}>{r.amp == null ? "–" : r.amp.toFixed(1)}</div>
                    <div style={cell}>{r.sample.toLocaleString()}</div>
                  </>
                ) : (
                  <div style={{ ...cell, color: "#555" }}>…</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
