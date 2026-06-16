import { Meta, UnitId } from "../types";

export function UnitList(
  { meta, visibleUnits, setVisibleUnits }:
  { meta: Meta; visibleUnits: UnitId[]; setVisibleUnits: (u: UnitId[]) => void },
) {
  const visSet = new Set(visibleUnits.map(String));

  const toggle = (u: UnitId) => {
    const k = String(u);
    if (visSet.has(k)) setVisibleUnits(visibleUnits.filter((x) => String(x) !== k));
    else setVisibleUnits([...visibleUnits, u]);
  };

  return (
    <div style={{ height: "100%", overflow: "auto", background: "#161616" }}>
      <div style={{ padding: "6px 8px", color: "#9ab", position: "sticky", top: 0,
        background: "#161616", borderBottom: "1px solid #333" }}>
        units ({meta.num_units}) · {visibleUnits.length} visible
      </div>
      {meta.unit_ids.map((u) => {
        const c = meta.unit_colors[String(u)] ?? [150, 150, 150, 255];
        return (
          <label key={String(u)} style={{ display: "flex", gap: 7, alignItems: "center",
            padding: "2px 8px", cursor: "pointer" }}>
            <input type="checkbox" checked={visSet.has(String(u))} onChange={() => toggle(u)} />
            <span style={{ width: 11, height: 11, borderRadius: 2, flex: "0 0 auto",
              background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
            <span>unit {String(u)}</span>
          </label>
        );
      })}
    </div>
  );
}
