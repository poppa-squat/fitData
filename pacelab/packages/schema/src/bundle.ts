/**
 * Published data layout + encryption envelope. CONTRACT — see docs/CONTRACTS.md §5.
 *
 * Static site layout (served by GitHub Pages from the `data` branch, see docs/CONTRACTS.md §5.1):
 *
 *   data/profiles.json                          ProfilesFile (plaintext)
 *   data/<profileId>/keyinfo.json               KeyInfo (plaintext)
 *   data/<profileId>/index.enc                  encrypted IndexPayload
 *   data/<profileId>/activities/<file>.enc      encrypted Activity, <file> = activityFileName(id)
 */
import type { ActivitySummary, SCHEMA_VERSION } from './activity.js';
import type { DailyWellness } from './wellness.js';

export interface ProfileEntry {
  /** lower-kebab-case, [a-z0-9-], used in paths and secret names. */
  id: string;
  displayName: string;
}

export interface ProfilesFile {
  schemaVersion: typeof SCHEMA_VERSION;
  profiles: ProfileEntry[];
}

export interface KeyInfo {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** base64, 16 random bytes, fixed per profile. */
  salt: string;
}

export interface IndexPayload {
  schemaVersion: typeof SCHEMA_VERSION;
  profileId: string;
  /** ISO-8601 UTC. */
  generatedAt: string;
  /** Newest first. */
  activities: ActivitySummary[];
  /** Ascending by date. */
  wellness: DailyWellness[];
}

/** 4-byte magic at the start of every .enc file. ASCII "PLB1". */
export const ENVELOPE_MAGIC = [0x50, 0x4c, 0x42, 0x31] as const;
export const ENVELOPE_IV_BYTES = 12;
export const ENVELOPE_TAG_BYTES = 16;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

/** Maps an activity id to its file name. Must match C# BundlePaths.ActivityFileName. */
export function activityFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_') + '.enc';
}
