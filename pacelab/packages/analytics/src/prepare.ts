import { DERIVED_CHANNEL_KEYS, RAW_CHANNEL_KEYS } from '@pacelab/schema';
import type { Activity, ChannelKey, RawChannelKey } from '@pacelab/schema';
import type { PreparedActivity, PrepareOptions } from './types.js';
import { smooth } from './smooth.js';

const CHANNEL_ORDER: ChannelKey[] = [...RAW_CHANNEL_KEYS, ...DERIVED_CHANNEL_KEYS];

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Minetti's energy cost of running (J/kg/m) at grade fraction i. C(0) = 3.6. */
function minettiCost(gradeFraction: number): number {
  const i2 = gradeFraction * gradeFraction;
  const i3 = i2 * gradeFraction;
  const i4 = i2 * i2;
  const i5 = i4 * gradeFraction;
  return 155.4 * i5 - 30.4 * i4 - 43.3 * i3 + 46.3 * i2 + 19.5 * gradeFraction + 3.6;
}

function buildGrid(activity: Activity, resampleS: number): number[] {
  const times = activity.samples.t;
  const last = times.length > 0 ? times[times.length - 1]! : 0;
  const end = Math.max(activity.elapsedTimeS, last);
  const steps = resampleS > 0 ? Math.floor(end / resampleS) : 0;
  const grid = new Array<number>(steps + 1);
  for (let i = 0; i <= steps; i++) grid[i] = i * resampleS;
  return grid;
}

function interpolate(
  times: readonly number[],
  values: readonly (number | null)[],
  grid: readonly number[],
  maxGap: number,
): (number | null)[] {
  const knotT: number[] = [];
  const knotV: number[] = [];
  for (let i = 0; i < times.length && i < values.length; i++) {
    const value = values[i];
    if (!isFiniteNumber(value)) continue;
    knotT.push(times[i]!);
    knotV.push(value);
  }

  const out: (number | null)[] = new Array(grid.length).fill(null);
  if (knotT.length === 0) return out;

  let hi = 0;
  for (let i = 0; i < grid.length; i++) {
    const g = grid[i]!;
    while (hi < knotT.length && knotT[hi]! < g - 1e-6) hi++;
    const rightT = hi < knotT.length ? knotT[hi] : undefined;
    const rightV = hi < knotT.length ? knotV[hi] : undefined;
    const leftT = hi > 0 ? knotT[hi - 1] : undefined;
    const leftV = hi > 0 ? knotV[hi - 1] : undefined;
    if (rightT !== undefined && rightV !== undefined && Math.abs(rightT - g) <= 1e-4) {
      out[i] = rightV;
      continue;
    }
    if (
      leftT !== undefined &&
      rightT !== undefined &&
      leftV !== undefined &&
      rightV !== undefined &&
      rightT - leftT <= maxGap + 1e-9
    ) {
      const span = rightT - leftT;
      out[i] = span === 0 ? leftV : leftV + ((g - leftT) / span) * (rightV - leftV);
    }
  }
  return out;
}

