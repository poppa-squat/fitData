import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Activity, AthleteSettings, ChannelKey } from '@pacelab/schema';
import type { PreparedActivity } from '../src/types.js';
import { prepare, windowStats } from '../src/index.js';

const settingsMax: AthleteSettings = {
  maxHr: 200,
  restingHr: 60,
  zoneMethod: 'percentMax',
  zoneUpperBounds: [0.5, 0.6, 0.7, 0.8],
};

function loadFixture(name: string): Activity {
  const path = fileURLToPath(new URL(`../../../fixtures/canonical/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Activity;
}

function prepared(opts: {
  sport?: Activity['sport'];
  t: number[];
  resampleS?: number;
  series: PreparedActivity['series'];
  paused?: boolean[];
  swimLengths?: Activity['swimLengths'];
  derived?: ChannelKey[];
}): PreparedActivity {
  const resampleS = opts.resampleS ?? 1;
  const n = opts.t.length;
  const paused = opts.paused ?? opts.t.map(() => false);
  const series = opts.series;
  const available = (Object.keys(series) as ChannelKey[]).filter((key) =>
    series[key]?.some((value) => typeof value === 'number' && Number.isFinite(value)),
  );
  const activity = {
    id: 'file:handbuilt',
    schemaVersion: 1 as const,
    sport: opts.sport ?? 'running',
    subSport: 'generic',
    startTime: '2026-01-15T12:00:00Z',
    elapsedTimeS: opts.t[n - 1] ?? 0,
    movingTimeS: opts.t[n - 1] ?? 0,
    hasGps: false,
    channels: [],
    source: { provider: 'file' as const, format: 'json' as const, importedAt: '2026-01-15T13:00:00Z' },
    samples: { t: opts.t, channels: {} },
    pauses: [],
    laps: [],
    ...(opts.swimLengths ? { swimLengths: opts.swimLengths } : {}),
  } satisfies Activity;
  return {
    activity,
    t: opts.t,
    resampleS,
    series,
    paused,
    derived: opts.derived ?? [],
    available,
  };
}

describe('windowStats', () => {
  it('reports elapsed time, moving time, distance, and channel stats with paused samples left out', () => {
    const speed = [0, 1, 2, 3, 4, 5];
    const distance = [0, 2, 4, 6, 8, 10];
    const heartRate = [90, 110, 190, 190, 150, 170];
    const stats = windowStats(
      prepared({
        t: [0, 1, 2, 3, 4, 5],
        series: { speed, distance, heartRate },
        paused: [false, false, true, true, false, false],
      }),
      { startT: 0, endT: 5 },
      settingsMax,
    );

    expect(stats.elapsedS).toBe(5);
    expect(stats.movingS).toBe(3);
    expect(stats.distanceM).toBe(8);
    expect(stats.window).toEqual({ startT: 0, endT: 5 });

    const speedStats = stats.channels.speed;
    expect(speedStats).toMatchObject({
      n: 3,
      coverage: 1,
      mean: 5 / 3,
      min: 0,
      max: 4,
    });
    expect(speedStats?.std).toBeCloseTo(Math.sqrt(26 / 9), 8);
    expect(speedStats?.p10).toBeCloseTo(0.2, 8);
    expect(speedStats?.p50).toBe(1);
    expect(speedStats?.p90).toBeCloseTo(3.4, 8);
    expect(speedStats?.slopePerMin).toBeCloseTo(60, 8);

    expect(stats.hrZoneS).toEqual([1, 1, 0, 1, 0]);
    expect(stats.drift).toBeNull();
    expect(stats.power).toBeUndefined();
    expect(stats.swim).toBeUndefined();
  });

  it('uses linear percentiles, population standard deviation, and least-squares slope per minute', () => {
    const values = [0, 1, 2, 3, 4];
    const stats = windowStats(
      prepared({ t: [0, 1, 2, 3, 4], series: { speed: values } }),
      { startT: 0, endT: 5 },
      settingsMax,
    );
    expect(stats.channels.speed).toMatchObject({
      n: 5,
      coverage: 1,
      mean: 2,
      min: 0,
      max: 4,
      p50: 2,
    });
    expect(stats.channels.speed?.std).toBeCloseTo(Math.sqrt(2), 10);
    expect(stats.channels.speed?.p10).toBeCloseTo(0.4, 10);
    expect(stats.channels.speed?.p90).toBeCloseTo(3.6, 10);
    expect(stats.channels.speed?.slopePerMin).toBe(60);
  });

  it('counts a null as missing coverage and returns null stats for one sample', () => {
    const stats = windowStats(
      prepared({
        t: [0, 1, 2],
        series: { speed: [1, null, 3], heartRate: [100, 100, 100] },
      }),
      { startT: 0, endT: 3 },
      settingsMax,
    );
    expect(stats.channels.speed).toMatchObject({ n: 2, coverage: 2 / 3, mean: 2, std: 1 });
    expect(stats.channels.heartRate?.coverage).toBe(1);

    const single = windowStats(
      prepared({ t: [0], series: { speed: [4] } }),
      { startT: 0, endT: 1 },
      settingsMax,
    );
    expect(single.channels.speed).toMatchObject({
      n: 1,
      mean: 4,
      min: 4,
      max: 4,
      p10: 4,
      p50: 4,
      p90: 4,
      std: null,
      slopePerMin: null,
    });
  });

  it('builds heart-rate zones from percent of max, heart-rate reserve, and lactate threshold', () => {
    const heartRate = [70, 85, 95, 105, 120];
    const base = prepared({ t: [0, 1, 2, 3, 4], series: { heartRate } });

    const hrr = windowStats(base, { startT: 0, endT: 5 }, {
      maxHr: 160,
      restingHr: 50,
      zoneMethod: 'percentHrr',
      zoneUpperBounds: [0.25, 0.5, 0.75, 1],
    });
    // Thresholds: 77.5, 105, 132.5, 160. Values 70, 85, 95, 105, 120 → Z1, Z2, Z2, Z2, Z3.
    expect(hrr.hrZoneS).toEqual([1, 3, 1, 0, 0]);

    const lthr = windowStats(base, { startT: 0, endT: 5 }, {
      maxHr: 200,
      restingHr: 60,
      lthr: 100,
      zoneMethod: 'lthr',
      zoneUpperBounds: [0.8, 0.9, 1, 1.1],
    });
    // Thresholds: 80, 90, 100, 110. Values → Z1, Z2, Z3, Z4, Z5.
    expect(lthr.hrZoneS).toEqual([1, 1, 1, 1, 1]);

    const missing = windowStats(base, { startT: 0, endT: 5 }, {
      maxHr: 200,
      restingHr: 60,
      zoneMethod: 'lthr',
      zoneUpperBounds: [0.85, 0.89, 0.94, 1],
    });
    expect(missing.hrZoneS).toEqual([]);
  });

  it('scales zone time and moving time by the resample interval', () => {
    const stats = windowStats(
      prepared({
        t: [0, 2, 4],
        resampleS: 2,
        series: { heartRate: [80, 80, 80] },
      }),
      { startT: 0, endT: 6 },
      settingsMax,
    );
    expect(stats.movingS).toBe(6);
    expect(stats.hrZoneS).toEqual([6, 0, 0, 0, 0]);
  });

  it('computes aerobic decoupling from each half of moving time once the window has 10 minutes', () => {
    const n = 600;
    const heartRate = Array.from({ length: n }, (_, i) => (i < 300 ? 120 : 150));
    const speed = Array.from({ length: n }, () => 3);
    const stats = windowStats(
      prepared({ t: Array.from({ length: n }, (_, i) => i), series: { heartRate, speed } }),
      { startT: 0, endT: 600 },
      settingsMax,
    );
    expect(stats.movingS).toBe(600);
    expect(stats.drift?.basis).toBe('speed');
    expect(stats.drift?.firstHalfRatio).toBe(0.025);
    expect(stats.drift?.secondHalfRatio).toBe(0.02);
    expect(stats.drift?.decouplingPct).toBeCloseTo(20, 10);

    const short = windowStats(
      prepared({
        t: Array.from({ length: 599 }, (_, i) => i),
        series: {
          heartRate: Array.from({ length: 599 }, () => 120),
          speed: Array.from({ length: 599 }, () => 3),
        },
      }),
      { startT: 0, endT: 599 },
      settingsMax,
    );
    expect(short.drift).toBeNull();
  });

  it('uses power for cycling drift and grade-adjusted speed for a run with altitude', () => {
    const n = 600;
    const t = Array.from({ length: n }, (_, i) => i);
    const heartRate = Array.from({ length: n }, (_, i) => (i < 300 ? 100 : 120));
    const ride = windowStats(
      prepared({
        sport: 'cycling',
        t,
        series: {
          heartRate,
          power: Array.from({ length: n }, () => 200),
          speed: Array.from({ length: n }, () => 8),
        },
      }),
      { startT: 0, endT: 600 },
      { ...settingsMax, ftpW: 250 },
    );
    expect(ride.drift?.basis).toBe('power');
    expect(ride.drift?.firstHalfRatio).toBe(2);
    expect(ride.drift?.secondHalfRatio).toBeCloseTo(200 / 120, 10);
    expect(ride.drift?.decouplingPct).toBeCloseTo((2 - 200 / 120) / 2 * 100, 8);

    const run = prepare(
      {
        id: 'file:flat',
        schemaVersion: 1,
        sport: 'running',
        subSport: 'generic',
        startTime: '2026-01-15T12:00:00Z',
        elapsedTimeS: n - 1,
        movingTimeS: n - 1,
        hasGps: false,
        channels: ['heartRate', 'speed', 'distance', 'altitude'],
        source: { provider: 'file', format: 'json', importedAt: '2026-01-15T13:00:00Z' },
        samples: {
          t,
          channels: {
            heartRate,
            speed: Array.from({ length: n }, () => 4),
            distance: Array.from({ length: n }, (_, i) => i * 4),
            altitude: Array.from({ length: n }, () => 20),
          },
        },
        pauses: [],
        laps: [],
      },
      undefined,
    );
    const flat = windowStats(run, { startT: 0, endT: 600 }, settingsMax);
    expect(flat.drift?.basis).toBe('gapSpeed');
    expect(flat.drift?.firstHalfRatio).toBeCloseTo(4 / 100, 6);
    expect(flat.drift?.decouplingPct).toBeCloseTo((0.04 - 4 / 120) / 0.04 * 100, 4);
  });

  it('reports normalized power, intensity factor, and TSS for cycling with power', () => {
    const steady = windowStats(
      prepared({
        sport: 'cycling',
        t: Array.from({ length: 60 }, (_, i) => i),
        series: { power: Array.from({ length: 60 }, () => 200), heartRate: Array.from({ length: 60 }, () => 140) },
      }),
      { startT: 0, endT: 60 },
      { ...settingsMax, ftpW: 250 },
    );
    expect(steady.power).toEqual({
      normalizedW: 200,
      intensityFactor: 0.8,
      tss: (60 * 200 * 0.8) / (250 * 3600) * 100,
    });

    const varied = windowStats(
      prepared({
        sport: 'cycling',
        t: [0, 30],
        resampleS: 30,
        series: { power: [100, 300] },
      }),
      { startT: 0, endT: 60 },
      settingsMax,
    );
    // 30 s rolling window is one sample, so NP is the fourth-power mean of 100 and 300.
    expect(varied.power?.normalizedW).toBeCloseTo(253.043953, 4);
    expect(varied.power?.intensityFactor).toBeNull();
    expect(varied.power?.tss).toBeNull();

    const run = windowStats(
      prepared({ t: [0, 1], series: { power: [200, 200] } }),
      { startT: 0, endT: 2 },
      { ...settingsMax, ftpW: 250 },
    );
    expect(run.power).toBeUndefined();
  });

  it('averages SWOLF as length seconds plus strokes for swims', () => {
    const stats = windowStats(
      prepared({
        sport: 'swimming',
        t: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
        series: { speed: Array.from({ length: 30 }, () => 1) },
        swimLengths: [
          { index: 0, startT: 0, endT: 10, strokes: 10, stroke: 'freestyle', idle: false },
          { index: 1, startT: 10, endT: 20, strokes: 12, stroke: 'freestyle', idle: false },
          { index: 2, startT: 20, endT: 30, stroke: 'unknown', idle: true },
        ],
      }),
      { startT: 0, endT: 30 },
      settingsMax,
    );
    expect(stats.swim).toEqual({ lengths: 2, avgSwolf: 21, avgStrokesPerLength: 11 });

    const early = windowStats(
      prepared({
        sport: 'swimming',
        t: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        series: { speed: Array.from({ length: 10 }, () => 1) },
        swimLengths: [
          { index: 0, startT: 0, endT: 10, strokes: 10, stroke: 'freestyle', idle: false },
          { index: 1, startT: 10, endT: 20, strokes: 12, stroke: 'freestyle', idle: false },
        ],
      }),
      { startT: 0, endT: 10 },
      settingsMax,
    );
    expect(early.swim).toEqual({ lengths: 1, avgSwolf: 20, avgStrokesPerLength: 10 });
  });

  it('limits channel stats to the requested keys and does not mutate the activity', () => {
    const heartRate = [100, 110, 120];
    const speed = [3, 3, 3];
    const activity = prepared({ t: [0, 1, 2], series: { heartRate, speed } });
    const before = structuredClone(activity);
    const stats = windowStats(activity, { startT: 0, endT: 3 }, settingsMax, ['heartRate']);
    expect(Object.keys(stats.channels)).toEqual(['heartRate']);
    expect(activity).toEqual(before);
  });

  it('returns an empty window when the selection misses the grid', () => {
    const stats = windowStats(
      prepared({ t: [0, 1], series: { speed: [2, 2] } }),
      { startT: 10, endT: 12 },
      settingsMax,
    );
    expect(stats.elapsedS).toBe(2);
    expect(stats.movingS).toBe(0);
    expect(stats.distanceM).toBeNull();
    expect(stats.channels.speed).toMatchObject({ n: 0, coverage: 0, mean: null, slopePerMin: null });
    expect(stats.hrZoneS).toEqual([]);
    expect(stats.drift).toBeNull();
  });

  it('stays under 5 ms for a 30-minute window of a 2-hour 1 Hz activity', () => {
    const n = 7200;
    const t = Array.from({ length: n }, (_, i) => i);
    const channel = (scale: number) => Array.from({ length: n }, (_, i) => scale + (i % 17));
    const activity: Activity = {
      id: 'file:perf',
      schemaVersion: 1,
      sport: 'running',
      subSport: 'generic',
      startTime: '2026-01-15T12:00:00Z',
      elapsedTimeS: n - 1,
      movingTimeS: n - 1,
      hasGps: false,
      channels: ['heartRate', 'speed', 'distance', 'altitude', 'cadence', 'power', 'temperature', 'lat'],
      source: { provider: 'file', format: 'json', importedAt: '2026-01-15T13:00:00Z' },
      samples: {
        t,
        channels: {
          heartRate: channel(130),
          speed: channel(3),
          distance: t.map((i) => i * 3),
          altitude: channel(40),
          cadence: channel(170),
          power: channel(200),
          temperature: channel(18),
          lat: channel(40),
        },
      },
      pauses: [],
      laps: [],
    };
    const ready = prepare(activity);
    const window = { startT: 3600, endT: 5400 };
    for (let i = 0; i < 3; i++) windowStats(ready, window, settingsMax);
    const samples: number[] = [];
    for (let i = 0; i < 11; i++) {
      const started = performance.now();
      windowStats(ready, window, settingsMax);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const median = samples[5]!;
    expect(median).toBeLessThan(5);
    const once = windowStats(ready, window, settingsMax);
    expect(once.movingS).toBe(1800);
    expect(once.elapsedS).toBe(1800);
  });

  describe('fixtures', () => {
    it('keeps the easy run in a sane range', () => {
      const easy = prepare(loadFixture('easy-run.json'));
      const stats = windowStats(easy, { startT: 0, endT: 2904 }, settingsMax);
      expect(stats.elapsedS).toBe(2904);
      expect(stats.movingS).toBe(2710);
      expect(stats.distanceM).toBeGreaterThan(7500);
      expect(stats.distanceM).toBeLessThan(8500);
      expect(stats.channels.heartRate?.mean).toBeGreaterThan(140);
      expect(stats.channels.heartRate?.mean).toBeLessThan(170);
      expect(stats.channels.pace?.mean).toBeGreaterThan(250);
      expect(stats.channels.pace?.mean).toBeLessThan(450);
      expect(stats.hrZoneS).toHaveLength(5);
      expect(stats.hrZoneS.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(2000);
      expect(stats.drift?.basis).toBe('gapSpeed');
      expect(stats.drift?.decouplingPct).toBeGreaterThan(-30);
      expect(stats.drift?.decouplingPct).toBeLessThan(40);
      expect(stats.power).toBeUndefined();
      expect(stats.swim).toBeUndefined();
    });

    it('keeps the synthetic ride power block in a sane range', () => {
      const ride = prepare(loadFixture('cycling-synthetic.json'));
      const stats = windowStats(ride, { startT: 0, endT: 3600 }, { ...settingsMax, ftpW: 200 });
      expect(stats.power?.normalizedW).toBeGreaterThan(120);
      expect(stats.power?.normalizedW).toBeLessThan(280);
      expect(stats.power?.intensityFactor).toBeGreaterThan(0.5);
      expect(stats.power?.intensityFactor).toBeLessThan(1.5);
      expect(stats.power?.tss).toBeGreaterThan(20);
      expect(stats.drift?.basis).toBe('power');
      expect(stats.swim).toBeUndefined();
    });

    it('counts the synthetic swim lengths and a plausible SWOLF', () => {
      const swim = prepare(loadFixture('swim-synthetic.json'));
      const stats = windowStats(swim, { startT: 0, endT: 862 }, settingsMax);
      expect(stats.swim?.lengths).toBe(32);
      expect(stats.swim?.avgSwolf).toBeGreaterThan(25);
      expect(stats.swim?.avgSwolf).toBeLessThan(70);
      expect(stats.swim?.avgStrokesPerLength).toBeGreaterThan(10);
      expect(stats.swim?.avgStrokesPerLength).toBeLessThan(25);
      expect(stats.channels.pace100m?.mean).toBeGreaterThan(60);
      expect(stats.channels.pace100m?.mean).toBeLessThan(150);
      expect(stats.power).toBeUndefined();
    });
  });
});
