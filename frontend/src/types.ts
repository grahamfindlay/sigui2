export type UnitId = string | number;

// A per-view setting value + its declarative descriptor (F1). The server owns
// the catalog (server/view_settings.py); the client renders one control per
// descriptor and rounds changes back via a set_view_setting message.
export type ViewSettingValue = number | boolean | string;

// Shared segment + time-seek state (F3): the segment index and [t0, t1] second
// window the trace/tracemap views show. Broadcast to every window like
// visibility; mutated via a set_time_window message. Sample-derived seconds.
export interface TimeWindow {
  seg: number;
  t0: number;
  t1: number;
}

export interface ViewSettingDescriptor {
  name: string;
  label?: string;
  type: "bool" | "int" | "float" | "list";
  value: ViewSettingValue; // default
  // (min,max) for int/float; the allowed choices for "list"; null when absent.
  limits?: (number | string)[] | null;
  step?: number;
  // "client" -> a change only re-draws the existing frame; "server" -> it
  // re-shapes server-computed data, so the view must re-fetch.
  scope: "client" | "server";
}

export interface Meta {
  num_units: number;
  num_channels: number;
  sampling_frequency: number;
  duration_s: number;
  num_samples: number;
  // Segment navigation + time-seek (F3). duration_s/num_samples are seg-0;
  // seg_durations is the authoritative per-segment length list. time_window is
  // the current shared window a late-joining window adopts on connect.
  num_segments: number;
  seg_durations: number[];
  time_window: TimeWindow;
  unit_ids: UnitId[];
  unit_colors: Record<string, [number, number, number, number]>;
  default_visible_units: UnitId[];
  has_spike_amplitudes: boolean;
  // Unit-list table: ordered column names + per-unit values keyed by unit id.
  metric_columns: string[];
  unit_metrics: Record<string, Record<string, number | null>>;
  curation: CurationState;
  // Probe geometry + template shape (waveform view).
  channel_locations: [number, number][];
  nbefore: number;
  n_template_samples: number;
  template_abs_max: number;
  // Probe view + tracemap channel ordering.
  unit_positions: Record<string, [number, number]>; // unit id -> (x, y) on the probe
  probe_contours: [number, number][][]; // each probe's planar outline
  channel_order: number[]; // depth-ordered channel indices (tracemap rows)
  // Per-view settings (F1): the descriptor catalog (render the panels) + the
  // current shared values a late-joining window adopts on connect.
  view_settings_catalog: Record<string, ViewSettingDescriptor[]>;
  view_settings: Record<string, Record<string, ViewSettingValue>>;
  // Application-global settings (F2): a flat descriptor catalog + current values
  // (e.g. max_visible_units). Same descriptor shape as the per-view settings.
  main_settings_catalog: ViewSettingDescriptor[];
  main_settings: Record<string, ViewSettingValue>;
}

// One row of the spikelist window (server JSON, not a binary frame).
export interface SpikeRow {
  i: number; // global spike index
  unit: UnitId;
  seg: number;
  sample: number;
  t: number; // seconds
  amp: number | null;
  selected: boolean;
}

export interface LabelDefinition {
  label_options: string[];
  exclusive: boolean;
}

// Current spike selection summary (from a scatter lasso / region query). The
// server keeps the authoritative spike-index set; the client only needs counts
// to drive the UI (split target + readout) and highlights its own points locally.
export interface Selection {
  n: number;
  per_unit: Record<string, number>; // unit id -> selected-spike count
}

// A selection broadcast from the server (shared session). Carries the summary
// plus enough for every window to redraw the visual: the lasso polygon (region)
// or the picked spikes' world coords (spikes). kind "clear" wipes it.
export interface SelectionMsg extends Selection {
  kind?: "region" | "spikes" | "clear";
  polygon?: [number, number][];
  points?: [number, number][];
  indices?: number[]; // global spike indices of a pick (drives the "#N" readout)
}

// Manual-curation overlay (annotations; does not change unit_ids).
export interface CurationState {
  label_definitions: Record<string, LabelDefinition>;
  merges: UnitId[][];
  removed: UnitId[];
  splits: UnitId[];
  labels: Record<string, Record<string, string>>; // unit id -> {category: label}
  can_save: boolean;
  saved: boolean;
}
