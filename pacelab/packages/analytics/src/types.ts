/**
 * @pacelab/analytics public types. CONTRACT between Track B (implements) and
 * Track C (renders). See docs/CONTRACTS.md §7.2. All times are seconds on the
 * activity's elapsed clock (same as Activity.samples.t) unless noted.
 */
import type { Activity, ActivitySummary, AthleteSettings, ChannelKey, DailyWellness, Sport } from '@pacelab/schema';

// ---------------------------------------------------------------- prepare

export interface PrepareOptions {
  /** Resample interval in seconds. Default 1. */
  resampleS?: number;
  /** Gaps longer than this (s) are NOT interpolated; values stay null. Default 10. */
  maxInterpolateGapS?: number;
}

/**
 * Activity resampled onto a uniform grid with derived channels added.
 * Every series has length `t.length`. Samples inside pauses are null in all
 * channels except distance/movingTime (held flat) so charts show gaps.
 */
export interface PreparedActivity {
  activity: Activity;
  /** Uniform grid: t[i] = i * resampleS, from 0 to max(elapsedTimeS, last raw sample t). */
  t: number[];
  resampleS: number;
  series: Partial<Record<ChannelKey, (number | null)[]>>;
  /** true where the timer was paused. */
  paused: boolean[];
  /** Channels that were computed rather than recorded (includes stepLength when not device-measured). */
  derived: ChannelKey[];
  /** Channels with at least one non-null value, raw + derived, in CHANNEL_META order. */
  available: ChannelKey[];
}

// ---------------------------------------------------------------- smoothing

export type Smoothing =
  | { kind: 'none' }
  | { kind: 'movingAverage'; windowS: number }
  | { kind: 'ewma'; halfLifeS: number }
  | { kind: 'median'; windowS: number };

// ---------------------------------------------------------------- windows & stats

export interface TimeWindow {
  startT: number;
  endT: number;
  label?: string;
}

export interface ChannelStats {
  n: number;
  /** Fraction of the window's non-paused seconds that had a value (0–1). */
  coverage: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  std: number | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Least-squares slope per minute within the window (trend inside the window). */
  slopePerMin: number | null;
}

export interface DriftResult {
  /** Output per HR in first vs second half of moving time in the window. */
  firstHalfRatio: number;
  secondHalfRatio: number;
  /** (first - second) / first * 100. Positive = HR drifted up relative to output. <5% is generally considered well-coupled. */
  decouplingPct: number;
  /** 'speed' for run/swim, 'power' for cycling when power exists. */
  basis: 'speed' | 'gapSpeed' | 'power';
}

export interface WindowStats {
  window: TimeWindow;
  elapsedS: number;
  movingS: number;
  distanceM: number | null;
  channels: Partial<Record<ChannelKey, ChannelStats>>;
  /** Seconds in HR zones 1..5 (index 0 = Z1). Empty if no HR or no settings. */
  hrZoneS: number[];
  drift: DriftResult | null;
  /** Cycling only, when power exists. */
  power?: { normalizedW: number; intensityFactor: number | null; tss: number | null };
  /** Swimming only. */
  swim?: { lengths: number; avgSwolf: number | null; avgStrokesPerLength: number | null };
}

// ---------------------------------------------------------------- segments

export type SegmentKind = 'laps' | 'splitsKm' | 'splitsMile' | 'intervals' | 'hrZones' | 'hills' | 'swimLengths' | 'halves';

export interface Segment extends TimeWindow {
  kind: SegmentKind;
  /** e.g. "Lap 3", "km 5", "Interval 2", "Z4", "Climb 1". */
  label: string;
  /** Only for 'intervals': work vs recovery. Only for 'hrZones': zone 1..5. */
  role?: 'work' | 'recovery' | 'warmup' | 'cooldown';
  zone?: number;
}

// ---------------------------------------------------------------- relationships

