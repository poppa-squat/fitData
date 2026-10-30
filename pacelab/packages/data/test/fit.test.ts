import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { Encoder, Profile, type Encodable, type FieldValue, type Mesg } from '@garmin/fitsdk';
import activitySchema from '@pacelab/schema/json-schema/activity.schema.json';
import { checkActivityInvariants, type Activity } from '@pacelab/schema';
import { detectFormat, importActivityFile, UnsupportedFileError } from '../src/index.js';

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const expected = JSON.parse(readFileSync(root('fixtures/canonical/easy-run.json'), 'utf8')) as Activity;
const fitBytes = new Uint8Array(readFileSync(root('fixtures/fit/easy-run.sanitized.fit')));
const validateActivity = new Ajv2020().compile<Activity>(activitySchema);

function writeFitMessage(encoder: Encoder, name: string, fields: Record<string, FieldValue>): void {
  const mesgNum = Profile.MesgNum[name];
  if (mesgNum === undefined) throw new Error(`FIT SDK does not define message ${name}`);
  encoder.writeMesg({ mesgNum, ...fields } as Encodable<Mesg>);
}

function makeFitActivity(sport: string, sessionCount = 1, withSwimLengths = false): Uint8Array {
  const encoder = new Encoder();
  const startTime = 1137412800;
  writeFitMessage(encoder, 'FILE_ID', {
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    timeCreated: startTime,
  });
  writeFitMessage(encoder, 'RECORD', {
    timestamp: startTime,
    distance: 0,
    speed: 2,
  });
  writeFitMessage(encoder, 'RECORD', {
    timestamp: startTime + 25,
    distance: 50,
    speed: 2,
  });
  writeFitMessage(encoder, 'LAP', {
    messageIndex: 0,
    timestamp: startTime + 50,
    startTime,
    totalElapsedTime: 50,
    totalTimerTime: 50,
    lapTrigger: 'sessionEnd',
  });
  for (let index = 0; index < sessionCount; index++) {
    writeFitMessage(encoder, 'SESSION', {
      messageIndex: index,
      timestamp: startTime + 50,
      startTime: startTime + index * 100,
      totalElapsedTime: 50,
      totalTimerTime: 50,
      totalDistance: 50,
      sport: index === 0 ? sport : 'running',
      subSport: 'generic',
      ...(withSwimLengths ? { poolLength: 25, numLengths: 2 } : {}),
    });
  }
  if (withSwimLengths) {
    writeFitMessage(encoder, 'LENGTH', {
      messageIndex: 0,
      startTime,
      timestamp: startTime + 25,
      totalElapsedTime: 25,
      totalTimerTime: 25,
      totalStrokes: 12,
      swimStroke: 'freestyle',
      lengthType: 'active',
    });
    writeFitMessage(encoder, 'LENGTH', {
      messageIndex: 1,
      startTime: startTime + 25,
      timestamp: startTime + 50,
      totalElapsedTime: 25,
      totalTimerTime: 25,
      totalStrokes: 0,
      swimStroke: 'im',
      lengthType: 'idle',
    });
  }
  writeFitMessage(encoder, 'ACTIVITY', {
    timestamp: startTime + 50,
    totalTimerTime: 50,
    numSessions: sessionCount,
    localTimestamp: startTime + 50,
  });
  return encoder.close();
}

const toleranceFor = (key: string) => {
  if (key === 'lat' || key === 'lon') return 1e-6;
  if (key === 'speed' || key === 'avgSpeed') return 0.002;
  if (key === 'altitude') return 0.25;
  if (key === 'distance' || key === 'distanceM') return 0.02;
  if (key === 'cadence') return 0.02;
  if (key === 't' || key === 'startT' || key === 'endT' || key.endsWith('TimeS')) return 0.002;
  return 0;
};

