/**
 * Daily wellness (sleep / recovery) model. CONTRACT — see docs/CONTRACTS.md §4.
 * Mirrored in C# by sync/src/Pacelab.Canonical/Models.cs.
 */
import type { Provider } from './activity.js';

/** A single value plus the provider it came from, so merged days stay traceable. */
export interface Metric {
  value: number;
  source: Provider;
}

export interface SleepSummary {
  source: Provider;
  /** ISO-8601 UTC. */
  bedtimeStart: string;
  /** ISO-8601 UTC. */
  bedtimeEnd: string;
  totalSleepS: number;
  deepS?: number;
  remS?: number;
  lightS?: number;
  awakeS?: number;
  latencyS?: number;
  efficiencyPct?: number;
  avgHr?: number;
  lowestHr?: number;
  /** Night-average rMSSD, milliseconds. */
  avgHrvMs?: number;
  avgBreathRate?: number;
  /** The provider's own 0–100 sleep score, if any. Shown as-is, never re-derived. */
  providerScore?: number;
}

export interface DailyWellness {
  /** Local calendar date of the morning the sleep ended, "YYYY-MM-DD". One record per date per profile. */
  date: string;
  /** Main sleep period only (naps ignored in v1). */
  sleep?: SleepSummary;
  restingHr?: Metric;
  /** Night-average rMSSD, ms. */
  hrvMs?: Metric;
  /** The provider's own readiness/recovery score (Oura Readiness, Garmin Training Readiness). Display only. */
  providerReadiness?: Metric;
  /** Skin/body temperature deviation from baseline, °C. */
  temperatureDeviationC?: Metric;
  steps?: Metric;
}
