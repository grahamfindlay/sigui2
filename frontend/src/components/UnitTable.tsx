// Virtualized, sortable unit list — the curation triage surface. Two independent
// per-row notions:
//   * VISIBILITY (checkbox) — whether the unit is plotted in the deck.gl views.
//   * SELECTION (row click) — the target set for curation actions in the toolbar.
// The table also renders the curation overlay: a label badge, a strikethrough for
// removed units, and a merge-group badge.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColumnDef, SortingState, getCoreRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CurationState, Meta, UnitId } from "../types";
import { useKeybinding } from "../keybindings";

interface Row {
  id: UnitId;
  metrics: Record<string, number | null>;
}

const prettify = (s: string) => s.replace(/_/g, " ");
const fmt = (v: number | null | undefined) =>
  v == null ? "–"
    : Number.isInteger(v) ? v.toLocaleString()
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
const unitSortKey = (id: UnitId) => {
  const n = Number(id);
  return Number.isFinite(n) ? n : String(id);
};

const LABEL_COLORS: Record<string, string> = {
  good: "#2e7d32", MUA: "#9a7d0a", noise: "#a3333d",
};

export function UnitTable(
  { meta, visibleUnits, setVisibleUnits, selected, setSelected, curation }:
  {
    meta: Meta; visibleUnits: UnitId[]; setVisibleUnits: (u: UnitId[]) => void;
    selected: Set<string>; setSelected: (s: Set<string>) => void; curation: CurationState;
  },
) {
  const visSet = useMemo(() => new Set(visibleUnits.map(String)), [visibleUnits]);
  const removedSet = useMemo(() => new Set(curation.removed.map(String)), [curation.removed]);
  const splitSet = useMemo(() => new Set(curation.splits.map(String)), [curation.splits]);
  const mergeOf = useMemo(() => {
    const m = new Map<string, number>();
    curation.merges.forEach((grp, i) => grp.forEach((u) => m.set(String(u), i)));
    return m;
  }, [curation.merges]);
  // Primary (first) label category drives the label column.
  const labelCat = Object.keys(curation.label_definitions)[0];
  const labelOf = (u: string) => (labelCat ? curation.labels[u]?.[labelCat] : undefined);

  const [sorting, setSorting] = useState<SortingState>([]);
  const data = useMemo<Row[]>(
    () => meta.unit_ids.map((id) => ({ id, metrics: meta.unit_metrics[String(id)] ?? {} })),
    [meta],
  );
  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { id: "unit", accessorFn: (r) => unitSortKey(r.id) },
    ...meta.metric_columns.map((c) => ({
      id: c,
      accessorFn: (r: Row) => r.metrics[c] ?? undefined,
      sortUndefined: "last" as const,
    })),
  ], [meta.metric_columns]);

  const table = useReactTable({
    data, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length, getScrollElement: () => scrollRef.current,
    estimateSize: () => 22, overscan: 12,
  });

  const toggleVisible = (id: UnitId) => {
    const k = String(id);
    if (visSet.has(k)) setVisibleUnits(visibleUnits.filter((x) => String(x) !== k));
    else setVisibleUnits([...visibleUnits, id]);
  };

  // Row-click selection (anchor enables shift-range over the *sorted* order).
  const anchorRef = useRef(-1);
  const onRowClick = (e: React.MouseEvent, idx: number, id: UnitId) => {
    const k = String(id);
    if (e.shiftKey && anchorRef.current >= 0) {
      const lo = Math.min(anchorRef.current, idx), hi = Math.max(anchorRef.current, idx);
      const next = new Set(selected);
      for (let i = lo; i <= hi; i++) next.add(String(rows[i].original.id));
      setSelected(next);
    } else if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      next.has(k) ? next.delete(k) : next.add(k);
      setSelected(next);
      anchorRef.current = idx;
    } else {
      setSelected(new Set([k]));
      anchorRef.current = idx;
    }
  };

  // Alt+↑/↓ (when the units pane is active): step to the prev/next unit in the
  // current sorted order and show it ALONE -- mirrors upstream's "visible-alone"
  // nav (set_visible_unit_ids([id])). "Current" = the sole visible unit if
  // exactly one is visible, else the single selected unit, else first/last.
  // NB: upstream (Qt) uses Ctrl+↑/↓, but Ctrl+arrows are macOS Mission Control /
  // App Exposé / Spaces -- grabbed by the OS before the browser sees them. Alt is
  // browser- and OS-safe (and arrows, unlike letters, aren't composed by Option).
  const stepUnit = (dir: 1 | -1) => {
    if (rows.length === 0) return;
    const indexOfId = (k: string) => rows.findIndex((r) => String(r.original.id) === k);
    let cur = -1;
    if (visibleUnits.length === 1) cur = indexOfId(String(visibleUnits[0]));
    else if (selected.size === 1) cur = indexOfId([...selected][0]);
    const next = cur === -1
      ? (dir === 1 ? 0 : rows.length - 1)
      : Math.min(rows.length - 1, Math.max(0, cur + dir));
    const nid = rows[next].original.id;
    setVisibleUnits([nid]);
    setSelected(new Set([String(nid)]));
    anchorRef.current = next;
    rowVirtualizer.scrollToIndex(next, { align: "auto" });
  };
  useKeybinding("alt+arrowdown", () => stepUnit(1),
    { context: "units", label: "next unit (shown alone)" });
  useKeybinding("alt+arrowup", () => stepUnit(-1),
    { context: "units", label: "previous unit (shown alone)" });

  const allVisible = meta.unit_ids.length > 0 && visibleUnits.length === meta.unit_ids.length;
  const someVisible = visibleUnits.length > 0 && !allVisible;
  const allCbRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allCbRef.current) allCbRef.current.indeterminate = someVisible; }, [someVisible]);

  const tmpl = `28px 108px 60px repeat(${meta.metric_columns.length}, minmax(58px, 1fr))`;
  const sortDir = (id: string) => {
    const s = table.getColumn(id)?.getIsSorted();
    return s === "asc" ? " ▲" : s === "desc" ? " ▼" : "";
  };
  const cell: React.CSSProperties = {
    padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    display: "flex", alignItems: "center",
  };
  const numCell: React.CSSProperties = { ...cell, justifyContent: "flex-end", fontVariantNumeric: "tabular-nums" };

  return (
    <div ref={scrollRef} style={{ height: "100%", overflow: "auto", background: "#161616",
      fontSize: 11, color: "#cdd" }}>
      <div style={{ display: "grid", gridTemplateColumns: tmpl, position: "sticky", top: 0,
        zIndex: 1, background: "#1b1b1b", borderBottom: "1px solid #333", height: 24,
        color: "#9ab", userSelect: "none" }}>
        <div style={{ ...cell, justifyContent: "center" }}>
          <input ref={allCbRef} type="checkbox" checked={allVisible}
            onChange={() => setVisibleUnits(allVisible ? [] : meta.unit_ids.slice())}
            title="show all / none" />
        </div>
        <div style={{ ...cell, cursor: "pointer" }} onClick={() => table.getColumn("unit")?.toggleSorting()}>
          unit{sortDir("unit")}
        </div>
        <div style={cell}>{labelCat ?? "label"}</div>
        {meta.metric_columns.map((c) => (
          <div key={c} style={{ ...numCell, cursor: "pointer" }} title={c}
            onClick={() => table.getColumn(c)?.toggleSorting()}>
            {prettify(c)}{sortDir(c)}
          </div>
        ))}
      </div>

      <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index].original;
          const k = String(row.id);
          const on = visSet.has(k);
          const sel = selected.has(k);
          const removed = removedSet.has(k);
          const grp = mergeOf.get(k);
          const col = meta.unit_colors[k] ?? [150, 150, 150, 255];
          const label = labelOf(k);
          return (
            <div key={k} onClick={(e) => onRowClick(e, vi.index, row.id)}
              style={{ position: "absolute", top: 0, left: 0, width: "100%",
                transform: `translateY(${vi.start}px)`, height: vi.size,
                display: "grid", gridTemplateColumns: tmpl, cursor: "pointer",
                background: sel ? "#33415a" : on ? "#1b222c" : "transparent",
                boxShadow: sel ? "inset 3px 0 0 #6ea8ff" : undefined,
                opacity: removed ? 0.5 : 1, borderBottom: "1px solid #222" }}>
              <div style={{ ...cell, justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={on} onChange={() => toggleVisible(row.id)}
                  title="visible in plots" />
              </div>
              <div style={{ ...cell, gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, flex: "0 0 auto",
                  background: `rgb(${col[0]},${col[1]},${col[2]})` }} />
                <span style={{ textDecoration: removed ? "line-through" : undefined,
                  overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
                {grp !== undefined && (
                  <span title={`merge group: ${curation.merges[grp].join(", ")}`}
                    style={{ flex: "0 0 auto", fontSize: 9, color: "#9bd", border: "1px solid #467",
                      borderRadius: 3, padding: "0 3px" }}>⧉{grp + 1}</span>
                )}
                {splitSet.has(k) && (
                  <span title="has a pending split (lassoed spikes)"
                    style={{ flex: "0 0 auto", fontSize: 9, color: "#fc9", border: "1px solid #764",
                      borderRadius: 3, padding: "0 3px" }}>✂</span>
                )}
              </div>
              <div style={cell}>
                {label && (
                  <span style={{ background: LABEL_COLORS[label] ?? "#555", color: "#fff",
                    borderRadius: 3, padding: "0 5px", fontSize: 10 }}>{label}</span>
                )}
              </div>
              {meta.metric_columns.map((c) => (
                <div key={c} style={numCell}>{fmt(row.metrics[c])}</div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
