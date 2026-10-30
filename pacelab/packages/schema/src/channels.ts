/**
 * Channel keys and metadata. CONTRACT — see docs/CONTRACTS.md §2.
 *
 * Every channel is stored in SI-ish canonical units (listed in CHANNEL_META).
 * Importers (Track A) MUST convert to these units. Analytics (Track B) and the
 * UI (Track C) MUST NOT re-convert raw provider units.
 */

/** Channels an importer may write into `Activity.samples.channels`. */
export const RAW_CHANNEL_KEYS = [
  'heartRate', // bpm
  'speed', // m/s
  'distance', // m, cumulative from activity start
  'altitude', // m
  'lat', // degrees (WGS84)
  'lon', // degrees (WGS84)
  'cadence', // running: steps/min (both feet); cycling: rpm; swimming: strokes/min
  'power', // W
  'temperature', // °C
  'respirationRate', // breaths/min
  'stepLength', // m, distance between consecutive foot strikes — ONLY when device-measured
  'verticalOscillation', // m
  'groundContactTime', // s
  'verticalRatio', // %
  'gctBalance', // % left foot
] as const;
export type RawChannelKey = (typeof RAW_CHANNEL_KEYS)[number];

/**
 * Channels computed by @pacelab/analytics `prepare()` (Track B). Never written
 * by importers.
 *
 * Note: in a PreparedActivity, `stepLength` is measured when the device
 * provided it, otherwise derived as speed / (cadence / 60). PreparedActivity
 * .derived lists which channels were computed.
 */
export const DERIVED_CHANNEL_KEYS = [
  'pace', // s/km (running/walking/hiking)
  'pace100m', // s/100m (swimming)
  'gradePct', // %, smoothed elevation gradient
  'gapSpeed', // m/s, grade-adjusted speed (running)
  'efficiency', // running/swim: (m/min) per bpm; cycling with power: W per bpm
  'movingTime', // s, elapsed time minus pauses (monotonic, usable as an x-axis)
] as const;
export type DerivedChannelKey = (typeof DERIVED_CHANNEL_KEYS)[number];

export type ChannelKey = RawChannelKey | DerivedChannelKey;

export interface ChannelMeta {
  key: ChannelKey;
  label: string;
  unit: string;
  /** Suggested decimals for display. */
  decimals: number;
  /** True for DERIVED_CHANNEL_KEYS. */
  derived: boolean;
  /** For axis direction: pace is "lower is faster". */
  invertAxis?: boolean;
}

export const CHANNEL_META: Record<ChannelKey, ChannelMeta> = {
  heartRate: { key: 'heartRate', label: 'Heart rate', unit: 'bpm', decimals: 0, derived: false },
  speed: { key: 'speed', label: 'Speed', unit: 'm/s', decimals: 2, derived: false },
  distance: { key: 'distance', label: 'Distance', unit: 'm', decimals: 0, derived: false },
  altitude: { key: 'altitude', label: 'Elevation', unit: 'm', decimals: 1, derived: false },
  lat: { key: 'lat', label: 'Latitude', unit: '°', decimals: 6, derived: false },
  lon: { key: 'lon', label: 'Longitude', unit: '°', decimals: 6, derived: false },
  cadence: { key: 'cadence', label: 'Cadence', unit: 'spm | rpm | str/min', decimals: 0, derived: false },
  power: { key: 'power', label: 'Power', unit: 'W', decimals: 0, derived: false },
  temperature: { key: 'temperature', label: 'Temperature', unit: '°C', decimals: 0, derived: false },
  respirationRate: { key: 'respirationRate', label: 'Breathing rate', unit: 'br/min', decimals: 1, derived: false },
  stepLength: { key: 'stepLength', label: 'Stride length', unit: 'm', decimals: 2, derived: false },
  verticalOscillation: { key: 'verticalOscillation', label: 'Vertical oscillation', unit: 'm', decimals: 3, derived: false },
  groundContactTime: { key: 'groundContactTime', label: 'Ground contact time', unit: 's', decimals: 3, derived: false },
  verticalRatio: { key: 'verticalRatio', label: 'Vertical ratio', unit: '%', decimals: 1, derived: false },
  gctBalance: { key: 'gctBalance', label: 'GCT balance (L)', unit: '%', decimals: 1, derived: false },
  pace: { key: 'pace', label: 'Pace', unit: 's/km', decimals: 0, derived: true, invertAxis: true },
  pace100m: { key: 'pace100m', label: 'Pace /100m', unit: 's/100m', decimals: 0, derived: true, invertAxis: true },
  gradePct: { key: 'gradePct', label: 'Grade', unit: '%', decimals: 1, derived: true },
  gapSpeed: { key: 'gapSpeed', label: 'Grade-adjusted speed', unit: 'm/s', decimals: 2, derived: true },
  efficiency: { key: 'efficiency', label: 'Efficiency', unit: 'per bpm', decimals: 2, derived: true },
  movingTime: { key: 'movingTime', label: 'Moving time', unit: 's', decimals: 0, derived: true },
};
