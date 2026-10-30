import { describe, expect, it } from 'vitest';
import { smooth } from '../src/index.js';

describe('smooth', () => {
  it('returns a copy for no smoothing', () => {
    const input = [1, null, 2];
    const out = smooth(input, 1, { kind: 'none' });
    expect(out).toEqual([1, null, 2]);
    expect(out).not.toBe(input);
    out[0] = 9;
    expect(input[0]).toBe(1);
  });

  it('takes a centered moving average and ignores nulls', () => {
    expect(smooth([1, 2, 3, 4, 5], 1, { kind: 'movingAverage', windowS: 4 })).toEqual([2, 2.5, 3, 3.5, 4]);
    const input = [10, null, 10];
    const out = smooth(input, 1, { kind: 'movingAverage', windowS: 4 });
    expect(out).toEqual([10, null, 10]);
    expect(input).toEqual([10, null, 10]);
  });

  it('takes a centered median, averaging the two middle values when the count is even', () => {
    expect(smooth([1, 100, 3, null, 5], 1, { kind: 'median', windowS: 4 })).toEqual([3, 3, 4, null, 4]);
  });

  it('applies a null-aware EWMA with the given half-life', () => {
    expect(smooth([10, null, 0], 1, { kind: 'ewma', halfLifeS: 1 })).toEqual([10, null, 5]);
    // α = 1 - 0.5^(1/2) ≈ 0.292893; 8 * α ≈ 2.343146.
    expect(smooth([0, 8], 1, { kind: 'ewma', halfLifeS: 2 })[1]).toBeCloseTo(2.34314575, 5);
  });

  it('smooths an empty series to an empty series', () => {
    expect(smooth([], 1, { kind: 'movingAverage', windowS: 30 })).toEqual([]);
    expect(smooth([], 1, { kind: 'ewma', halfLifeS: 5 })).toEqual([]);
    expect(smooth([], 1, { kind: 'median', windowS: 5 })).toEqual([]);
  });
});
