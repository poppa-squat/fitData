/**
 * @pacelab/data — everything that gets data INTO the browser. Owner: Track A.
 *
 * The exported names and signatures below are the CONTRACT that Track C codes
 * against (docs/CONTRACTS.md §7.1). Track A replaces the stubs with real
 * implementations; changing a signature follows docs/CONTRACTS.md §8.
 */
import type { Activity, IndexPayload, ProfileEntry } from '@pacelab/schema';

export * from './crypto.js';

const notImplemented = (name: string): never => {
  throw new Error(`@pacelab/data: ${name} not implemented yet (Track A)`);
};

// ---------------------------------------------------------------- importers

export type ImportFormat = 'fit' | 'gpx' | 'tcx';

/** Sniffs FIT header bytes (".FIT" at offset 8) first, then XML root element, then extension. */
export function detectFormat(fileName: string, bytes: Uint8Array): ImportFormat | null {
  void fileName;
  void bytes;
  return notImplemented('detectFormat');
}

export interface ImportOptions {
  /** Defaults to now. Tests pass a fixed value. */
  importedAt?: string;
}

/**
 * Decode a dropped/selected file into a canonical Activity (provider "file",
 * id "file:<sha256-16>"). Throws `UnsupportedFileError` for anything else.
 */
export async function importActivityFile(bytes: Uint8Array, fileName: string, opts?: ImportOptions): Promise<Activity> {
  void bytes;
  void fileName;
  void opts;
  return notImplemented('importActivityFile');
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

// ---------------------------------------------------------------- sources

/** Read-only view of one profile's data, wherever it lives. */
export interface ProfileDataSource {
  readonly profileId: string;
  loadIndex(): Promise<IndexPayload>;
  /** Rejects with ActivityNotFoundError if the id is unknown. */
  loadActivity(id: string): Promise<Activity>;
}

export class ActivityNotFoundError extends Error {
  constructor(id: string) {
    super(`Activity not found: ${id}`);
    this.name = 'ActivityNotFoundError';
  }
}

/** Reads `${baseUrl}/data/profiles.json`. Returns [] if the file is missing (no sync set up yet). */
export async function listRemoteProfiles(baseUrl: string): Promise<ProfileEntry[]> {
  void baseUrl;
  return notImplemented('listRemoteProfiles');
}

/**
 * Fetches keyinfo, derives the key, decrypts index.enc. Rejects with
 * WrongPassphraseError on a bad passphrase. Activities are fetched lazily and cached.
 */
export async function openRemoteProfile(baseUrl: string, profileId: string, passphrase: string): Promise<ProfileDataSource> {
  void baseUrl;
  void profileId;
  void passphrase;
  return notImplemented('openRemoteProfile');
}

/** Browser-only store (IndexedDB) for dropped files. profileId is always "local". */
export interface LocalStore extends ProfileDataSource {
  /** Returns 'duplicate' (and stores nothing) if an activity with the same sport and startTime (±5 s) exists. */
  putActivity(activity: Activity): Promise<'added' | 'duplicate'>;
  deleteActivity(id: string): Promise<void>;
  clear(): Promise<void>;
}

export async function openLocalStore(): Promise<LocalStore> {
  return notImplemented('openLocalStore');
}

/**
 * Combine sources into one view (e.g. remote profile + local drops).
 * Duplicates (same sport, startTime within ±5 s) keep the first source's copy,
 * so pass API-backed sources first. Wellness is merged per date, earlier sources win per field.
 */
export function mergeSources(profileId: string, ...sources: ProfileDataSource[]): ProfileDataSource {
  void profileId;
  void sources;
  return notImplemented('mergeSources');
}
