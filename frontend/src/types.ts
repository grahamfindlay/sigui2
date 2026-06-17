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
}
