import { describe, expect, it } from 'vitest';
import * as analytics from '../src/index.js';

// Guards the public API Track C depends on (docs/CONTRACTS.md §7.2).
// Track B: keep this file; add real behaviour tests next to it.
const API = [
  'prepare',
  'smooth',
  'windowStats',
  'segments',
  'relationship',
  'overlay',
  'activityLoad',
  'loadSeries',
  'readiness',
  'performanceHistory',
  'correlations',
  'suggestions',
] as const;

describe('@pacelab/analytics public API', () => {
  it.each(API)('exports %s as a function', (name) => {
    expect(typeof (analytics as Record<string, unknown>)[name]).toBe('function');
  });
});