/** Merge timer pauses and idle swim lengths into half-open [start, end) intervals. */
function pauseIntervals(activity: Activity): [number, number][] {
  const raw: [number, number][] = [];
  for (const pause of activity.pauses) {
    if (pause.endT > pause.startT) raw.push([pause.startT, pause.endT]);
  }
  if (activity.sport === 'swimming') {
    for (const length of activity.swimLengths ?? []) {
      if (length.idle && length.endT > length.startT) raw.push([length.startT, length.endT]);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of raw) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function pausedAt(t: number, pauses: readonly [number, number][]): boolean {
  for (const [start, end] of pauses) {
    if (t < start) return false;
    if (t < end) return true;
  }
  return false;
}

function pausedDuration(t: number, pauses: readonly [number, number][]): number {
  let total = 0;
  for (const [start, end] of pauses) {
    if (t <= start) break;
    total += Math.min(t, end) - start;
  }
  return total;
}

function distanceAtOrBefore(
  times: readonly number[],
  distance: readonly (number | null)[] | undefined,
  startT: number,
): number | null {
  if (!distance) return null;
  let hold: number | null = null;
  for (let i = 0; i < times.length && i < distance.length; i++) {
    if (times[i]! > startT + 1e-4) break;
    const value = distance[i];
    if (isFiniteNumber(value)) hold = value;
  }
  return hold;
}

function fillSwimLengths(
  activity: Activity,
  grid: readonly number[],
  series: Partial<Record<RawChannelKey, (number | null)[]>>,
): void {
  const lengths = activity.swimLengths ?? [];
  const times = activity.samples.t;
  const channels = activity.samples.channels;
  const keys = RAW_CHANNEL_KEYS.filter((key) => channels[key] !== undefined);
  for (const length of lengths) {
    if (length.idle) continue;
    let sample = -1;
    for (let i = 0; i < times.length; i++) {
      const t = times[i]!;
      if (t < length.startT - 1e-4) continue;
      if (t > length.endT + 1e-4) break;
      sample = i;
    }
    if (sample < 0) continue;
    for (let i = 0; i < grid.length; i++) {
      const t = grid[i]!;
      if (t < length.startT || t >= length.endT) continue;
      for (const key of keys) {
        const raw = channels[key]?.[sample];
        const row = series[key];
        if (!row) continue;
        row[i] = isFiniteNumber(raw) ? raw : null;
      }
    }
  }
}

/**
 * Grade in percent from altitude smoothed with a centered 30 s average.
 * Uses the closest samples at least 5 m of distance either side (10 m one-sided at the ends).
 */
function gradePct(altitude: (number | null)[], distance: (number | null)[], resampleS: number): (number | null)[] {
  const alt = smooth(altitude, resampleS, { kind: 'movingAverage', windowS: 30 });
  const n = altitude.length;
  const out: (number | null)[] = new Array(n).fill(null);

  const findSpan = (i: number, dir: -1 | 1, minSpan: number, origin: number): { alt: number; dist: number } | null => {
    for (let j = i + dir; j >= 0 && j < n; j += dir) {
      const dj = distance[j];
      const aj = alt[j];
      if (!isFiniteNumber(dj) || !isFiniteNumber(aj)) continue;
      const delta = dir === 1 ? dj - origin : origin - dj;
      if (delta >= minSpan) return { alt: aj, dist: dj };
    }
    return null;
  };

  for (let i = 0; i < n; i++) {
    const di = distance[i];
    const ai = alt[i];
    if (!isFiniteNumber(di) || !isFiniteNumber(ai)) continue;
    const left = findSpan(i, -1, 5, di);
    const right = findSpan(i, 1, 5, di);
    let d0: number;
    let d1: number;
    let a0: number;
    let a1: number;
    if (left && right) {
      d0 = left.dist;
      d1 = right.dist;
      a0 = left.alt;
      a1 = right.alt;
    } else if (right) {
      const far = findSpan(i, 1, 10, di);
      if (!far) continue;
      d0 = di;
      d1 = far.dist;
      a0 = ai;
      a1 = far.alt;
    } else if (left) {
      const far = findSpan(i, -1, 10, di);
      if (!far) continue;
      d0 = far.dist;
      d1 = di;
      a0 = far.alt;
      a1 = ai;
    } else {
      continue;
    }
    const span = d1 - d0;
    if (!(span >= 10 - 1e-6)) continue;
    out[i] = clamp((100 * (a1 - a0)) / span, -40, 40);
  }
  return out;
}

function hasFinite(values: readonly (number | null)[] | undefined): boolean {
  return values?.some((value) => isFiniteNumber(value)) ?? false;
}

/**
 * Resample the activity onto a uniform grid, mask pauses, and add pace, grade-adjusted speed, and efficiency.
 */
export function prepare(activity: Activity, opts?: PrepareOptions): PreparedActivity {
  const resampleS = opts?.resampleS ?? 1;
  const maxGap = opts?.maxInterpolateGapS ?? 10;
  const grid = buildGrid(activity, resampleS);
  const pauses = pauseIntervals(activity);
  const times = activity.samples.t;
  const useLengths = activity.sport === 'swimming' && (activity.swimLengths?.length ?? 0) > 0;

  const series: Partial<Record<ChannelKey, (number | null)[]>> = {};
  for (const key of RAW_CHANNEL_KEYS) {
    const raw = activity.samples.channels[key];
    if (!raw) continue;
    series[key] = useLengths ? new Array<number | null>(grid.length).fill(null) : interpolate(times, raw, grid, maxGap);
  }
  if (useLengths) fillSwimLengths(activity, grid, series as Partial<Record<RawChannelKey, (number | null)[]>>);

  const paused = grid.map((t) => pausedAt(t, pauses));
  for (const [start, end] of pauses) {
    const held = distanceAtOrBefore(times, activity.samples.channels.distance, start);
    for (let i = 0; i < grid.length; i++) {
      const t = grid[i]!;
      if (t < start || t >= end) continue;
      for (const key of Object.keys(series) as ChannelKey[]) {
        if (key === 'distance') continue;
        const row = series[key];
        if (row) row[i] = null;
      }
      if (series.distance) series.distance[i] = held;
    }
  }

  const speed = series.speed;
  const heartRate = series.heartRate;
  const runLike = activity.sport === 'running' || activity.sport === 'walking' || activity.sport === 'hiking';
  const isSwim = activity.sport === 'swimming';

  if (runLike && speed) {
    series.pace = speed.map((value) => (isFiniteNumber(value) && value >= 0.5 ? 1000 / value : null));
  }
  if (isSwim && speed) {
    series.pace100m = speed.map((value) => (isFiniteNumber(value) && value > 0 ? 100 / value : null));
  }

  if (series.altitude && series.distance) {
    series.gradePct = gradePct(series.altitude, series.distance, resampleS);
  }
  if (speed && series.gradePct) {
    const grade = series.gradePct;
    series.gapSpeed = speed.map((value, i) => {
      if (!isFiniteNumber(value)) return null;
      const gradeValue = grade[i];
      if (!isFiniteNumber(gradeValue)) return null;
      const fraction = clamp(gradeValue / 100, -0.45, 0.45);
      const cost = minettiCost(fraction);
      const flat = minettiCost(0);
      if (!(cost > 0) || !(flat > 0)) return null;
      return (value * cost) / flat;
    });
  }

  const cyclingWithPower = activity.sport === 'cycling' && hasFinite(activity.samples.channels.power);
  if (cyclingWithPower && series.power && heartRate) {
    const power = series.power;
    series.efficiency = heartRate.map((bpm, i) => {
      const watts = power[i];
      if (!isFiniteNumber(bpm) || !(bpm > 0) || !isFiniteNumber(watts)) return null;
      return watts / bpm;
    });
  } else if (heartRate) {
    const gapSpeed = series.gapSpeed;
    series.efficiency = heartRate.map((bpm, i) => {
      if (!isFiniteNumber(bpm) || !(bpm > 0)) return null;
      const fromGap = gapSpeed?.[i];
      const fromSpeed = speed?.[i];
      const value = runLike || isSwim ? (isFiniteNumber(fromGap) ? fromGap : fromSpeed) : fromSpeed;
      if (!isFiniteNumber(value)) return null;
      return (value * 60) / bpm;
    });
  }

  const measuredStep = hasFinite(activity.samples.channels.stepLength);
  let stepDerived = false;
  if (!measuredStep && speed && series.cadence) {
    const cadence = series.cadence;
    series.stepLength = speed.map((value, i) => {
      const stepsPerMin = cadence[i];
      if (!isFiniteNumber(value) || !isFiniteNumber(stepsPerMin) || !(stepsPerMin > 0)) return null;
      return (value * 60) / stepsPerMin;
    });
    stepDerived = true;
  }

  series.movingTime = grid.map((t) => t - pausedDuration(t, pauses));

  const derivedKeys = new Set<ChannelKey>([
    'movingTime',
    ...(series.pace ? (['pace'] as const) : []),
    ...(series.pace100m ? (['pace100m'] as const) : []),
    ...(series.gradePct ? (['gradePct'] as const) : []),
    ...(series.gapSpeed ? (['gapSpeed'] as const) : []),
    ...(series.efficiency ? (['efficiency'] as const) : []),
    ...(stepDerived ? (['stepLength'] as const) : []),
  ]);

  return {
    activity,
    t: grid,
    resampleS,
    series,
    paused,
    derived: CHANNEL_ORDER.filter((key) => derivedKeys.has(key)),
    available: CHANNEL_ORDER.filter((key) => hasFinite(series[key])),
  };
}
