# Contracts

This file and the code it points to are the **only** things the three tracks share.
If code and this file disagree, the **code in `packages/schema`, the JSON Schemas and the
fixtures win**, and whoever notices opens a `contract-change` issue to fix this file.

| § | Contract | Source of truth |
|---|---|---|
| 1–3 | Canonical `Activity` | `packages/schema/src/activity.ts`, `json-schema/activity.schema.json`, `sync/src/Pacelab.Canonical/Models.cs`, `fixtures/tools/fit_to_canonical.py` |
| 2 | Channels & units | `packages/schema/src/channels.ts` |
| 4 | `DailyWellness` | `packages/schema/src/wellness.ts`, `json-schema/wellness.schema.json` |
| 5 | Published data + encryption | `packages/schema/src/bundle.ts`, `packages/data/src/crypto.ts`, `sync/src/Pacelab.Canonical/BundleCrypto.cs`, `fixtures/crypto/*` |
| 6 | Athlete settings | `packages/schema/src/settings.ts` |
| 7 | Package APIs | `packages/data/src/index.ts`, `packages/analytics/src/{index,types}.ts` |
| 8 | How to change any of this | this file |
| 9 | Who owns what | this file |

---

## 1. Activity

- One canonical shape for every source (Garmin API, Oura, dropped FIT/GPX/TCX). The UI and analytics never see provider formats.
- **Ids.** API imports: `${provider}:${providerId}` (`garmin:24645966519`). Dropped files: `file:` + first 16 hex chars of SHA-256 of the file bytes. Ids match `^[a-z]+:[A-Za-z0-9._-]+$`.
- **Duplicates.** Two activities are the same workout if `sport` matches and `startTime` is within ±5 s. API copies win over file copies (§7.1 `mergeSources`).
- **Times.** `startTime` is ISO-8601 UTC with a `Z` and whole seconds (`2026-01-15T12:00:00Z`). Every other time is **seconds since `startTime` on the wall clock** (`t`, `startT`, `endT`), so pauses are visible as gaps.
- `elapsedTimeS` = wall clock incl. pauses. `movingTimeS` = timer time.
- `ActivitySummary` (in the index) = `Activity` minus `samples`, `pauses`, `laps`, `swimLengths`.
- `schemaVersion` is `1`. Bumping it is a breaking change (§8).

## 2. Channels and units

Columnar samples: `samples.t[]` plus `samples.channels[key][]`, every array the same length, `null` = no reading.
`t` is strictly increasing and **may be irregular** (Garmin smart recording records every 1–6 s).

| Key | Unit | Notes |
|---|---|---|
| `heartRate` | bpm | |
| `speed` | m/s | FIT `enhanced_speed`, else `speed` |
| `distance` | m | cumulative from start |
| `altitude` | m | FIT `enhanced_altitude`, else `altitude` |
| `lat`, `lon` | degrees | FIT semicircles × 180 / 2³¹ |
| `cadence` | **running/walking/hiking: steps/min (both feet)**; cycling: rpm; swimming: strokes/min | FIT running cadence is per-foot: `2 × (cadence + fractional_cadence)` |
| `power` | W | |
| `temperature` | °C | device temperature, not weather |
| `respirationRate` | breaths/min | FIT `enhanced_respiration_rate`, else `respiration_rate` |
| `stepLength` | m | **device-measured only** (FIT `step_length` mm ÷ 1000). Garmin calls this "stride length" but it's one step. If absent, analytics derives it (§7.2) |
| `verticalOscillation` | m | FIT mm ÷ 1000 |
| `groundContactTime` | s | FIT `stance_time` ms ÷ 1000 |
| `verticalRatio` | % | |
| `gctBalance` | % left | FIT `stance_time_balance` |

`samples.extra` holds provider-specific series named `provider.name` (e.g. `garmin.performanceCondition`). The UI may show them; analytics must not depend on them.

Derived channels (`pace`, `pace100m`, `gradePct`, `gapSpeed`, `efficiency`, `movingTime`) exist **only** in `PreparedActivity` (§7.2). Importers never write them.

## 3. Import rules (FIT; GPX/TCX analogous)

The executable spec is `fixtures/tools/fit_to_canonical.py`. Summary:

| Canonical | FIT source |
|---|---|
| `sport` | `session.sport` if one of running/cycling/swimming/walking/hiking, else `other` |
| `subSport` | `session.sub_sport` name (`generic`, `trail`, `treadmill`, `lap_swimming`, `open_water`, `indoor_cycling`, …) |
| `startTime` | `session.start_time`. `t = record.timestamp − session.start_time`; drop records with a duplicate timestamp (keep the first) |
| `timezoneOffsetMin` | `(activity.local_timestamp − activity.timestamp) / 60` |
| `elapsedTimeS` / `movingTimeS` | `session.total_elapsed_time` / `total_timer_time` |
| `distanceM`, `avgHr`, `maxHr`, `ascentM`, `descentM`, `calories`, `poolLengthM` | session totals |
| `pauses` | timer `stop`/`stop_all` followed by timer `start` → `{startT, endT}`; the final stop is not a pause |
| `laps[]` | `lap` messages ordered by `start_time`; `endT = startT + total_elapsed_time`; `trigger` from `lap_trigger` (`position_*` → `position`, unknown → `other`); `intensity` from the lap |
| `swimLengths[]` | `length` messages; `idle` = `length_type == idle`; stroke from `swim_stroke` |
| `channels` | non-empty raw channels, in `RAW_CHANNEL_KEYS` order |
| `hasGps` | any non-null `lat` |
| `source` | `{provider:"file", format:"fit", device, importedAt}` for dropped files; `{provider:"garmin", providerId, …}` for API |

GPX: `trkpt` → lat/lon/time/ele, `gpxtpx:hr`/`gpxtpx:cad` extensions; sport from `<type>` if recognisable else `other`; no laps unless segments.
TCX: `Trackpoint` → Time/Position/AltitudeMeters/DistanceMeters/HeartRateBpm/Cadence, `ns3:TPX` Speed/RunCadence/Watts; `Lap` elements → laps; `Activity@Sport` → sport.
For GPX/TCX running cadence, convert to steps/min if the file stores per-foot values (TCX `RunCadence` is per-foot).

### 3.4 Golden test (both importers)

Importing `fixtures/fit/easy-run.sanitized.fit` must equal `fixtures/canonical/easy-run.json`, ignoring
`source.importedAt` and `source.device`, with these absolute tolerances (exact otherwise):

| Field | Tolerance |
|---|---|
| `lat`, `lon` | 1e-6 |
| `speed`, `avgSpeed` | 0.002 |
| `altitude` | 0.25 |
| `distance`, `distanceM` | 0.02 |
| `cadence` | 0.02 |
| all times (`t`, `startT`, `endT`, `*TimeS`) | 0.002 |

## 4. Daily wellness

