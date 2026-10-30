/**
 * Per-profile athlete settings, edited in the UI (Track C), stored in the browser,
 * consumed by analytics (Track B). CONTRACT — see docs/CONTRACTS.md §6.
 */

export type HrZoneMethod = 'percentMax' | 'percentHrr' | 'lthr';

export interface AthleteSettings {
  maxHr: number;
  restingHr: number;
  /** Lactate-threshold HR, required when zoneMethod = 'lthr'. */
  lthr?: number;
  zoneMethod: HrZoneMethod;
  /**
   * Upper bounds of zones 1..4 as fractions of the method's reference
   * (zone 5 is everything above): percentMax → × maxHr; percentHrr → rest + × (max − rest);
   * lthr → × lthr. Default [0.6, 0.7, 0.8, 0.9]; suggested for lthr: [0.85, 0.89, 0.94, 1.0].
   */
  zoneUpperBounds: [number, number, number, number];
  /** Used only by Banister TRIMP weighting. */
  sex?: 'male' | 'female';
  /** Cycling functional threshold power, W. */
  ftpW?: number;
  /** Swim critical speed, m/s. */
  swimCssMps?: number;
}

export const DEFAULT_ATHLETE_SETTINGS: AthleteSettings = {
  maxHr: 190,
  restingHr: 60,
  zoneMethod: 'percentMax',
  zoneUpperBounds: [0.6, 0.7, 0.8, 0.9],
};