export interface ScatterPoint {
  x: number;
  y: number;
  /** Optional colour value (third channel). */
  c?: number;
  /** Source activity + time, so the UI can link back. */
  activityId: string;
  t: number;
  /** Index of the window/group this point belongs to (for per-segment colouring). */
  group: number;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

export interface Relationship {
  x: ChannelKey;
  y: ChannelKey;
  c?: ChannelKey;
  points: ScatterPoint[];
  /** One fit per group, plus overall at key -1. */
  fits: Record<number, LinearFit | null>;
  /** Pearson r overall. */
  r: number | null;
}

export interface RelationshipInput {
  activity: PreparedActivity;
  /** Points are only taken from inside these windows (whole activity if omitted). Each window = one group. */
  windows?: TimeWindow[];
}

export interface RelationshipOptions {
  /** Average into buckets of this many seconds before plotting (reduces noise). Default 5. */
  bucketS?: number;
  smoothing?: Smoothing;
  /** Drop points where speed < this (m/s) to exclude standing/walking. Default 1.5 for running, 0 otherwise. */
  minSpeed?: number;
}

// ---------------------------------------------------------------- overlay

export interface Overlay {
  /** Shared x axis (seconds of moving time, or metres). */
  x: number[];
  by: 'movingTime' | 'distance';
  channel: ChannelKey;
  series: { activityId: string; label: string; values: (number | null)[] }[];
}

// ---------------------------------------------------------------- load, readiness, trends

export interface ActivityLoad {
  activityId: string;
  /** ISO date (local) the activity counts toward. */
  date: string;
  /** Banister TRIMP if HR present, else duration-based estimate. */
  load: number;
  method: 'trimp' | 'tss' | 'duration';
}

export interface LoadPoint {
  date: string;
  load: number;
  /** Acute (7-day EWMA) / chronic (42-day EWMA) training load and form = chronic - acute. */
  atl: number;
  ctl: number;
  tsb: number;
}

export interface ReadinessComponent {
  key: 'hrv' | 'restingHr' | 'sleepDuration' | 'sleepEfficiency' | 'trainingForm';
  label: string;
  value: number | null;
  /** Rolling personal baseline (mean of previous 28 days). */
  baseline: number | null;
  /** Standardised deviation, sign-corrected so positive = better. */
  z: number | null;
  weight: number;
  /** Points added to / removed from 50. */
  contribution: number;
}

export interface Readiness {
  date: string;
  /** 0–100, 50 = personal normal. null if not enough data. */
  score: number | null;
  components: ReadinessComponent[];
  /** 'low' when fewer than 14 days of baseline. */
  confidence: 'low' | 'medium' | 'high';
  /** The provider's own score for comparison, if present. */
  providerScore: number | null;
}

export interface PerformancePoint {
  activityId: string;
  date: string;
  sport: Sport;
  /** Efficiency (EF) of the activity's steady part. */
  efficiency: number | null;
  decouplingPct: number | null;
  /** Readiness on the morning of the activity. */
  readiness: number | null;
}

export interface Correlation {
  x: string;
  y: string;
  r: number | null;
  n: number;
  /** Plain-English, hedged ("weak positive, n=23"). */
  description: string;
}

// ---------------------------------------------------------------- suggestions

export interface Suggestion {
  id: string;
  sport: Sport;
  severity: 'info' | 'tip' | 'flag';
  title: string;
  detail: string;
  /** Numbers that triggered the rule, shown under the suggestion. */
  evidence: { label: string; value: string; window?: TimeWindow }[];
  /** How sure the rule is, given data quality (coverage, derived vs measured channels). */
  confidence: 'low' | 'medium' | 'high';
}

export interface SuggestionContext {
  settings: AthleteSettings;
  /** Recent activities of the same sport, newest first, for comparisons. */
  history?: PreparedActivity[];
}

export type { Activity, ActivitySummary, AthleteSettings, ChannelKey, DailyWellness, Sport };
