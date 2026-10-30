import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import activitySchema from '../json-schema/activity.schema.json' with { type: 'json' };
import wellnessSchema from '../json-schema/wellness.schema.json' with { type: 'json' };
import { checkActivityInvariants, activityFileName, RAW_CHANNEL_KEYS, CHANNEL_META, DERIVED_CHANNEL_KEYS } from '../src/index.js';
import type { Activity, IndexPayload } from '../src/index.js';

const fixture = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../fixtures/canonical/${name}`, import.meta.url)), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateActivity = ajv.compile(activitySchema);
const validateWellness = ajv.compile(wellnessSchema);
const summarySchema = {
  ...activitySchema,
  $id: activitySchema.$id.replace('activity.schema.json', 'activity-summary.schema.json'),
  required: activitySchema.required.filter((k) => !['samples', 'pauses', 'laps'].includes(k)),
};
const validateSummary = ajv.compile(summarySchema);

describe('full activity fixtures', () => {
  for (const name of ['easy-run.json', 'cycling-synthetic.json', 'swim-synthetic.json']) {
    it(`${name} matches JSON Schema and invariants`, () => {
      const a = fixture(name) as Activity;
      const ok = validateActivity(a);
      expect(validateActivity.errors ?? []).toEqual([]);
      expect(ok).toBe(true);
      expect(checkActivityInvariants(a)).toEqual([]);
    });
  }
});

describe('index fixture', () => {
  const idx = fixture('index-synthetic.json') as IndexPayload;
  it('summaries validate and are newest first', () => {
    for (const s of idx.activities) {
      expect(validateSummary(s), JSON.stringify(validateSummary.errors)).toBe(true);
    }
    const starts = idx.activities.map((a) => a.startTime);
    expect([...starts].sort().reverse()).toEqual(starts);
  });
  it('wellness validates, ascending, one per date', () => {
    for (const w of idx.wellness) expect(validateWellness(w), JSON.stringify(validateWellness.errors)).toBe(true);
    const dates = idx.wellness.map((w) => w.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe('contract helpers', () => {
  it('activityFileName is filesystem-safe', () => {
    expect(activityFileName('garmin:24645966519')).toBe('garmin_24645966519.enc');
    expect(activityFileName('file:4690877d3905222a')).toBe('file_4690877d3905222a.enc');
  });
  it('every channel has metadata', () => {
    for (const k of [...RAW_CHANNEL_KEYS, ...DERIVED_CHANNEL_KEYS]) expect(CHANNEL_META[k].key).toBe(k);
  });
  it('JSON Schema channel enum matches RAW_CHANNEL_KEYS', () => {
    expect(activitySchema.$defs.rawChannelKey.enum).toEqual([...RAW_CHANNEL_KEYS]);
  });
});
