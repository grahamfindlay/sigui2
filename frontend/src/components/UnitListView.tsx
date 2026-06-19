// Units panel: a curation toolbar over the virtualized unit table. Selection
// (the curation target set) lives here; visibility lives in the table rows.
import { useMemo, useState } from "react";
import { useSigui } from "../SiguiContext";
import { useKeybinding } from "../keybindings";
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

// The default quality label set. C3's label hotkeys bind to whichever category
// carries exactly these options -- looked up from label_definitions, NOT
// hardcoded to the name "quality" (mirrors upstream has_default_quality_labels).
const QUALITY_OPTIONS = new Set(["good", "noise", "MUA"]);

export function UnitListView() {
  const { meta, curation, curate, visibleUnits, setVisibleUnits,
    selection, clearSelection } = useSigui();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sel = useMemo(() => [...selected], [selected]);

  const inMerge = (u: string) => curation.merges.some((g) => g.map(String).includes(u));
  const selectedInMerge = sel.some(inMerge);
  const selectedRemoved = sel.some((u) => curation.removed.map(String).includes(u));
  const splitSet = new Set(curation.splits.map(String));
  const selectedSplit = sel.some((u) => splitSet.has(u));
  const regionN = selection?.n ?? 0;
  // The category whose options are the default quality set (good/noise/MUA), if
  // any; C3's c/g/m/n bind to it. undefined => those keys are inert.
  const qualityCat = Object.entries(curation.label_definitions).find(
    ([, def]) => def.label_options.length === 3 && def.label_options.every((o) => QUALITY_OPTIONS.has(o)),
  )?.[0];

  const act = (msg: object) => curate({ ...msg, unit_ids: sel });
  // Split uses the server-side region selection (lasso on the scatter), not the
  // row selection: it splits every unit the lassoed spikes belong to.
  const doSplit = () => { curate({ type: "split_units" }); clearSelection(); };

  // Space (when the units pane is active): make the selected units the visible
  // set -- mirrors upstream's Space ("set visible_unit_ids to selected"). The
  // server cap (max_visible_units) still applies. The first proof binding on the
  // F4 keybinding dispatcher; curation/label hotkeys (C2/C3) plug in the same way.
  useKeybinding("space", () => { if (sel.length) setVisibleUnits(sel); },
    { context: "units", label: "show selected units only" });

  // C2 curation hotkeys + C3 quality-label hotkeys (units pane active). Each
  // fires the SAME handler as its toolbar button and is gated by the SAME
  // predicate, so a key is a no-op exactly when the button is disabled. Bare
  // letters (browser-/OS-safe per the F4 policy -- the dispatcher guards typing
  // surfaces). Upstream's Ctrl+D/M/R/U/X is browser-reserved and its bare m=MUA
  // collides with merge, so merge takes a fresh key (e); labels keep c/g/m/n.
  useKeybinding("d", () => act({ type: "delete_units" }),
    { context: "units", when: () => sel.length >= 1, label: "delete selected" });
  useKeybinding("e", () => act({ type: "merge_units" }),
    { context: "units", when: () => sel.length >= 2, label: "merge selected" });
  useKeybinding("r", () => act({ type: "restore_units" }),
    { context: "units", when: () => selectedRemoved, label: "restore selected" });
  useKeybinding("u", () => act({ type: "unmerge_units" }),
    { context: "units", when: () => selectedInMerge, label: "unmerge selected" });
  useKeybinding("x", () => act({ type: "unsplit_units" }),
    { context: "units", when: () => selectedSplit, label: "unsplit selected" });
  // Labels apply to qualityCat (looked up above). The `when` already requires
  // qualityCat, so `run` only fires when it's defined (the `if` also narrows the
  // type for `category: string`).
  useKeybinding("c", () => { if (qualityCat) act({ type: "label_units", category: qualityCat, label: null }); },
    { context: "units", when: () => sel.length >= 1 && !!qualityCat, label: "clear quality label" });
  useKeybinding("g", () => { if (qualityCat) act({ type: "label_units", category: qualityCat, label: "good" }); },
    { context: "units", when: () => sel.length >= 1 && !!qualityCat, label: "label good" });
  useKeybinding("m", () => { if (qualityCat) act({ type: "label_units", category: qualityCat, label: "MUA" }); },
    { context: "units", when: () => sel.length >= 1 && !!qualityCat, label: "label MUA" });
  useKeybinding("n", () => { if (qualityCat) act({ type: "label_units", category: qualityCat, label: "noise" }); },
    { context: "units", when: () => sel.length >= 1 && !!qualityCat, label: "label noise" });

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", background: "#161616" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center",
        padding: "5px 6px", borderBottom: "1px solid #333", background: "#1b1b1b" }}>
        <span style={{ fontSize: 11, color: selected.size ? "#9bd" : "#667", cursor: "pointer" }}
          onClick={() => setSelected(new Set())} title="clear selection">
          {selected.size} selected
        </span>
        <Btn onClick={() => act({ type: "merge_units" })} disabled={selected.size < 2}
          title="merge selected units (e)">merge</Btn>
        <Btn onClick={() => act({ type: "unmerge_units" })} disabled={!selectedInMerge}
          title="remove selected from their merge group (u)">unmerge</Btn>
        <Btn onClick={() => act({ type: "delete_units" })} disabled={selected.size < 1}
          title="mark selected as removed (d)">delete</Btn>
        <Btn onClick={() => act({ type: "restore_units" })} disabled={!selectedRemoved}
          title="restore selected removed units (r)">restore</Btn>
        <Btn onClick={doSplit} disabled={regionN < 1}
          title={regionN >= 1
            ? `split ${regionN} lassoed spike(s) off their unit(s)`
            : "lasso spikes on the amplitude scatter first"}>
          split{regionN ? ` (${regionN})` : ""}
        </Btn>
        <Btn onClick={() => act({ type: "unsplit_units" })} disabled={!selectedSplit}
          title="undo the split on selected units (x)">unsplit</Btn>
        {Object.entries(curation.label_definitions).map(([cat, def]) => (
          <select key={cat} value="" disabled={selected.size < 1}
            title={cat === qualityCat ? `label selected: ${cat}  (c/g/m/n)` : `label selected: ${cat}`}
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
