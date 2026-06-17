// Virtualized, sortable unit list — the curation control surface. Replaces the
// plain checkbox list so it scales to 100-500 units and exposes per-unit metrics
// (num_spikes, firing_rate, locations, quality metrics) for triage.
//
// TanStack Table owns sort state + the sorted row model; @tanstack/react-virtual
// renders only the visible rows. Layout is a CSS grid (shared template between
// header and body rows) so columns line up without a <table>.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColumnDef, SortingState, getCoreRowModel, getSortedRowModel, useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Meta, UnitId } from "../types";

interface Row {
  id: UnitId;
  metrics: Record<string, number | null>;
}

const prettify = (s: string) => s.replace(/_/g, " ");
const fmt = (v: number | null | undefined) =>
  v == null ? "–"
    : Number.isInteger(v) ? v.toLocaleString()
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
// Numeric ids sort numerically; fall back to string for non-numeric ids.
const unitSortKey = (id: UnitId) => {
  const n = Number(id);
  return Number.isFinite(n) ? n : String(id);
};

export function UnitTable(
  { meta, visibleUnits, setVisibleUnits }:
  { meta: Meta; visibleUnits: UnitId[]; setVisibleUnits: (u: UnitId[]) => void },
) {
  const visSet = useMemo(() => new Set(visibleUnits.map(String)), [visibleUnits]);
  const [sorting, setSorting] = useState<SortingState>([]);

  const data = useMemo<Row[]>(
    () => meta.unit_ids.map((id) => ({ id, metrics: meta.unit_metrics[String(id)] ?? {} })),
    [meta],
  );

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { id: "vis", enableSorting: false },
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
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 12,
  });

  const toggle = (id: UnitId) => {
    const k = String(id);
    if (visSet.has(k)) setVisibleUnits(visibleUnits.filter((x) => String(x) !== k));
    else setVisibleUnits([...visibleUnits, id]);
  };

  // Select-all / none header checkbox (indeterminate when partially visible).
  const allVisible = meta.unit_ids.length > 0 && visibleUnits.length === meta.unit_ids.length;
  const someVisible = visibleUnits.length > 0 && !allVisible;
  const allCbRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allCbRef.current) allCbRef.current.indeterminate = someVisible; }, [someVisible]);

  const tmpl = `28px 92px repeat(${meta.metric_columns.length}, minmax(58px, 1fr))`;
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
      {/* sticky header */}
      <div style={{ display: "grid", gridTemplateColumns: tmpl, position: "sticky", top: 0,
        zIndex: 1, background: "#1b1b1b", borderBottom: "1px solid #333", height: 24,
        color: "#9ab", userSelect: "none" }}>
        <div style={{ ...cell, justifyContent: "center" }}>
          <input ref={allCbRef} type="checkbox" checked={allVisible}
            onChange={() => setVisibleUnits(allVisible ? [] : meta.unit_ids.slice())}
            title="show all / none" />
        </div>
        <div style={{ ...cell, cursor: "pointer" }}
          onClick={() => table.getColumn("unit")?.toggleSorting()}>
          unit{sortDir("unit")}
        </div>
        {meta.metric_columns.map((c) => (
          <div key={c} style={{ ...numCell, cursor: "pointer" }} title={c}
            onClick={() => table.getColumn(c)?.toggleSorting()}>
            {prettify(c)}{sortDir(c)}
          </div>
        ))}
      </div>

      {/* virtualized body */}
      <div style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index].original;
          const k = String(row.id);
          const on = visSet.has(k);
          const col = meta.unit_colors[k] ?? [150, 150, 150, 255];
          return (
            <div key={k} style={{ position: "absolute", top: 0, left: 0, width: "100%",
              transform: `translateY(${vi.start}px)`, height: vi.size,
              display: "grid", gridTemplateColumns: tmpl,
              background: on ? "#1d2530" : "transparent", borderBottom: "1px solid #222" }}>
              <div style={{ ...cell, justifyContent: "center" }}>
                <input type="checkbox" checked={on} onChange={() => toggle(row.id)} />
              </div>
              <div style={{ ...cell, gap: 6, cursor: "pointer" }} onClick={() => toggle(row.id)}>
                <span style={{ width: 10, height: 10, borderRadius: 2, flex: "0 0 auto",
                  background: `rgb(${col[0]},${col[1]},${col[2]})` }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
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
