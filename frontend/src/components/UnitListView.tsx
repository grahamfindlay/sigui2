// Units panel: a curation toolbar over the virtualized unit table. Selection
// (the curation target set) lives here; visibility lives in the table rows.
import { useMemo, useState } from "react";
import { useSigui } from "../SiguiContext";
import { UnitTable } from "./UnitTable";

function Btn(
  { onClick, disabled, title, children }:
  { onClick: () => void; disabled?: boolean; title?: string; children: React.ReactNode },
) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ fontSize: 11, padding: "2px 8px", borderRadius: 3, cursor: disabled ? "default" : "pointer",
        background: disabled ? "#222" : "#2a3340", color: disabled ? "#666" : "#cde",
        border: "1px solid #3a4654" }}>
      {children}
    </button>
  );
}

export function UnitListView() {
  const { meta, curation, curate, visibleUnits, setVisibleUnits } = useSigui();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sel = useMemo(() => [...selected], [selected]);

  const inMerge = (u: string) => curation.merges.some((g) => g.map(String).includes(u));
  const selectedInMerge = sel.some(inMerge);
  const selectedRemoved = sel.some((u) => curation.removed.map(String).includes(u));

  const act = (msg: object) => curate({ ...msg, unit_ids: sel });

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", background: "#161616" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center",
        padding: "5px 6px", borderBottom: "1px solid #333", background: "#1b1b1b" }}>
        <span style={{ fontSize: 11, color: selected.size ? "#9bd" : "#667", cursor: "pointer" }}
          onClick={() => setSelected(new Set())} title="clear selection">
          {selected.size} selected
        </span>
        <Btn onClick={() => act({ type: "merge_units" })} disabled={selected.size < 2}
          title="merge selected units">merge</Btn>
        <Btn onClick={() => act({ type: "unmerge_units" })} disabled={!selectedInMerge}
          title="remove selected from their merge group">unmerge</Btn>
        <Btn onClick={() => act({ type: "delete_units" })} disabled={selected.size < 1}
          title="mark selected as removed">delete</Btn>
        <Btn onClick={() => act({ type: "restore_units" })} disabled={!selectedRemoved}
          title="restore selected removed units">restore</Btn>
        {Object.entries(curation.label_definitions).map(([cat, def]) => (
          <select key={cat} value="" disabled={selected.size < 1}
            title={`label selected: ${cat}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v) act({ type: "label_units", category: cat, label: v === "__clear__" ? null : v });
            }}
            style={{ fontSize: 11, background: "#22282f", color: "#cde", border: "1px solid #3a4654",
              borderRadius: 3 }}>
            <option value="">{cat}…</option>
            {def.label_options.map((o) => <option key={o} value={o}>{o}</option>)}
            <option value="__clear__">(clear)</option>
          </select>
        ))}
        <span style={{ flex: 1 }} />
        <Btn onClick={() => curate({ type: "save_curation" })}
          disabled={!curation.can_save}
          title={curation.can_save ? "save curation to the analyzer" : "in-memory analyzer cannot be saved"}>
          {curation.saved ? "saved" : "save"}
        </Btn>
      </div>
      <UnitTable meta={meta} visibleUnits={visibleUnits} setVisibleUnits={setVisibleUnits}
        selected={selected} setSelected={setSelected} curation={curation} />
    </div>
  );
}
