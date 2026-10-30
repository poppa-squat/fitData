import type { AthleteSettings, ChannelKey } from '@pacelab/schema';
import type { ChannelStats, DriftResult, PreparedActivity, TimeWindow, WindowStats } from './types.js';

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasAny(values: readonly (number | null)[] | undefined): boolean {
  if (!values) return false;
  for (let i = 0; i < values.length; i++) {
    if (isFiniteNumber(values[i])) return true;
  }
  return false;
}

function indexAtOrAfter(t: readonly number[], time: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentile(sorted: readonly number[], p: number): number {
  const last = sorted.length - 1;
  if (last <= 0) return sorted[0]!;
  const h = p * last;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo]!;
  const weight = h - lo;
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight;
}

function channelStats(times: number[], values: number[], movingCount: number): ChannelStats {
  const n = values.length;
  const coverage = movingCount === 0 ? 0 : n / movingCount;
  if (n === 0) {
    return { n: 0, coverage, mean: null, min: null, max: null, std: null, p10: null, p50: null, p90: null, slopePerMin: null };
  }

  let sum = 0;
  let min = values[0]!;
  let max = values[0]!;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    const y = values[i]!;
    const x = times[i]!;
    sum += y;
    if (y < min) min = y;
    if (y > max) max = y;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const mean = sum / n;
  let squareSum = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i]! - mean;
    squareSum += d * d;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const denom = n * sumXX - sumX * sumX;
  const slopePerMin = n < 2 || denom === 0 ? null : ((n * sumXY - sumX * sumY) / denom) * 60;
  return {
    n,
    coverage,
    mean,
    min,
    max,
    std: n < 2 ? null : Math.sqrt(squareSum / n),
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    slopePerMin,
  };
}

function zoneThresholds(settings: AthleteSettings): [number, number, number, number] | null {
  const [a, b, c, d] = settings.zoneUpperBounds;
  if (settings.zoneMethod === 'percentMax') {
    if (!(settings.maxHr > 0)) return null;
    return [a * settings.maxHr, b * settings.maxHr, c * settings.maxHr, d * settings.maxHr];
  }
  if (settings.zoneMethod === 'percentHrr') {
    const reserve = settings.maxHr - settings.restingHr;
    if (!(reserve > 0)) return null;
    return [
      settings.restingHr + a * reserve,
      settings.restingHr + b * reserve,
      settings.restingHr + c * reserve,
      settings.restingHr + d * reserve,
    ];
  }
  if (!(settings.lthr !== undefined && settings.lthr > 0)) return null;
  const lthr = settings.lthr;
  return [a * lthr, b * lthr, c * lthr, d * lthr];
}

function zoneIndex(hr: number, bounds: readonly [number, number, number, number]): number {
  if (hr <= bounds[0]) return 0;
  if (hr <= bounds[1]) return 1;
  if (hr <= bounds[2]) return 2;
  if (hr <= bounds[3]) return 3;
  return 4;
}

function outputBasis(p: PreparedActivity): { basis: DriftResult['basis']; values: (number | null)[] } | null {
  if (p.activity.sport === 'cycling' && p.series.power && hasAny(p.series.power)) {
    return { basis: 'power', values: p.series.power };
  }
  if (p.activity.sport === 'running' && p.series.gapSpeed && hasAny(p.series.gapSpeed)) {
    return { basis: 'gapSpeed', values: p.series.gapSpeed };
  }
  if (p.series.speed && hasAny(p.series.speed)) return { basis: 'speed', values: p.series.speed };
  return null;
}

function halfRatio(indices: readonly number[], from: number, to: number, output: readonly (number | null)[], hr: readonly (number | null)[]): number | null {
  let outputSum = 0;
  let hrSum = 0;
  let n = 0;
  for (let k = from; k < to; k++) {
    const i = indices[k]!;
    const out = output[i];
    const beat = hr[i];
    if (!isFiniteNumber(out) || !isFiniteNumber(beat) || !(beat > 0)) continue;
    outputSum += out;
    hrSum += beat;
    n++;
  }
  if (n === 0 || hrSum === 0) return null;
  return outputSum / hrSum;
}

function normalizedPower(values: readonly number[], resampleS: number): number {
  const roll = Math.max(1, Math.round(30 / resampleS));
  let sum = 0;
  let fourthSum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= roll) sum -= values[i - roll]!;
    const avg = sum / Math.min(i + 1, roll);
    const square = avg * avg;
    fourthSum += square * square;
  }
  return (fourthSum / values.length) ** 0.25;
}

