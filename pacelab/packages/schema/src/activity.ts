/**
 * Canonical activity model. CONTRACT — see docs/CONTRACTS.md §1–§3.
 * Mirrored in C# by sync/src/Pacelab.Canonical/Models.cs and validated by
 * packages/schema/json-schema/activity.schema.json. Change all three together.
 */
import type { RawChannelKey } from './channels.js';

export const SCHEMA_VERSION = 1 as const;

export type Sport = 'running' | 'cycling' | 'swimming' | 'walking' | 'hiking' | 'other';

/** Where a record came from. Open string so new providers don't need a contract change. */
export type Provider = 'garmin' | 'oura' | 'file' | (string & {});

export interface SourceRef {
  provider: Provider;
  /** Provider's own id (Garmin activityId, Oura document id). Absent for dropped files. */
  providerId?: string;
  /** Original format the data was decoded from. */
  format: 'fit' | 'gpx' | 'tcx' | 'json';
  /** Human-readable device, e.g. "Garmin fenix6". */
  device?: string;
  /** ISO-8601 UTC timestamp of import. */
  importedAt: string;
}

export interface ActivitySummary {
  /**
   * Stable id. API imports: `${provider}:${providerId}` (e.g. "garmin:24645966519").
   * Dropped files: `file:` + first 16 hex chars of SHA-256 of the file bytes.
   */
  id: string;
  schemaVersion: typeof SCHEMA_VERSION;
  sport: Sport;
  /** Free text, lower_snake_case, e.g. "generic", "trail", "treadmill", "lap_swimming", "open_water", "indoor_cycling". */
  subSport: string;
  name?: string;
  /** ISO-8601 UTC, e.g. "2026-01-15T12:00:00Z". */
  startTime: string;
  /** Local offset from UTC in minutes at start (e.g. -240 for EDT). */
  timezoneOffsetMin?: number;
  /** Wall-clock seconds from start to end, including pauses. */
  elapsedTimeS: number;
  /** Timer seconds, excluding pauses. */
  movingTimeS: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  ascentM?: number;
  descentM?: number;
  calories?: number;
  /** Pool length for pool swims, metres. */
  poolLengthM?: number;
  hasGps: boolean;
  /** Raw channels that contain at least one non-null value. */
  channels: RawChannelKey[];
  source: SourceRef;
}

export interface Samples {
  /**
   * Seconds since `startTime` (wall clock, so pauses show up as gaps).
   * Strictly increasing. May be irregular (Garmin "smart recording").
   */
  t: number[];
  /** Columnar data. Every array has exactly `t.length` entries; `null` = no reading. */
  channels: Partial<Record<RawChannelKey, (number | null)[]>>;
  /**
   * Provider-specific channels, namespaced "<provider>.<name>", same length rule.
   * e.g. "garmin.performanceCondition". UI may offer them but analytics must not depend on them.
   */
  extra?: Record<string, (number | null)[]>;
}

export interface Pause {
  /** Seconds since start when the timer stopped. */
  startT: number;
  /** Seconds since start when the timer resumed. */
  endT: number;
}

export type LapTrigger = 'manual' | 'time' | 'distance' | 'position' | 'session_end' | 'other';
export type Intensity = 'warmup' | 'active' | 'interval' | 'rest' | 'recovery' | 'cooldown' | 'other';

export interface Lap {
  index: number;
  /** Seconds since activity start. */
  startT: number;
  /** startT + lap elapsed time. */
  endT: number;
  movingTimeS: number;
  distanceM?: number;
  avgHr?: number;
  maxHr?: number;
  /** m/s */
  avgSpeed?: number;
  trigger: LapTrigger;
  /** From the lap itself or, if absent, from the structured-workout step it belongs to. */
  intensity?: Intensity;
  workoutStepIndex?: number;
}

export type SwimStroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'drill' | 'mixed' | 'im' | 'unknown';

export interface SwimLength {
  index: number;
  startT: number;
  endT: number;
  strokes?: number;
  stroke: SwimStroke;
  /** Rest "lengths" recorded by the watch. */
  idle: boolean;
}

export interface Activity extends ActivitySummary {
  samples: Samples;
  pauses: Pause[];
  laps: Lap[];
  swimLengths?: SwimLength[];
}
