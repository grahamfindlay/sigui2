// dockview panel registry + default layout.
//
// Each docked view is a tiny wrapper that pulls live state from SiguiContext and
// renders the existing pane component. The wrappers ignore IDockviewPanelProps;
// all their data comes from context, so they re-render when App's state (visible
// units, etc.) changes -- which props-via-addPanel would not do.
import { DockviewApi } from "dockview";
import { useSigui } from "./SiguiContext";
import { TracePane } from "./components/TracePane";
import { ScatterPane } from "./components/ScatterPane";
import { HeatmapPane } from "./components/HeatmapPane";
import { HistogramPane } from "./components/HistogramPane";
import { UnitList } from "./components/UnitList";

// Stress is a fixed GPU benchmark switch (?stress=N); read once at module load.
const STRESS = parseInt(new URLSearchParams(location.search).get("stress") || "0", 10);

function UnitsPanel() {
  const { meta, visibleUnits, setVisibleUnits } = useSigui();
  return <UnitList meta={meta} visibleUnits={visibleUnits} setVisibleUnits={setVisibleUnits} />;
}
function TracePanel() {
  const { sock, meta } = useSigui();
  return <TracePane sock={sock} meta={meta} />;
}
function ScatterPanel() {
  const { sock, meta, visibleUnits } = useSigui();
  return <ScatterPane sock={sock} meta={meta} visibleUnits={visibleUnits} stress={STRESS} />;
}
function HeatmapPanel() {
  const { sock } = useSigui();
  return <HeatmapPane sock={sock} />;
}
function IsiPanel() {
  const { sock, meta, visibleUnits } = useSigui();
  return (
    <HistogramPane sock={sock} meta={meta} visibleUnits={visibleUnits}
      requestType="isi_request" replyType="isi_frame" label="ISI" />
  );
}
function AcgPanel() {
  const { sock, meta, visibleUnits } = useSigui();
  return (
    <HistogramPane sock={sock} meta={meta} visibleUnits={visibleUnits}
      requestType="correlogram_request" replyType="correlogram_frame" label="auto-correlogram" />
  );
}

// Stable identity (defined once) -- dockview warns if `components` changes.
export const panelComponents = {
  units: UnitsPanel,
  trace: TracePanel,
  scatter: ScatterPanel,
  heatmap: HeatmapPanel,
  isi: IsiPanel,
  acg: AcgPanel,
};

// Default arrangement (user can drag/resize/float freely afterwards):
//   units | trace
//         | scatter | heatmap
//         | isi     | acg
export function buildDefaultLayout(api: DockviewApi): void {
  if (api.panels.length > 0) return; // idempotent guard

  const trace = api.addPanel({ id: "trace", component: "trace", title: "traces" });
  const units = api.addPanel({
    id: "units", component: "units", title: "units",
    position: { referencePanel: "trace", direction: "left" },
  });
  api.addPanel({
    id: "scatter", component: "scatter", title: "amplitude",
    position: { referencePanel: "trace", direction: "below" },
  });
  api.addPanel({
    id: "heatmap", component: "heatmap", title: "similarity",
    position: { referencePanel: "scatter", direction: "right" },
  });
  api.addPanel({
    id: "isi", component: "isi", title: "ISI",
    position: { referencePanel: "scatter", direction: "below" },
  });
  api.addPanel({
    id: "acg", component: "acg", title: "auto-correlogram",
    position: { referencePanel: "heatmap", direction: "below" },
  });

  // Narrow sidebar; modest trace band so the scatter/hist rows get the space.
  units.api.setSize({ width: 220 });
  trace.api.setSize({ height: 230 });
}