/**
 * Summarize one time span: channel stats, heart-rate zone time, aerobic drift, and cycling or swim scores.
 */
export function windowStats(
  p: PreparedActivity,
  window: TimeWindow,
  settings: AthleteSettings,
  channels?: ChannelKey[],
): WindowStats {
  const start = indexAtOrAfter(p.t, window.startT);
  const end = indexAtOrAfter(p.t, window.endT);
  const moving: number[] = [];
  for (let i = start; i < end; i++) {
    if (!p.paused[i]) moving.push(i);
  }
  const movingCount = moving.length;
  const movingS = movingCount * p.resampleS;

  const keys = channels ?? p.available;
  const channelResults: WindowStats['channels'] = {};
  for (const key of keys) {
    const series = p.series[key];
    const times: number[] = [];
    const values: number[] = [];
    if (series) {
      for (let k = 0; k < movingCount; k++) {
        const i = moving[k]!;
        const value = series[i];
        if (!isFiniteNumber(value)) continue;
        times.push(p.t[i]!);
        values.push(value);
      }
    }
    channelResults[key] = channelStats(times, values, movingCount);
  }

  let distanceM: number | null = null;
  const distance = p.series.distance;
  if (distance) {
    let first: number | null = null;
    let last: number | null = null;
    for (let i = start; i < end; i++) {
      const value = distance[i];
      if (!isFiniteNumber(value)) continue;
      if (first === null) first = value;
      last = value;
    }
    if (first !== null && last !== null) distanceM = last - first;
  }

  const thresholds = zoneThresholds(settings);
  const heartRate = p.series.heartRate;
  const hrZoneS: number[] = [];
  if (thresholds && heartRate) {
    const zones = [0, 0, 0, 0, 0];
    let any = false;
    for (let k = 0; k < movingCount; k++) {
      const value = heartRate[moving[k]!];
      if (!isFiniteNumber(value)) continue;
      zones[zoneIndex(value, thresholds)]! += p.resampleS;
      any = true;
    }
    if (any) hrZoneS.push(...zones);
  }

  let drift: DriftResult | null = null;
  const basis = outputBasis(p);
  if (basis && heartRate && movingS >= 600 && movingCount >= 2) {
    const mid = Math.ceil(movingCount / 2);
    const firstHalfRatio = halfRatio(moving, 0, mid, basis.values, heartRate);
    const secondHalfRatio = halfRatio(moving, mid, movingCount, basis.values, heartRate);
    if (firstHalfRatio !== null && secondHalfRatio !== null && firstHalfRatio !== 0) {
      drift = {
        firstHalfRatio,
        secondHalfRatio,
        decouplingPct: ((firstHalfRatio - secondHalfRatio) / firstHalfRatio) * 100,
        basis: basis.basis,
      };
    }
  }

  const result: WindowStats = {
    window,
    elapsedS: window.endT - window.startT,
    movingS,
    distanceM,
    channels: channelResults,
    hrZoneS,
    drift,
  };

  if (p.activity.sport === 'cycling' && p.series.power) {
    const powers: number[] = [];
    const power = p.series.power;
    for (let k = 0; k < movingCount; k++) {
      const value = power[moving[k]!];
      if (isFiniteNumber(value)) powers.push(value);
    }
    if (powers.length > 0) {
      const normalizedW = normalizedPower(powers, p.resampleS);
      const ftp = settings.ftpW;
      const intensityFactor = ftp !== undefined && ftp > 0 ? normalizedW / ftp : null;
      const tss =
        intensityFactor !== null && ftp !== undefined && ftp > 0
          ? ((movingS * normalizedW * intensityFactor) / (ftp * 3600)) * 100
          : null;
      result.power = { normalizedW, intensityFactor, tss };
    }
  }

  if (p.activity.sport === 'swimming') {
    let lengths = 0;
    let strokeSum = 0;
    let strokeCount = 0;
    let swolfSum = 0;
    let swolfCount = 0;
    for (const length of p.activity.swimLengths ?? []) {
      if (length.idle || length.startT >= window.endT || length.endT <= window.startT) continue;
      lengths++;
      if (length.strokes === undefined) continue;
      strokeSum += length.strokes;
      strokeCount++;
      swolfSum += length.endT - length.startT + length.strokes;
      swolfCount++;
    }
    result.swim = {
      lengths,
      avgSwolf: swolfCount > 0 ? swolfSum / swolfCount : null,
      avgStrokesPerLength: strokeCount > 0 ? strokeSum / strokeCount : null,
    };
  }

  return result;
}
