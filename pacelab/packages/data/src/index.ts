/**
 * @pacelab/data — everything that gets data INTO the browser. Owner: Track A.
 *
 * The exported names and signatures below are the CONTRACT that Track C codes
 * against (docs/CONTRACTS.md §7.1). Track A replaces the stubs with real
 * implementations; changing a signature follows docs/CONTRACTS.md §8.
 */
import type { Activity, IndexPayload, ProfileEntry } from '@pacelab/schema';
import { RAW_CHANNEL_KEYS, type RawChannelKey } from '@pacelab/schema';
import {
  Decoder,
  Stream,
  type ActivityMesg,
  type FileIdMesg,
  type FitMessages,
  type LapMesg,
  type LengthMesg,
  type SessionMesg,
} from '@garmin/fitsdk';

export * from './crypto.js';

const notImplemented = (name: string): never => {
  throw new Error(`@pacelab/data: ${name} not implemented yet (Track A)`);
};

// ---------------------------------------------------------------- importers

export type ImportFormat = 'fit' | 'gpx' | 'tcx';

/** Sniffs FIT header bytes (".FIT" at offset 8) first, then XML root element, then extension. */
export function detectFormat(fileName: string, bytes: Uint8Array): ImportFormat | null {
  if (bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54) {
    return 'fit';
  }

  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const root = text.replace(/^\uFEFF/, '').match(/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<([A-Za-z_][\w:.-]*)\b/i)?.[1];
  if (root?.toLowerCase() === 'gpx') return 'gpx';
  if (root?.toLowerCase() === 'trainingcenterdatabase') return 'tcx';

  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return extension === 'fit' || extension === 'gpx' || extension === 'tcx' ? extension : null;
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
  const format = detectFormat(fileName, bytes);
  if (format !== 'fit') {
    throw new UnsupportedFileError(format ? `The ${format.toUpperCase()} importer is not available yet` : `Unsupported activity file: ${fileName}`);
  }

  try {
    const stream = Stream.fromByteArray(Array.from(bytes));
    const decoder = new Decoder(stream);
    if (!decoder.isFIT() || !decoder.checkIntegrity()) {
      throw new UnsupportedFileError('The FIT file header or checksum is invalid');
    }

    const { messages, errors } = decoder.read({ convertDateTimesToDates: false });
    if (errors.length > 0) {
      throw new UnsupportedFileError(`Could not decode FIT file: ${errors.map((error) => error.message).join('; ')}`);
    }

    return await convertFitMessages(messages, bytes, opts?.importedAt ?? new Date().toISOString());
  } catch (error) {
    if (error instanceof UnsupportedFileError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new UnsupportedFileError(`Could not decode FIT file: ${detail}`);
  }
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

const FIT_EPOCH_UNIX = 631065600;
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;
const supportedSports = new Set(['running', 'cycling', 'swimming', 'walking', 'hiking']);
const lapTriggers: Record<string, Activity['laps'][number]['trigger']> = {
  manual: 'manual',
  time: 'time',
  distance: 'distance',
  session_end: 'session_end',
  position_start: 'position',
  position_lap: 'position',
  position_waypoint: 'position',
  position_marked: 'position',
};
const intensities = new Set(['warmup', 'active', 'interval', 'rest', 'recovery', 'cooldown', 'other']);
const swimStrokes = new Set(['freestyle', 'backstroke', 'breaststroke', 'butterfly', 'drill', 'mixed', 'im']);

function round(value: number | undefined, decimals = 3): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstNumber(...values: (number | undefined)[]): number | undefined {
  return values.find((value) => value !== undefined);
}

function fitTimestampToIso(timestamp: number): string {
  return new Date((timestamp + FIT_EPOCH_UNIX) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toSnakeCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function sortedByTimestamp<T>(messages: T[], getTimestamp: (message: T) => unknown): T[] {
  return [...messages].sort(
    (a, b) => (asNumber(getTimestamp(a)) ?? 0) - (asNumber(getTimestamp(b)) ?? 0),
  );
}

async function convertFitMessages(messages: FitMessages, bytes: Uint8Array, importedAt: string): Promise<Activity> {
    const session: SessionMesg | undefined = messages.sessionMesgs?.[0];
    const startTime = asNumber(session?.startTime);
    const elapsedTimeS = asNumber(session?.totalElapsedTime);
    const movingTimeS = asNumber(session?.totalTimerTime);
    if (!session || startTime === undefined || elapsedTimeS === undefined || movingTimeS === undefined) {
      throw new UnsupportedFileError('The FIT file does not contain a complete activity session');
    }

    const sportRaw = String(session.sport ?? 'generic');
    const sport = (supportedSports.has(sportRaw) ? sportRaw : 'other') as Activity['sport'];
    const subSport = toSnakeCase(String(session.subSport ?? 'generic'));
    const records = sortedByTimestamp(messages.recordMesgs ?? [], (record) => record.timestamp);
    const samplesT: number[] = [];
    const columns: Record<RawChannelKey, (number | null)[]> = {
      heartRate: [],
      speed: [],
      distance: [],
      altitude: [],
      lat: [],
      lon: [],
      cadence: [],
      power: [],
      temperature: [],
      respirationRate: [],
      stepLength: [],
      verticalOscillation: [],
      groundContactTime: [],
      verticalRatio: [],
      gctBalance: [],
    };
    let lastT: number | undefined;

    for (const record of records) {
      const timestamp = asNumber(record.timestamp);
      if (timestamp === undefined) continue;
      const t = timestamp - startTime;
      if (lastT !== undefined && t <= lastT) continue;
      lastT = t;
      samplesT.push(t);

      const cadence = asNumber(record.cadence);
      const cadenceValue =
        cadence === undefined
          ? null
          : round(
              sport === 'running' || sport === 'walking' || sport === 'hiking'
                ? 2 * (cadence + (asNumber(record.fractionalCadence) ?? 0))
                : cadence,
            ) ?? null;
      const latitude = asNumber(record.positionLat);
      const longitude = asNumber(record.positionLong);
      const stepLength = asNumber(record.stepLength);
      const verticalOscillation = asNumber(record.verticalOscillation);
      const stanceTime = asNumber(record.stanceTime);
      const values: Record<RawChannelKey, number | null> = {
        heartRate: asNumber(record.heartRate) ?? null,
        speed: round(firstNumber(asNumber(record.enhancedSpeed), asNumber(record.speed))) ?? null,
        distance: round(asNumber(record.distance), 2) ?? null,
        altitude: round(firstNumber(asNumber(record.enhancedAltitude), asNumber(record.altitude)), 2) ?? null,
        lat: latitude === undefined ? null : round(latitude * SEMICIRCLES_TO_DEGREES, 7) ?? null,
        lon: longitude === undefined ? null : round(longitude * SEMICIRCLES_TO_DEGREES, 7) ?? null,
        cadence: cadenceValue,
        power: asNumber(record.power) ?? null,
        temperature: asNumber(record.temperature) ?? null,
        respirationRate:
          round(firstNumber(asNumber(record.enhancedRespirationRate), asNumber(record.respirationRate)), 2) ?? null,
        stepLength: round(stepLength === undefined ? undefined : stepLength / 1000, 4) ?? null,
        verticalOscillation: round(verticalOscillation === undefined ? undefined : verticalOscillation / 1000, 4) ?? null,
        groundContactTime: round(stanceTime === undefined ? undefined : stanceTime / 1000, 4) ?? null,
        verticalRatio: round(asNumber(record.verticalRatio), 2) ?? null,
        gctBalance: round(asNumber(record.stanceTimeBalance), 2) ?? null,
      };
      for (const key of RAW_CHANNEL_KEYS) columns[key].push(values[key]);
    }

    const channelData: Partial<Record<RawChannelKey, (number | null)[]>> = {};
    for (const key of RAW_CHANNEL_KEYS) {
      if (columns[key].some((value) => value !== null)) channelData[key] = columns[key];
    }

    const pauses: Activity['pauses'] = [];
    let stoppedAt: number | undefined;
    for (const event of sortedByTimestamp(messages.eventMesgs ?? [], (item) => item.timestamp)) {
      if (event.event !== 'timer') continue;
      const timestamp = asNumber(event.timestamp);
      if (timestamp === undefined) continue;
      if ((event.eventType === 'stop' || event.eventType === 'stopAll') && stoppedAt === undefined) {
        stoppedAt = timestamp - startTime;
      } else if (event.eventType === 'start' && stoppedAt !== undefined) {
        pauses.push({ startT: stoppedAt, endT: timestamp - startTime });
        stoppedAt = undefined;
      }
    }

    const laps = sortedByTimestamp(messages.lapMesgs ?? [], (lap) => lap.startTime).flatMap((lap: LapMesg, index) => {
      const lapStart = asNumber(lap.startTime);
      const elapsed = asNumber(lap.totalElapsedTime);
      const timer = asNumber(lap.totalTimerTime);
      if (lapStart === undefined || elapsed === undefined || timer === undefined) return [];
      const result: Activity['laps'][number] = {
        index,
        startT: lapStart - startTime,
        endT: round(lapStart - startTime + elapsed) ?? 0,
        movingTimeS: round(timer) ?? 0,
        trigger: lapTriggers[toSnakeCase(String(lap.lapTrigger ?? ''))] ?? 'other',
      };
      const distance = round(asNumber(lap.totalDistance), 2);
      const avgHr = asNumber(lap.avgHeartRate);
      const maxHr = asNumber(lap.maxHeartRate);
      const avgSpeed = round(firstNumber(asNumber(lap.enhancedAvgSpeed), asNumber(lap.avgSpeed)));
      const workoutStepIndex = asNumber(lap.wktStepIndex);
      if (distance !== undefined) result.distanceM = distance;
      if (avgHr !== undefined) result.avgHr = avgHr;
      if (maxHr !== undefined) result.maxHr = maxHr;
      if (avgSpeed !== undefined) result.avgSpeed = avgSpeed;
      if (workoutStepIndex !== undefined) result.workoutStepIndex = workoutStepIndex;
      const intensity = String(lap.intensity ?? '');
      if (intensities.has(intensity)) result.intensity = intensity as Activity['laps'][number]['intensity'];
      return [result];
    });

    const swimLengths = sortedByTimestamp(messages.lengthMesgs ?? [], (length) => length.startTime).flatMap((length: LengthMesg, index) => {
      const lengthStart = asNumber(length.startTime);
      const elapsed = asNumber(length.totalElapsedTime);
      if (lengthStart === undefined || elapsed === undefined) return [];
      const stroke = String(length.swimStroke ?? '');
      const item: NonNullable<Activity['swimLengths']>[number] = {
        index,
        startT: lengthStart - startTime,
        endT: round(lengthStart - startTime + elapsed) ?? 0,
        stroke: swimStrokes.has(stroke) ? (stroke as NonNullable<Activity['swimLengths']>[number]['stroke']) : 'unknown',
        idle: length.lengthType === 'idle',
      };
      const strokes = asNumber(length.totalStrokes);
      if (strokes !== undefined) item.strokes = strokes;
      return [item];
    });

    const activity: ActivityMesg | undefined = messages.activityMesgs?.[0];
    const localTimestamp = asNumber(activity?.localTimestamp);
    const activityTimestamp = asNumber(activity?.timestamp);
    const timezoneOffsetMin =
      localTimestamp !== undefined && activityTimestamp !== undefined
        ? Math.round((localTimestamp - activityTimestamp) / 60)
        : undefined;
    const sessionDistance = round(asNumber(session.totalDistance), 2);
    const avgHr = asNumber(session.avgHeartRate);
    const maxHr = asNumber(session.maxHeartRate);
    const ascent = asNumber(session.totalAscent);
    const descent = asNumber(session.totalDescent);
    const calories = asNumber(session.totalCalories);
    const poolLength = asNumber(session.poolLength);
    const fileId: FileIdMesg | undefined = messages.fileIdMesgs?.[0];
    const device = [fileId?.manufacturer, fileId?.garminProduct ?? fileId?.product]
      .filter((part) => part !== undefined && part !== null)
      .join(' ');
    const isoImportedAt = importedAt.replace(/\.\d{3}Z$/, 'Z');
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource));

    const result: Activity = {
      id: `file:${Array.from(digest.subarray(0, 8))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')}`,
      schemaVersion: 1,
      sport,
      subSport,
      startTime: fitTimestampToIso(startTime),
      elapsedTimeS: round(elapsedTimeS) ?? elapsedTimeS,
      movingTimeS: round(movingTimeS) ?? movingTimeS,
      hasGps: Boolean(channelData.lat?.some((value) => value !== null)),
      channels: RAW_CHANNEL_KEYS.filter((key) => channelData[key] !== undefined),
      source: { provider: 'file', format: 'fit', ...(device ? { device } : {}), importedAt: isoImportedAt },
      samples: { t: samplesT, channels: channelData },
      pauses,
      laps,
    };
    if (timezoneOffsetMin !== undefined) result.timezoneOffsetMin = timezoneOffsetMin;
    if (sessionDistance !== undefined) result.distanceM = sessionDistance;
    if (avgHr !== undefined) result.avgHr = avgHr;
    if (maxHr !== undefined) result.maxHr = maxHr;
    if (ascent !== undefined) result.ascentM = ascent;
    if (descent !== undefined) result.descentM = descent;
    if (calories !== undefined) result.calories = calories;
    if (poolLength !== undefined) result.poolLengthM = poolLength;
    if (swimLengths.length > 0) result.swimLengths = swimLengths;
    return result;
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
