// dockview panel registry + default layout.
//
// Each docked view is a tiny wrapper that pulls live state from SiguiContext and
// renders the existing pane component. The wrappers ignore IDockviewPanelProps;
// all their data comes from context, so they re-render when App's state (visible
// units, etc.) changes -- which props-via-addPanel would not do.
import { DockviewApi } from "dockview";
import { useSigui } from "./SiguiContext";
import { TracePane } from "./components/TracePane";
import { TracemapPane } from "./components/TracemapPane";
import { ScatterPane } from "./components/ScatterPane";
import { HeatmapPane } from "./components/HeatmapPane";
import { HistogramPane } from "./components/HistogramPane";
import { WaveformPane } from "./components/WaveformPane";
import { ProbePane } from "./components/ProbePane";
import { SpikelistPane } from "./components/SpikelistPane";
import { UnitListView } from "./components/UnitListView";

// Stress is a fixed GPU benchmark switch (?stress=N); read once at module load.
const STRESS = parseInt(new URLSearchParams(location.search).get("stress") || "0", 10);

function UnitsPanel() {
  return <UnitListView />;
}
function TracePanel() {
  const { sock, meta } = useSigui();
  return <TracePane sock={sock} meta={meta} />;
}
function TracemapPanel() {
  const { sock, meta } = useSigui();
  return <TracemapPane sock={sock} meta={meta} />;
}
function ProbePanel() {
  const { meta, visibleUnits } = useSigui();
  return <ProbePane meta={meta} visibleUnits={visibleUnits} />;
}
function SpikelistPanel() {
  const { sock, meta, visibleUnits, selection, pickedPoints, pickSpikes } = useSigui();
  return <SpikelistPane sock={sock} meta={meta} visibleUnits={visibleUnits}
    selection={selection} pickedPoints={pickedPoints} pickSpikes={pickSpikes} />;
}
function ScatterPanel() {
  const { sock, meta, visibleUnits } = useSigui();
  return <ScatterPane sock={sock} meta={meta} visibleUnits={visibleUnits} stress={STRESS} />;
}
function HeatmapPanel() {
  const { sock } = useSigui();
  return <HeatmapPane sock={sock} />;
}
function WaveformPanel() {
  const { sock, meta, visibleUnits } = useSigui();
  return <WaveformPane sock={sock} meta={meta} visibleUnits={visibleUnits} />;
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
  tracemap: TracemapPanel,
  scatter: ScatterPanel,
  heatmap: HeatmapPanel,
  waveform: WaveformPanel,
  probe: ProbePanel,
  spikelist: SpikelistPanel,
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
    id: "waveform", component: "waveform", title: "waveforms",
    position: { referencePanel: "heatmap", direction: "right" },
  });
  api.addPanel({
    id: "isi", component: "isi", title: "ISI",
    position: { referencePanel: "scatter", direction: "below" },
  });
  api.addPanel({
    id: "acg", component: "acg", title: "auto-correlogram",
    position: { referencePanel: "heatmap", direction: "below" },
  });

  // The remaining views ride as tabs on existing groups to keep the default
  // arrangement uncluttered: tracemap with traces, probe with waveforms,
  // spikelist with the unit list. The user can drag any of them out.
  api.addPanel({
    id: "tracemap", component: "tracemap", title: "tracemap",
    position: { referencePanel: "trace", direction: "within" },
  });
  api.addPanel({
    id: "probe", component: "probe", title: "probe",
    position: { referencePanel: "waveform", direction: "within" },
  });
  api.addPanel({
    id: "spikelist", component: "spikelist", title: "spikes",
    position: { referencePanel: "units", direction: "within" },
  });
  // Leave the original tab active in each group so the default looks unchanged.
  api.getPanel("trace")?.api.setActive();
  api.getPanel("waveform")?.api.setActive();
  api.getPanel("units")?.api.setActive();

  // Narrow sidebar; modest trace band so the scatter/hist rows get the space.
  units.api.setSize({ width: 220 });
  trace.api.setSize({ height: 230 });
}
