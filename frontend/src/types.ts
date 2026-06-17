export type UnitId = string | number;

export interface Meta {
  num_units: number;
  num_channels: number;
  sampling_frequency: number;
  duration_s: number;
  num_samples: number;
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
