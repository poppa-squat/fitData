/**
 * @pacelab/analytics — pure, synchronous, side-effect-free functions. Owner: Track B.
 *
 * Signatures below are the CONTRACT Track C codes against (docs/CONTRACTS.md §7.2).
 * Track B replaces each stub body; changing a signature follows docs/CONTRACTS.md §8.
 * No DOM, no fetch, no Date.now() inside functions (pass dates in) — keeps everything testable.
 */
import type {
  Activity,
  ActivityLoad,
  ActivitySummary,
  AthleteSettings,
  ChannelKey,
  Correlation,
  DailyWellness,
  LoadPoint,
  Overlay,
  PerformancePoint,
  PreparedActivity,
  PrepareOptions,
  Readiness,
  Relationship,
  RelationshipInput,
  RelationshipOptions,
  Segment,
  SegmentKind,
  Smoothing,
  Suggestion,
  SuggestionContext,
  TimeWindow,
  WindowStats,
} from './types.js';

export * from './types.js';

const notImplemented = (name: string): never => {
  throw new Error(`@pacelab/analytics: ${name} not implemented yet (Track B)`);
};

/** Resample to a uniform grid, mark pauses, add derived channels. Call once per activity; everything else takes the result. */
export function prepare(activity: Activity, opts?: PrepareOptions): PreparedActivity {
  void activity;
  void opts;
  return notImplemented('prepare');
}

/** Returns a new array; never mutates. Nulls stay null and do not poison neighbours. */
export function smooth(values: (number | null)[], resampleS: number, smoothing: Smoothing): (number | null)[] {
  void values;
  void resampleS;
  void smoothing;
  return notImplemented('smooth');
}

/** Stats for every available channel (or just `channels`) inside the window. Must run in < 5 ms for a 2 h activity at 1 Hz. */
export function windowStats(p: PreparedActivity, window: TimeWindow, settings: AthleteSettings, channels?: ChannelKey[]): WindowStats {
  void p;
  void window;
  void settings;
  void channels;
  return notImplemented('windowStats');
}

/** Auto-segmentation. Unsupported kinds for the sport (e.g. swimLengths on a run) return []. */
export function segments(p: PreparedActivity, kind: SegmentKind, settings: AthleteSettings): Segment[] {
  void p;
  void kind;
  void settings;
  return notImplemented('segments');
}

/** Scatter + per-group linear fits across one or many activities/windows. */
export function relationship(inputs: RelationshipInput[], x: ChannelKey, y: ChannelKey, c?: ChannelKey, opts?: RelationshipOptions): Relationship {
  void inputs;
  void x;
  void y;
  void c;
  void opts;
  return notImplemented('relationship');
}

/** Align several activities on moving time or distance for overlay charts. */
export function overlay(activities: PreparedActivity[], channel: ChannelKey, by: 'movingTime' | 'distance', step?: number): Overlay {
  void activities;
  void channel;
  void by;
  void step;
  return notImplemented('overlay');
}

/** Training load of one activity. Works from a full PreparedActivity (TRIMP from HR stream) or a summary (avgHr/duration fallback). */
export function activityLoad(a: PreparedActivity | ActivitySummary, settings: AthleteSettings): ActivityLoad {
  void a;
  void settings;
  return notImplemented('activityLoad');
}

/** Daily load with ATL/CTL/TSB from `from` to `to` inclusive (YYYY-MM-DD). Days without activities have load 0. */
export function loadSeries(loads: ActivityLoad[], from: string, to: string): LoadPoint[] {
  void loads;
  void from;
  void to;
  return notImplemented('loadSeries');
}

/** Transparent readiness score for `date` from wellness history + training form. */
export function readiness(date: string, wellness: DailyWellness[], load: LoadPoint[]): Readiness {
  void date;
  void wellness;
  void load;
  return notImplemented('readiness');
}

/** One point per activity: how it went vs how ready you were that morning. */
export function performanceHistory(activities: PreparedActivity[], readinessByDate: Record<string, Readiness>): PerformancePoint[] {
  void activities;
  void readinessByDate;
  return notImplemented('performanceHistory');
}

/** Pearson correlations between readiness components and performance (hedged descriptions, min n = 8). */
export function correlations(points: PerformancePoint[], readinessByDate: Record<string, Readiness>): Correlation[] {
  void points;
  void readinessByDate;
  return notImplemented('correlations');
}

/** Rule-based, explainable suggestions for one activity. */
export function suggestions(p: PreparedActivity, ctx: SuggestionContext): Suggestion[] {
  void p;
  void ctx;
  return notImplemented('suggestions');
}
