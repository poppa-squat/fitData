import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import activitySchema from '@pacelab/schema/json-schema/activity.schema.json';
import { checkActivityInvariants, type Activity } from '@pacelab/schema';
import { importActivityFile } from '../src/index.js';

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const validateActivity = new Ajv2020().compile<Activity>(activitySchema);

const cases = [
  {
    name: 'GPX track points and Garmin extensions',
    file: 'fixtures/gpx/easy-run.synthetic.gpx',
    expected: 'fixtures/canonical/easy-run-gpx-synthetic.json',
  },
  {
    name: 'TCX laps and track points',
    file: 'fixtures/tcx/easy-run.synthetic.tcx',
    expected: 'fixtures/canonical/easy-run-tcx-synthetic.json',
  },
];

describe('GPX and TCX import', () => {
  for (const testCase of cases) {
    it(`imports ${testCase.name} to its canonical fixture`, async () => {
      const bytes = new Uint8Array(readFileSync(root(testCase.file)));
      const expected = JSON.parse(readFileSync(root(testCase.expected), 'utf8')) as Activity;
      const actual = await importActivityFile(bytes, testCase.file.split('/').at(-1)!, {
        importedAt: expected.source.importedAt,
      });

      expect(actual).toEqual(expected);
      expect(checkActivityInvariants(actual)).toEqual([]);
      expect(validateActivity(actual), JSON.stringify(validateActivity.errors)).toBe(true);
    });
  }
});
