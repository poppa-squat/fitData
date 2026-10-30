import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Activity, ActivitySummary, DailyWellness, IndexPayload, KeyInfo, ProfilesFile } from '@pacelab/schema';
import { activityFileName } from '@pacelab/schema';
import {
  ActivityNotFoundError,
  deriveKey,
  encryptJson,
  listRemoteProfiles,
  mergeSources,
  openLocalStore,
  openRemoteProfile,
  type ProfileDataSource,
  WrongPassphraseError,
} from '../src/index.js';

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));
const easyRun = JSON.parse(readFileSync(root('fixtures/canonical/easy-run.json'), 'utf8')) as Activity;
const fixtureIndex = JSON.parse(readFileSync(root('fixtures/canonical/index-synthetic.json'), 'utf8')) as IndexPayload;
const keyInfo = JSON.parse(readFileSync(root('fixtures/crypto/keyinfo.json'), 'utf8')) as KeyInfo;
const passphrase = 'correct horse battery staple';

function toSummary(activity: Activity): ActivitySummary {
  const { samples: _samples, pauses: _pauses, laps: _laps, swimLengths: _swimLengths, ...summary } = activity;
  return summary;
}

function indexFor(profileId: string, activities: ActivitySummary[], wellness: DailyWellness[] = []): IndexPayload {
  return {
    schemaVersion: 1,
    profileId,
    generatedAt: '2026-02-01T00:00:00Z',
    activities,
    wellness,
  };
}

function testSource(profileId: string, index: IndexPayload, activities: Activity[]): ProfileDataSource {
  const byId = new Map(activities.map((activity) => [activity.id, activity]));
  return {
    profileId,
    async loadIndex() {
      return index;
    },
    async loadActivity(id) {
      const activity = byId.get(id);
      if (!activity) throw new ActivityNotFoundError(id);
      return activity;
    },
  };
}

function response(body: BodyInit | null, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

function binaryResponse(bytes: Uint8Array): Response {
  return new Response(new Blob([bytes as BlobPart]), { headers: { 'Content-Type': 'application/octet-stream' } });
}

describe('local IndexedDB store', () => {
  let store: Awaited<ReturnType<typeof openLocalStore>>;

  beforeEach(async () => {
    store = await openLocalStore();
    await store.clear();
  });

  afterEach(async () => {
    await store.clear();
  });

  it('stores full activities and deduplicates same-sport starts within five seconds', async () => {
    expect(await store.putActivity(easyRun)).toBe('added');
    const duplicate = {
      ...easyRun,
      id: 'file:duplicate000000',
      startTime: new Date(Date.parse(easyRun.startTime) + 5000).toISOString().replace('.000Z', 'Z'),
    };

    expect(await store.putActivity(duplicate)).toBe('duplicate');
    expect(await store.loadActivity(easyRun.id)).toEqual(easyRun);
    await expect(store.loadActivity(duplicate.id)).rejects.toBeInstanceOf(ActivityNotFoundError);
  });

  it('allows another sport at the same time and lists summaries newest first', async () => {
    const newer = {
      ...easyRun,
      id: 'garmin:12345',
      sport: 'cycling' as const,
      startTime: '2026-01-16T12:00:00Z',
    };
    expect(await store.putActivity(easyRun)).toBe('added');
    expect(await store.putActivity(newer)).toBe('added');

    const index = await store.loadIndex();
    expect(index.profileId).toBe('local');
    expect(index.activities.map((activity) => activity.id)).toEqual([newer.id, easyRun.id]);
    expect(index.activities[0]).not.toHaveProperty('samples');
    expect(index.wellness).toEqual([]);
  });

  it('deletes individual activities and clears the store', async () => {
    await store.putActivity(easyRun);
    await store.deleteActivity(easyRun.id);
    await expect(store.loadActivity(easyRun.id)).rejects.toBeInstanceOf(ActivityNotFoundError);

    await store.putActivity(easyRun);
    await store.clear();
    expect((await store.loadIndex()).activities).toEqual([]);
  });
});

describe('remote profile sources', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists profiles and treats only a missing profiles file as an empty list', async () => {
    const profiles: ProfilesFile = { schemaVersion: 1, profiles: [{ id: 'blake', displayName: 'Blake' }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(JSON.stringify(profiles)))
      .mockResolvedValueOnce(response(null, 404))
      .mockResolvedValueOnce(response('unavailable', 500));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listRemoteProfiles('https://example.test/pacelab/')).resolves.toEqual(profiles.profiles);
    await expect(listRemoteProfiles('https://example.test/pacelab')).resolves.toEqual([]);
    await expect(listRemoteProfiles('https://example.test/pacelab')).rejects.toThrow(/500/);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://example.test/pacelab/data/profiles.json',
      'https://example.test/pacelab/data/profiles.json',
      'https://example.test/pacelab/data/profiles.json',
    ]);
  });

  it('decrypts the fixture index and lazily fetches and caches activities', async () => {
    const profileId = 'blake';
    const index = indexFor(
      profileId,
      fixtureIndex.activities.map((activity, index) => ({
        ...activity,
        id: index === 0 ? easyRun.id : activity.id,
      })),
      fixtureIndex.wellness,
    );
    const key = await deriveKey(passphrase, keyInfo);
    const encryptedIndex = await encryptJson(key, index);
    const encryptedActivity = await encryptJson(key, { ...easyRun, id: index.activities[0]!.id });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/keyinfo.json')) return response(JSON.stringify(keyInfo));
      if (url.endsWith('/index.enc')) return binaryResponse(encryptedIndex);
      if (url.endsWith(`/activities/${activityFileName(index.activities[0]!.id)}`)) return binaryResponse(encryptedActivity);
      return response(null, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const source = await openRemoteProfile('https://example.test/pacelab', profileId, passphrase);
    expect(await source.loadIndex()).toEqual(index);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(source.loadActivity(index.activities[0]!.id)).resolves.toEqual({
      ...easyRun,
      id: index.activities[0]!.id,
    });
    await source.loadActivity(index.activities[0]!.id);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(source.loadActivity('file:unknown00000000')).rejects.toBeInstanceOf(ActivityNotFoundError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a wrong passphrase and invalid profile ids', async () => {
    const index = indexFor('blake', fixtureIndex.activities);
    const key = await deriveKey(passphrase, keyInfo);
    const encryptedIndex = await encryptJson(key, index);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/keyinfo.json')
          ? response(JSON.stringify(keyInfo))
          : binaryResponse(encryptedIndex),
      ),
    );

    await expect(openRemoteProfile('https://example.test', 'blake', 'wrong')).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(openRemoteProfile('https://example.test', '../blake', passphrase)).rejects.toThrow(/profile id/i);
  });
});

