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
}