function expectWithinContract(actual: unknown, reference: unknown, path = '$'): void {
  if (typeof reference === 'number' && typeof actual === 'number') {
    const key = path.slice(path.lastIndexOf('.') + 1).replace(/\[\d+\]$/, '');
    expect(Math.abs(actual - reference), path).toBeLessThanOrEqual(toleranceFor(key));
    return;
  }
  if (Array.isArray(reference)) {
    expect(Array.isArray(actual), path).toBe(true);
    expect(actual).toHaveLength(reference.length);
    reference.forEach((value, index) => expectWithinContract((actual as unknown[])[index], value, `${path}[${index}]`));
    return;
  }
  if (reference !== null && typeof reference === 'object') {
    expect(actual).not.toBeNull();
    expect(typeof actual).toBe('object');
    const expectedObject = reference as Record<string, unknown>;
    const actualObject = actual as Record<string, unknown>;
    const ignored = (key: string) => path === '$.source' && (key === 'device' || key === 'importedAt');
    const keys = Object.keys(expectedObject).filter((key) => !ignored(key));
    expect(Object.keys(actualObject).filter((key) => !ignored(key)).sort()).toEqual(keys.sort());
    for (const key of keys) expectWithinContract(actualObject[key], expectedObject[key], `${path}.${key}`);
    return;
  }
  expect(actual, path).toEqual(reference);
}

describe('FIT import', () => {
  it('detects FIT from its header before considering the extension', () => {
    expect(detectFormat('activity.bin', fitBytes)).toBe('fit');
  });

  it('detects GPX and TCX from their XML roots, then falls back to the extension', () => {
    const encode = (text: string) => new TextEncoder().encode(text);

    expect(detectFormat('activity.txt', encode('<?xml version="1.0"?><gpx version="1.1"></gpx>'))).toBe('gpx');
    expect(detectFormat('activity.txt', encode('<TrainingCenterDatabase></TrainingCenterDatabase>'))).toBe('tcx');
    expect(detectFormat('activity.FIT', new Uint8Array([0]))).toBe('fit');
  });

  it('imports the golden FIT within contract tolerances, invariants, and JSON Schema', async () => {
    const actual = await importActivityFile(fitBytes, 'easy-run.sanitized.fit', {
      importedAt: expected.source.importedAt,
    });

    expectWithinContract(actual, expected);
    expect(checkActivityInvariants(actual)).toEqual([]);
    expect(validateActivity(actual), JSON.stringify(validateActivity.errors)).toBe(true);
  });

  it('rejects corrupt FIT data with a readable UnsupportedFileError', async () => {
    const corrupt = new Uint8Array(12);
    corrupt.set([0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2e, 0x46, 0x49, 0x54]);

    await expect(importActivityFile(corrupt, 'corrupt.fit')).rejects.toMatchObject({
      name: 'UnsupportedFileError',
      message: expect.stringMatching(/fit|decode|corrupt/i),
    });
  });

  it('rejects unsupported files with a readable UnsupportedFileError', async () => {
    await expect(importActivityFile(new Uint8Array([1, 2, 3]), 'activity.png')).rejects.toBeInstanceOf(
      UnsupportedFileError,
    );
  });

  it('uses the first session and handles missing GPS and heart rate with unknown sports', async () => {
    const activity = await importActivityFile(makeFitActivity('standUpPaddleboarding', 2), 'unknown-sport.fit');

    expect(activity.sport).toBe('other');
    expect(activity.channels).not.toContain('heartRate');
    expect(activity.channels).not.toContain('lat');
    expect(activity.channels).not.toContain('lon');
    expect(activity.hasGps).toBe(false);
    expect(activity.startTime).toBe('2026-01-15T12:00:00Z');
  });

  it('imports pool length records including idle lengths', async () => {
    const activity = await importActivityFile(makeFitActivity('swimming', 1, true), 'pool-swim.fit');

    expect(activity.poolLengthM).toBe(25);
    expect(activity.swimLengths).toEqual([
      { index: 0, startT: 0, endT: 25, strokes: 12, stroke: 'freestyle', idle: false },
      { index: 1, startT: 25, endT: 50, strokes: 0, stroke: 'im', idle: true },
    ]);
  });
});