- One `DailyWellness` per **local date the person woke up** per profile, ascending by date in the index.
- `sleep` = main sleep period only (Oura `type: "long_sleep"`; Garmin main sleep). Naps ignored in v1.
- Each scalar is a `Metric {value, source}` so merged days stay traceable.
- Merge rule when both providers have a field: **Oura wins for sleep, HRV, temperature, readiness; Garmin wins for steps; resting HR: Oura.** (Track A implements in C#.)
- Provider scores (`providerScore`, `providerReadiness`) are displayed as-is, never re-derived. Our own readiness is computed by analytics (§7.2).
- HRV is night-average rMSSD in ms from either provider.

## 5. Published data

### 5.1 Where it lives

GitHub Pages is **public**. Nothing personal is ever readable in the repo or on the site.

- `main` holds code only (CI `privacy` job fails if `data/` or raw `.fit/.gpx/.tcx` appear).
- The sync job (Track A) writes to an orphan branch **`data`** containing only `data/…`.
- The deploy job (Track C) builds the web app from `main`, copies `data/` from the `data` branch (if it exists) into the build output, and deploys to Pages.
- A push made with `GITHUB_TOKEN` does **not** trigger other workflows, so `sync.yml` must end with `gh workflow run deploy.yml --ref main` (needs `permissions: actions: write`). `deploy.yml` must have a `workflow_dispatch` trigger.

```
data/profiles.json                       ProfilesFile  (plaintext; display names are public, use nicknames)
data/<profileId>/keyinfo.json            KeyInfo       (plaintext; salt never changes unless the passphrase is rotated)
data/<profileId>/index.enc               IndexPayload  (encrypted)
data/<profileId>/activities/<file>.enc   Activity      (encrypted), <file> = activityFileName(id)
data/<profileId>/state.enc               sync state    (encrypted, Track A private format)
```

`profileId`: `[a-z0-9-]+`. Secret names derive from it: upper-case, `-` → `_` (profile `blake` → `GARMIN_API_KEY_BLAKE`).

### 5.2 Envelope

```
file      = "PLB1" (4 bytes ASCII) || iv (12 random bytes) || ciphertext || tag (16 bytes)
plaintext = gzip(UTF-8 JSON)
key       = PBKDF2-HMAC-SHA256(passphrase as UTF-8, salt from keyinfo.json, iterations, 32 bytes)
cipher    = AES-256-GCM, no additional data
```

Default iterations 600 000. Reference implementations (already done, cross-tested):
`packages/data/src/crypto.ts` and `sync/src/Pacelab.Canonical/BundleCrypto.cs`.
The files are public, so passphrases must be long (5+ random words): anyone can try to guess offline.

### 5.3 Profiles

One profile per person. Each person has their own Garmin key, Oura tokens and passphrase as repo secrets.
The UI shows the profile list, asks for the passphrase, keeps the derived key in memory only (optionally `sessionStorage` if the user ticks "remember for this tab").

## 6. Athlete settings

`AthleteSettings` (`packages/schema/src/settings.ts`) is edited in the UI, stored by Track C in
`localStorage["pacelab.settings.<profileId>"]`, and passed into analytics functions. Analytics never reads storage.

## 7. Package APIs

### 7.1 `@pacelab/data` (Track A implements, Track C calls)

See JSDoc in `packages/data/src/index.ts`. Key behaviour:

- `importActivityFile(bytes, fileName)` → canonical `Activity` (FIT/GPX/TCX), throws `UnsupportedFileError`.
- `openLocalStore()` → IndexedDB-backed `LocalStore` (profileId `"local"`); `putActivity` dedupes per §1.
- `listRemoteProfiles(baseUrl)` → `[]` when `data/profiles.json` is missing (404).
- `openRemoteProfile(baseUrl, id, passphrase)` → rejects `WrongPassphraseError`; caches decrypted activities.
- `mergeSources(profileId, ...sources)` → one view; earlier sources win on duplicates and per wellness field.
- `baseUrl` is the site root including the Pages base path (e.g. `https://user.github.io/pacelab`).

### 7.2 `@pacelab/analytics` (Track B implements, Track C calls)

Pure, synchronous, no I/O, no `Date.now()`. Definitions the UI relies on (so it can explain them):

**prepare()**
- Uniform grid `t = 0, r, 2r, …` (r = `resampleS`, default 1) up to `max(elapsedTimeS, last samples.t)` (devices often log a few seconds past the session end).
- Linear interpolation across gaps ≤ `maxInterpolateGapS` (default 10 s); longer gaps stay `null`.
- Inside pauses every channel is `null` except `distance` and `movingTime`, which are held flat. `paused[i]` is true there.
- **Swimming:** each swim length's values (the sample at its end) fill `[startT, endT)`; idle lengths count as paused.
- Derived: `movingTime` (elapsed minus pauses); `pace` = 1000 / speed (running/walking/hiking, null when speed < 0.5 m/s); `pace100m` = 100 / speed (swimming); `gradePct` from altitude smoothed over 30 s and distance over ≥ 10 m, clamped ±40 %; `gapSpeed` = speed × C(i) / C(0) with Minetti C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6, i = grade (clamped ±0.45); `efficiency` = (gapSpeed ?? speed) × 60 / HR for run/walk/hike/swim, power / HR for cycling with power, else speed × 60 / HR; `stepLength` when not measured = speed / (cadence / 60) where cadence > 0 (listed in `derived`).

**windowStats()** — paused samples excluded from all channel stats. `elapsedS = endT − startT`, `movingS` = non-paused samples × r. Percentiles by linear interpolation. `slopePerMin` = least-squares slope × 60. HR zones from `AthleteSettings` (`percentMax`: bounds × maxHr; `percentHrr`: rest + bounds × (max − rest); `lthr`: bounds × LTHR — the UI offers the preset [0.85, 0.89, 0.94, 1.0] when switching to this method). `drift` needs ≥ 10 min moving, else `null`; basis: power (cycling with power) else `gapSpeed` (running with altitude) else `speed`. Cycling `power`: NP = (mean of 30 s rolling-average power⁴)^¼; IF = NP / FTP; TSS = movingS × NP × IF / (FTP × 3600) × 100 (null without FTP). Swim: SWOLF = length seconds + strokes.

**segments()** — `laps` from activity laps; `splitsKm` / `splitsMile` from distance (last partial split labelled with its fraction); `intervals` from lap intensities when present (active/interval → work, rest/recovery → recovery, warmup, cooldown), else detected: 30 s-smoothed output (power or gapSpeed) above 1.15 × the activity median for ≥ 60 s = work; `hrZones` = contiguous runs in one zone, blips < 30 s merged into neighbours; `hills` = climbs with ≥ 10 m gain and ≥ 3 % average grade over ≥ 200 m; `swimLengths` = non-idle lengths; `halves` = first and second half of moving time.

**relationship()** — points averaged into `bucketS` buckets (default 5 s) inside each window (one group per window), paused buckets and `speed < minSpeed` dropped; least-squares fit per group and overall (key `-1`); Pearson r overall.

**overlay()** — `movingTime` grid step default 10 s, `distance` grid step default 50 m; linear interpolation; shortest activity ends with nulls.

**Training load** — `activityLoad`: Banister TRIMP = Σ minutes × HRr × k × e^(b·HRr), HRr = (HR − rest)/(max − rest) clamped 0–1; male k = 0.64, b = 1.92; female k = 0.86, b = 1.67; unspecified sex uses male. From a summary: same formula with `avgHr` and `movingTimeS`. No HR: power+FTP → TSS (`method: 'tss'`); else `movingTimeS / 60` (`method: 'duration'`). `date` = local date of start (`startTime` + `timezoneOffsetMin`).
`loadSeries`: EWMA with α = 1 − e^(−1/7) (ATL) and 1 − e^(−1/42) (CTL), seeded with 0 at the earliest load, values reported from `from` to `to`. For day d: `atl`/`ctl` include d's load; `tsb = ctl(d−1) − atl(d−1)` (form going into the day).

**readiness()** — personal baseline = previous 28 days (excluding `date`), component needs ≥ 7 baseline values else `z = null`.
| Component | Value | z (positive = better) | Weight |
|---|---|---|---|
| `hrv` | ln(hrvMs) | (v − mean)/sd | 0.30 |
| `restingHr` | restingHr | −(v − mean)/sd | 0.20 |
| `sleepDuration` | totalSleepS | (v − mean)/sd, capped at +1 | 0.20 |
| `sleepEfficiency` | efficiencyPct | (v − mean)/sd | 0.10 |
| `trainingForm` | tsb | clamp((tsb / max(ctl, 10)) / 0.15, −2, 2) | 0.20 |
z clamped to ±2.5. `contribution = 15 × w × z / Σw(available)`; `score = clamp(50 + Σ contribution, 0, 100)`; `null` if fewer than 2 components have z. Confidence: baseline days < 14 low, < 28 medium, else high. Not medical advice; the UI says so.

**correlations()** — Pearson r, only reported for n ≥ 8; descriptions are hedged ("weak positive, n = 12") and never causal.

**suggestions()** — rule-based, each with the numbers that triggered it. Initial rules are listed in `docs/tracks/track-b-analytics.md`. Confidence is lowered when the evidence uses derived channels (e.g. derived step length) or coverage < 80 %.

## 8. Changing a contract

1. Prefer **additive** changes (new optional field, new function, new channel). Those can merge any time.
2. Open a GitHub issue labelled `contract-change` describing the change and who is affected.
3. Make the change in a **small, separate PR** that touches only contract files: TS types, JSON Schema, C# `Models.cs`, stub signatures, fixtures, this file. Keep every package compiling and every test green in that PR.
4. Breaking changes (rename, remove, change meaning or units, bump `schemaVersion`) need a human's OK on the issue first.
5. After merging, comment on the issue with the commit SHA and close it. Other tracks pick it up at their next `git merge origin/main`.

## 9. Ownership

| Path | Owner | Others may |
|---|---|---|
| `sync/**`, `packages/data/**`, `fixtures/**`, `.github/workflows/sync.yml`, `docs/status/track-a.md` | **Track A** | read |
| `packages/analytics/**`, `docs/status/track-b.md` | **Track B** | read |
| `apps/web/**`, `.github/workflows/deploy.yml`, `docs/status/track-c.md`, `docs/status/integration.md` | **Track C** (integrator) | read |
| `packages/schema/**`, `docs/CONTRACTS.md`, `sync/src/Pacelab.Canonical/{Models,CanonicalJson}.cs`, exported signatures in `packages/data/src/index.ts` and `packages/analytics/src/{index,types}.ts`, `.github/workflows/ci.yml`, root `package.json`, `tsconfig.base.json`, `AGENTS.md`, `docs/PLAN.md` | **Shared contract** | change only via §8 |
| `package-lock.json` | everyone | never hand-merge — see AGENTS.md |