describe('source merging', () => {
  it('keeps earlier activity copies and merges wellness fields by date', async () => {
    const firstActivity = easyRun;
    const nearbyDuplicate = {
      ...easyRun,
      id: 'garmin:24645966519',
      source: { ...easyRun.source, provider: 'garmin' as const },
      startTime: new Date(Date.parse(easyRun.startTime) + 4000).toISOString().replace('.000Z', 'Z'),
    };
    const laterActivity = {
      ...easyRun,
      id: 'file:newer000000000',
      startTime: '2026-01-16T12:00:00Z',
    };
    const date = '2026-01-15';
    const firstIndex = indexFor(
      'first',
      [toSummary(firstActivity)],
      [{ date, steps: { value: 5000, source: 'garmin' } }],
    );
    const secondIndex = indexFor(
      'second',
      [toSummary(nearbyDuplicate), toSummary(laterActivity)],
      [
        {
          date,
          steps: { value: 6000, source: 'garmin' },
          hrvMs: { value: 45, source: 'oura' },
        },
      ],
    );
    const first = testSource('first', firstIndex, [firstActivity]);
    const second = testSource('second', secondIndex, [nearbyDuplicate, laterActivity]);
    const merged = mergeSources('combined', first, second);

    const index = await merged.loadIndex();
    expect(index.profileId).toBe('combined');
    expect(index.activities.map((activity) => activity.id)).toEqual([laterActivity.id, firstActivity.id]);
    expect(index.wellness).toEqual([
      {
        date,
        steps: { value: 5000, source: 'garmin' },
        hrvMs: { value: 45, source: 'oura' },
      },
    ]);
    await expect(merged.loadActivity(firstActivity.id)).resolves.toBe(firstActivity);
    await expect(merged.loadActivity('file:missing0000000')).rejects.toBeInstanceOf(ActivityNotFoundError);
  });
});
