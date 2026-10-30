import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Activity, Lap, RawChannelKey, Sport, SwimLength } from '@pacelab/schema';
import { prepare } from '../src/index.js';

function loadFixture(name: string): Activity {
  const path = fileURLToPath(new URL(`../../../fixtures/canonical/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Activity;
}

function makeActivity(overrides: {
  sport?: Sport;
  elapsedTimeS?: number;
  movingTimeS?: number;
  t?: number[];
  channels?: Activity['samples']['channels'];
  pauses?: Activity['pauses'];
  laps?: Lap[];
  swimLengths?: SwimLength[];
  poolLengthM?: number;
}): Activity {
  const t = overrides.t ?? [];
  const channels = overrides.channels ?? {};
  const lastT = t.length > 0 ? t[t.length - 1]! : 0;
  const elapsed = overrides.elapsedTimeS ?? lastT;
  return {
    id: 'file:handbuilt',
    schemaVersion: 1,
    sport: overrides.sport ?? 'running',
    subSport: 'generic',
    startTime: '2026-01-15T12:00:00Z',
    elapsedTimeS: elapsed,
    movingTimeS: overrides.movingTimeS ?? elapsed,
    hasGps: false,
    channels: Object.keys(channels) as RawChannelKey[],
    source: { provider: 'file', format: 'json', importedAt: '2026-01-15T13:00:00Z' },
    samples: { t, channels },
    pauses: overrides.pauses ?? [],
    laps: overrides.laps ?? [],
    ...(overrides.swimLengths ? { swimLengths: overrides.swimLengths } : {}),
    ...(overrides.poolLengthM !== undefined ? { poolLengthM: overrides.poolLengthM } : {}),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

describe('prepare', () => {
  it('builds a uniform grid through the later of elapsed time and the last sample', () => {
    const prepared = prepare(
      makeActivity({
        elapsedTimeS: 2.2,
        t: [0, 2.5],
        channels: { speed: [1, 2] },
      }),
    );
    expect(prepared.t).toEqual([0, 1, 2]);
    expect(prepared.resampleS).toBe(1);

    const coarse = prepare(
      makeActivity({
        elapsedTimeS: 10,
        t: [0, 10],
        channels: { speed: [0, 10] },
      }),
      { resampleS: 5 },
    );
    expect(coarse.t).toEqual([0, 5, 10]);
    expect(coarse.series.speed).toEqual([0, 5, 10]);
  });

  it('linearly interpolates gaps up to maxInterpolateGapS and does not extrapolate', () => {
    const activity = makeActivity({
      elapsedTimeS: 30,
      t: [0, 10],
      channels: { speed: [0, 100] },
    });
    const filled = prepare(activity, { maxInterpolateGapS: 10 });
    expect(filled.series.speed?.[0]).toBe(0);
    expect(filled.series.speed?.[4]).toBe(40);
    expect(filled.series.speed?.[5]).toBe(50);
    expect(filled.series.speed?.[10]).toBe(100);
    expect(filled.series.speed?.[11]).toBeNull();

    const open = prepare(activity, { maxInterpolateGapS: 9 });
    expect(open.series.speed?.[0]).toBe(0);
    expect(open.series.speed?.[5]).toBeNull();
    expect(open.series.speed?.[10]).toBe(100);

    const lonely = prepare(
      makeActivity({
        elapsedTimeS: 10,
        t: [5],
        channels: { heartRate: [7] },
      }),
    );
    expect(lonely.series.heartRate).toEqual([null, null, null, null, null, 7, null, null, null, null, null]);
  });

  it('nulls every channel inside a pause except distance and moving time, held flat', () => {
    const prepared = prepare(
      makeActivity({
        elapsedTimeS: 20,
        t: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
        channels: {
          speed: Array.from({ length: 21 }, () => 2),
          heartRate: Array.from({ length: 21 }, () => 140),
          distance: Array.from({ length: 21 }, (_, i) => i * 2),
        },
        pauses: [{ startT: 5, endT: 10 }],
      }),
    );

    for (let t = 5; t < 10; t++) {
      expect(prepared.paused[t]).toBe(true);
      expect(prepared.series.speed?.[t]).toBeNull();
      expect(prepared.series.heartRate?.[t]).toBeNull();
      expect(prepared.series.pace?.[t]).toBeNull();
      expect(prepared.series.distance?.[t]).toBe(10);
      expect(prepared.series.movingTime?.[t]).toBe(5);
    }
    expect(prepared.paused[4]).toBe(false);
    expect(prepared.paused[10]).toBe(false);
    expect(prepared.series.distance?.[4]).toBe(8);
    expect(prepared.series.distance?.[10]).toBe(20);
    expect(prepared.series.movingTime?.[0]).toBe(0);
    expect(prepared.series.movingTime?.[4]).toBe(4);
    expect(prepared.series.movingTime?.[10]).toBe(5);
    expect(prepared.series.movingTime?.[20]).toBe(15);
    expect(prepared.series.heartRate?.[10]).toBe(140);
  });

  it('counts overlapping pauses once', () => {
    const prepared = prepare(
      makeActivity({
        elapsedTimeS: 10,
        t: [0, 10],
        channels: { speed: [3, 3] },
        pauses: [
          { startT: 0, endT: 5 },
          { startT: 3, endT: 8 },
        ],
      }),
    );
    expect(prepared.series.movingTime?.[10]).toBe(2);
    expect(prepared.paused[3]).toBe(true);
    expect(prepared.paused[7]).toBe(true);
    expect(prepared.paused[8]).toBe(false);
  });

  it('derives running pace, step length, grade-adjusted speed, and efficiency', () => {
    const n = 61;
    const prepared = prepare(
      makeActivity({
        elapsedTimeS: 60,
        t: Array.from({ length: n }, (_, i) => i),
        channels: {
          speed: Array.from({ length: n }, () => 4),
          distance: Array.from({ length: n }, (_, i) => i * 4),
          altitude: Array.from({ length: n }, (_, i) => i * 0.4),
          heartRate: Array.from({ length: n }, () => 150),
          cadence: Array.from({ length: n }, () => 180),
        },
      }),
    );
    const i = 30;
    expect(prepared.series.pace?.[i]).toBe(250);
    expect(prepared.series.pace?.[0]).toBe(250);
    expect(prepared.series.stepLength?.[i]).toBeCloseTo(4 / 3, 10);
    expect(prepared.series.gradePct?.[i]).toBeCloseTo(10, 6);
    // Minetti C(0.10) / C(0) = 5.968214 / 3.6; gap speed = 4 * that ratio.
    expect(prepared.series.gapSpeed?.[i]).toBeCloseTo(6.631348889, 5);
    expect(prepared.series.efficiency?.[i]).toBeCloseTo(2.652539556, 5);
    expect(prepared.derived).toEqual(
      expect.arrayContaining(['stepLength', 'pace', 'gradePct', 'gapSpeed', 'efficiency', 'movingTime']),
    );
    expect(prepared.derived).not.toContain('pace100m');
    expect(prepared.series.pace100m).toBeUndefined();
  });

  it('drops pace below 0.5 m/s and keeps a device-measured step length out of derived', () => {
    const prepared = prepare(
      makeActivity({
        t: [0, 1],
        channels: {
          speed: [0.4, 2],
          cadence: [160, 160],
          stepLength: [1.1, 1.2],
          heartRate: [120, 130],
        },
      }),
    );
    expect(prepared.series.pace?.[0]).toBeNull();
    expect(prepared.series.pace?.[1]).toBe(500);
    expect(prepared.series.stepLength).toEqual([1.1, 1.2]);
    expect(prepared.derived).not.toContain('stepLength');
  });

  it('clamps grade to ±40% before the Minetti adjustment', () => {
    const n = 61;
    const up = prepare(
      makeActivity({
        elapsedTimeS: 60,
        t: Array.from({ length: n }, (_, i) => i),
        channels: {
          speed: Array.from({ length: n }, () => 1),
          distance: Array.from({ length: n }, (_, i) => i),
          altitude: Array.from({ length: n }, (_, i) => i * 0.5),
          heartRate: Array.from({ length: n }, () => 140),
        },
      }),
    );
    expect(up.series.gradePct?.[30]).toBe(40);
    // C(0.40) / C(0) = 16.849856 / 3.6.
    expect(up.series.gapSpeed?.[30]).toBeCloseTo(4.680515556, 5);

    const down = prepare(
      makeActivity({
        elapsedTimeS: 60,
        t: Array.from({ length: n }, (_, i) => i),
        channels: {
          speed: Array.from({ length: n }, () => 1),
          distance: Array.from({ length: n }, (_, i) => i),
          altitude: Array.from({ length: n }, (_, i) => i * -0.5),
          heartRate: Array.from({ length: n }, () => 140),
        },
      }),
    );
    expect(down.series.gradePct?.[30]).toBe(-40);
    expect(down.series.gapSpeed?.[30]).toBeCloseTo(1.002684444, 5);
  });

  it('uses watts per beat for cycling with power, and speed per beat otherwise', () => {
    const withPower = prepare(
      makeActivity({
        sport: 'cycling',
        elapsedTimeS: 2,
        t: [0, 1, 2],
        channels: {
          power: [250, 250, 250],
          heartRate: [125, 125, 125],
          speed: [8, 8, 8],
        },
      }),
    );
    expect(withPower.series.efficiency).toEqual([2, 2, 2]);
    expect(withPower.series.pace).toBeUndefined();

    const noPower = prepare(
      makeActivity({
        sport: 'cycling',
        t: [0],
        channels: { heartRate: [125], speed: [8] },
      }),
    );
    expect(noPower.series.efficiency?.[0]).toBeCloseTo(3.84, 10);

    const other = prepare(
      makeActivity({
        sport: 'other',
        t: [0],
        channels: { heartRate: [100], speed: [3] },
      }),
    );
    expect(other.series.efficiency?.[0]).toBeCloseTo(1.8, 10);
  });

  it('fills each swim length from the sample at its end and treats idle lengths as pauses', () => {
    const prepared = prepare(
      makeActivity({
        sport: 'swimming',
        poolLengthM: 25,
        elapsedTimeS: 30,
        t: [10, 20, 30],
        channels: {
          heartRate: [100, 110, 90],
          speed: [1, 1.25, 0],
          distance: [25, 50, 50],
          cadence: [30, 32, null],
        },
        swimLengths: [
          { index: 0, startT: 0, endT: 10, strokes: 10, stroke: 'freestyle', idle: false },
          { index: 1, startT: 10, endT: 20, strokes: 12, stroke: 'freestyle', idle: false },
          { index: 2, startT: 20, endT: 30, stroke: 'unknown', idle: true },
        ],
      }),
    );

    expect(prepared.series.heartRate?.[0]).toBe(100);
    expect(prepared.series.heartRate?.[9]).toBe(100);
    expect(prepared.series.speed?.[9]).toBe(1);
    expect(prepared.series.distance?.[9]).toBe(25);
    expect(prepared.series.pace100m?.[9]).toBe(100);

    expect(prepared.series.heartRate?.[10]).toBe(110);
    expect(prepared.series.heartRate?.[19]).toBe(110);
    expect(prepared.series.speed?.[15]).toBe(1.25);
    expect(prepared.series.distance?.[15]).toBe(50);
    expect(prepared.series.pace100m?.[15]).toBe(80);

    for (let t = 20; t < 30; t++) {
      expect(prepared.paused[t]).toBe(true);
      expect(prepared.series.heartRate?.[t]).toBeNull();
      expect(prepared.series.speed?.[t]).toBeNull();
      expect(prepared.series.cadence?.[t]).toBeNull();
      expect(prepared.series.pace100m?.[t]).toBeNull();
      expect(prepared.series.distance?.[t]).toBe(50);
      expect(prepared.series.movingTime?.[t]).toBe(20);
    }
    expect(prepared.paused[19]).toBe(false);
    expect(prepared.series.movingTime?.[30]).toBe(20);
    expect(prepared.series.pace).toBeUndefined();
  });

  it('does not mutate the activity', () => {
    const activity = deepFreeze(
      makeActivity({
        t: [0, 4, 8],
        channels: { speed: [2, null, 4], heartRate: [100, 110, 120] },
        pauses: [{ startT: 1, endT: 2 }],
      }),
    );
    expect(() => prepare(activity)).not.toThrow();
  });

  it('returns an empty grid point for an activity with no samples', () => {
    const prepared = prepare(makeActivity({ elapsedTimeS: 0 }));
    expect(prepared.t).toEqual([0]);
    expect(prepared.paused).toEqual([false]);
    expect(prepared.series.movingTime).toEqual([0]);
    expect(prepared.available).toEqual(['movingTime']);
  });

  describe('fixtures', () => {
    it('resamples the easy run, masks the pause, and derives stride and pace', () => {
      const easy = loadFixture('easy-run.json');
      const before = structuredClone(easy);
      const prepared = prepare(easy);
      expect(easy).toEqual(before);

      expect(prepared.t).toHaveLength(2904);
      expect(prepared.t[0]).toBe(0);
      expect(prepared.t[2903]).toBe(2903);
      expect(prepared.resampleS).toBe(1);

      const pauseStart = easy.samples.t.indexOf(273);
      const heldDistance = easy.samples.channels.distance?.[pauseStart];
      expect(heldDistance).toEqual(expect.any(Number));
      for (let t = 273; t < 467; t++) {
        expect(prepared.paused[t]).toBe(true);
        expect(prepared.series.distance?.[t]).toBe(heldDistance);
        expect(prepared.series.movingTime?.[t]).toBe(273);
        for (const key of Object.keys(prepared.series)) {
          if (key === 'distance' || key === 'movingTime') continue;
          expect(prepared.series[key as keyof typeof prepared.series]?.[t]).toBeNull();
        }
      }
      expect(prepared.paused[272]).toBe(false);
      expect(prepared.paused[467]).toBe(false);
      expect(prepared.series.heartRate?.[272]).toEqual(expect.any(Number));
      expect(prepared.series.movingTime?.[2903]).toBe(2709);
      expect(Math.abs(2709 - easy.movingTimeS)).toBeLessThan(5);
      expect(prepared.series.movingTime?.[467]).toBe(273);
      expect(prepared.series.movingTime?.[468]).toBe(274);

      expect(prepared.derived).toContain('stepLength');
      expect(easy.channels).not.toContain('stepLength');

      const strides: number[] = [];
      const stepLength = prepared.series.stepLength ?? [];
      const speed = prepared.series.speed ?? [];
      for (let i = 0; i < prepared.t.length; i++) {
        const stride = stepLength[i];
        const v = speed[i];
        if (stride !== null && stride !== undefined && v !== null && v !== undefined && v >= 2) strides.push(stride);
      }
      expect(strides.length).toBeGreaterThan(1000);
      const strideMedian = median(strides);
      expect(strideMedian).toBeGreaterThanOrEqual(1.2);
      expect(strideMedian).toBeLessThanOrEqual(1.4);

      for (const lap of easy.laps.filter((lap) => lap.index >= 1 && lap.index <= 5)) {
        const paces: number[] = [];
        const pace = prepared.series.pace ?? [];
        for (let i = 0; i < prepared.t.length; i++) {
          const t = prepared.t[i]!;
          if (t < lap.startT || t >= lap.endT || prepared.paused[i]) continue;
          const value = pace[i];
          if (value !== null && value !== undefined) paces.push(value);
        }
        expect(paces.length).toBeGreaterThan(30);
        const avg = paces.reduce((sum, value) => sum + value, 0) / paces.length;
        expect(avg).toBeGreaterThanOrEqual(260);
        expect(avg).toBeLessThanOrEqual(320);
      }

      for (const series of Object.values(prepared.series)) {
        expect(series).toHaveLength(prepared.t.length);
      }
      expect(prepared.paused).toHaveLength(prepared.t.length);
    });

    it('sets cycling efficiency to power per beat', () => {
      const ride = loadFixture('cycling-synthetic.json');
      const prepared = prepare(ride);
      const power = prepared.series.power ?? [];
      const hr = prepared.series.heartRate ?? [];
      const efficiency = prepared.series.efficiency ?? [];
      let checked = 0;
      for (let i = 0; i < prepared.t.length; i++) {
        const watts = power[i];
        const bpm = hr[i];
        if (watts === null || watts === undefined || bpm === null || bpm === undefined || bpm === 0) continue;
        expect(efficiency[i]).toBeCloseTo(watts / bpm, 8);
        checked++;
      }
      expect(checked).toBeGreaterThan(1000);
      expect(prepared.series.pace).toBeUndefined();
      expect(prepared.available).toContain('power');
      expect(prepared.available).toContain('efficiency');
    });

    it('fills pool lengths and pace per 100 m on the synthetic swim', () => {
      const swim = loadFixture('swim-synthetic.json');
      const prepared = prepare(swim);
      expect(prepared.t).toHaveLength(862);
      expect(prepared.t[861]).toBe(861);

      expect(prepared.series.heartRate?.[0]).toBe(112);
      expect(prepared.series.heartRate?.[22]).toBe(112);
      expect(prepared.series.speed?.[10]).toBe(1.114);
      expect(prepared.series.pace100m?.[10]).toBeCloseTo(100 / 1.114, 6);
      expect(prepared.series.heartRate?.[23]).toBe(122);

      for (let t = 177; t < 206; t++) {
        expect(prepared.paused[t]).toBe(true);
        expect(prepared.series.heartRate?.[t]).toBeNull();
        expect(prepared.series.speed?.[t]).toBeNull();
        expect(prepared.series.distance?.[t]).toBe(200);
        expect(prepared.series.movingTime?.[t]).toBeCloseTo(176.7, 6);
      }
      expect(prepared.paused[176]).toBe(false);
      expect(prepared.series.heartRate?.[176]).toBe(145);
      expect(prepared.series.movingTime?.[861]).toBeCloseTo(741, 6);
      expect(prepared.derived).toContain('pace100m');
      expect(prepared.derived).not.toContain('pace');
      expect(prepared.series.pace).toBeUndefined();
    });
  });
});
