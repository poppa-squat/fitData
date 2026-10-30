/**
 * Structural rules that JSON Schema can't express. Every importer's tests and
 * every fixture must pass these. Returns a list of problems (empty = valid).
 */
import { RAW_CHANNEL_KEYS } from './channels.js';
import type { Activity } from './activity.js';

export function checkActivityInvariants(a: Activity): string[] {
  const problems: string[] = [];
  const { t, channels, extra } = a.samples;

  for (let i = 1; i < t.length; i++) {
    if (!(t[i]! > t[i - 1]!)) {
      problems.push(`samples.t not strictly increasing at index ${i}`);
      break;
    }
  }
  const series = { ...channels, ...(extra ?? {}) } as Record<string, (number | null)[] | undefined>;
  for (const [key, arr] of Object.entries(series)) {
    if (!arr) continue;
    if (arr.length !== t.length) problems.push(`channel ${key} has ${arr.length} values, expected ${t.length}`);
    if (arr.some((v) => v !== null && !Number.isFinite(v))) problems.push(`channel ${key} contains NaN/Infinity`);
  }

  const nonEmpty = RAW_CHANNEL_KEYS.filter((k) => channels[k]?.some((v) => v !== null));
  const listed = [...a.channels].sort();
  if (JSON.stringify([...nonEmpty].sort()) !== JSON.stringify(listed)) {
    problems.push(`summary.channels ${JSON.stringify(listed)} != non-empty channels ${JSON.stringify(nonEmpty)}`);
  }
  if (a.hasGps !== Boolean(channels.lat?.some((v) => v !== null))) problems.push('hasGps does not match lat channel');
  if (a.movingTimeS > a.elapsedTimeS + 1) problems.push('movingTimeS > elapsedTimeS');

  for (const p of a.pauses) if (p.endT < p.startT) problems.push(`pause ${p.startT}-${p.endT} ends before it starts`);
  a.laps.forEach((l, i) => {
    if (l.index !== i) problems.push(`lap index ${l.index} at position ${i}`);
    if (l.endT < l.startT) problems.push(`lap ${i} ends before it starts`);
  });
  a.swimLengths?.forEach((l, i) => {
    if (l.index !== i) problems.push(`swim length index ${l.index} at position ${i}`);
    if (l.endT < l.startT) problems.push(`swim length ${i} ends before it starts`);
  });
  if (a.sport === 'swimming' && a.subSport === 'lap_swimming' && !a.poolLengthM) problems.push('pool swim without poolLengthM');
  return problems;
}
