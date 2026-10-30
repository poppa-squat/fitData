import type { Smoothing } from './types.js';

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Smooth one uniformly sampled series with a centered moving average, a centered median, or an EWMA.
 * Nulls stay null and are skipped, so a gap does not turn its neighbours into null.
 */
export function smooth(values: (number | null)[], resampleS: number, smoothing: Smoothing): (number | null)[] {
  if (smoothing.kind === 'none') return values.slice();

  const n = values.length;
  const out: (number | null)[] = new Array(n);

  if (smoothing.kind === 'ewma') {
    const halfLifeS = smoothing.halfLifeS;
    const alpha = halfLifeS <= 0 || resampleS <= 0 ? 1 : 1 - 2 ** (-resampleS / halfLifeS);
    let state: number | null = null;
    for (let i = 0; i < n; i++) {
      const value = values[i];
      if (!isFiniteNumber(value)) {
        out[i] = null;
        continue;
      }
      state = state === null ? value : alpha * value + (1 - alpha) * state;
      out[i] = state;
    }
    return out;
  }

  const radius = resampleS > 0 ? Math.floor(smoothing.windowS / 2 / resampleS + 1e-9) : 0;
  for (let i = 0; i < n; i++) {
    if (!isFiniteNumber(values[i])) {
      out[i] = null;
      continue;
    }
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    if (smoothing.kind === 'movingAverage') {
      let sum = 0;
      let count = 0;
      for (let j = lo; j <= hi; j++) {
        const value = values[j];
        if (!isFiniteNumber(value)) continue;
        sum += value;
        count++;
      }
      out[i] = count > 0 ? sum / count : null;
    } else {
      const window: number[] = [];
      for (let j = lo; j <= hi; j++) {
        const value = values[j];
        if (isFiniteNumber(value)) window.push(value);
      }
      out[i] = window.length > 0 ? medianOf(window) : null;
    }
  }
  return out;
}
