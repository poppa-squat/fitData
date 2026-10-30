# Track A — Ingest (C# sync + TS importers)

**You own:** `sync/**`, `packages/data/**`, `fixtures/**`, `.github/workflows/sync.yml`, `docs/status/track-a.md`.
**You deliver to:** Track C (calls `@pacelab/data`), and the encrypted `data` branch.
**Branch:** `track-a/ingest`.

Already done in Phase 0 (keep green, don't rewrite): canonical C# records, `CanonicalJson`, `BundleCrypto`
(C#) and `crypto.ts` (TS), cross-language crypto vectors, the reference FIT converter, fixtures.

Work top to bottom. Merge after every task (AGENTS.md). Tasks marked **M1** unblock Track C — do them first.

## A1 — TS FIT importer (M1) — `packages/data`
- Use Garmin's official JS FIT SDK `@garmin/fitsdk` (check the current API in its README; it decodes to `*Mesgs` arrays with scaled values).
- Implement `detectFormat` and `importActivityFile` for FIT per `docs/CONTRACTS.md` §3; id = `file:` + SHA-256 (WebCrypto `crypto.subtle.digest`) first 16 hex chars.
- Golden test: importing `fixtures/fit/easy-run.sanitized.fit` equals `fixtures/canonical/easy-run.json` within §3.4 tolerances, and passes `checkActivityInvariants` + the JSON Schema (ajv).
- Handle: multiple sessions (take the first, note it in status), no GPS, no HR, swim `length` messages, unknown sports → `other`, corrupt files → `UnsupportedFileError` with a readable message.

## A2 — Local store + sources (M1) — `packages/data`
- `openLocalStore()` on IndexedDB (a small wrapper like `idb` is fine). Stores full activities, index derived from them. Dedupe per §1.
- `mergeSources`, `listRemoteProfiles`, `openRemoteProfile` (fetch + `deriveKey` + `decryptJson`, lazy per-activity fetch with an in-memory cache).
- Tests: `fake-indexeddb` for the store; mock `fetch` serving `fixtures/crypto/*` for remote (encrypt an `IndexPayload` built from `fixtures/canonical/index-synthetic.json` in the test).
- When A1 + A2 are merged, open an issue for Track C: "`@pacelab/data` M1 ready".

## A3 — GPX + TCX importers (M2) — `packages/data`
- `fast-xml-parser` (works in browser and Node) or equivalent. Map per §3. Write small hand-made GPX/TCX fixtures (synthetic, no real GPS) in `fixtures/gpx/` and `fixtures/tcx/` with expected canonical JSON.

## A4 — C# test project + FIT importer (M3) — `sync/`
- Add `sync/tests/Pacelab.Sync.Tests` (xUnit) to the solution. CI already runs `dotnet test sync`.
- Port the crypto vector checks: decrypt `fixtures/crypto/vector-ts.enc`, round-trip.
- `Pacelab.Sync.Core` (new class library): FIT → `Activity` with the `Garmin.FIT.Sdk` NuGet package. Golden test against `fixtures/canonical/easy-run.json` (§3.4 tolerances). Validate output against `packages/schema/json-schema/activity.schema.json` (e.g. `JsonSchema.Net`).
- Generate FIT fixtures for cycling (power) and pool swim (lengths) from `fixtures/canonical/{cycling,swim}-synthetic.json` with the FIT SDK encoder → `fixtures/fit/*-synthetic.sanitized.fit`, then test that both importers (C# and TS) round-trip them. Tell Track B/C via issue when they exist.
- CLI command `import-fit <dir> --profile <id> --out <dataRoot>`: bulk-import a Garmin Connect export folder (history backfill).

## A5 — Garmin Personal API adapter (M3) — `sync/`
- Docs: https://developer.garmin.com/gc-developer-program/personal/ (FAQ + API reference). Read them first; the API is new (Oct 2026) and details may differ from these notes.
- Auth: `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with header `Authorization: ApiKey <key>` → access token valid 24 h, no refresh token; request a new one each run.
- Pull activity list + FIT files (decode with A4's importer), and daily health (sleep, HRV, resting HR, steps) → `DailyWellness` per §4.
- Incremental: remember the last synced activity/date in `state.enc`. Respect rate limits with exponential backoff; never fail the whole run for one bad activity (log + skip).
- **Find out and write in your status file:** does the personal API's FIT include running dynamics and respiration (or is it stripped)? How far back does history go? If it's stripped or short, `import-fit` (A4) is the fallback for history.
- Tests use recorded, **sanitized** JSON responses in `sync/tests/fixtures/` (no real ids, GPS or tokens).

## A6 — Oura API v2 adapter (M3) — `sync/`
- Docs: https://cloud.ouraring.com/v2/docs. Personal access tokens are deprecated: **OAuth2 only**.
- `oura-login --profile <id>`: starts a listener on `http://localhost:8765/callback`, opens the browser to Oura's authorize URL (scopes for daily, heartrate, personal, session/workout as needed), exchanges the code, prints the refresh token once so the human can save it as a repo secret. Never writes it to disk in the repo.
- Sync: refresh the access token, pull `sleep` (use `type == "long_sleep"`), `daily_sleep`, `daily_readiness` → `DailyWellness` per §4. Check in the docs whether refresh tokens rotate; if they do, the job must save the new one (A7).
- Tests with sanitized recorded responses.

## A7 — Publish + scheduled sync (M3)
- CLI `sync --profile <id> --data <dataRoot>`: Garmin + Oura → merge (§4) → write `profiles.json`, `keyinfo.json` (create once), `index.enc`, new/changed `activities/*.enc`, `state.enc`. Idempotent: running twice changes nothing.
- `sync/profiles.config.json` (committed, no secrets): `[{ "id": "blake", "displayName": "Blake" }, …]`.
- `.github/workflows/sync.yml`: `schedule` (daily, pick an odd minute) + `workflow_dispatch`. One job, profiles processed **sequentially**. Check out `main` (code) and the `data` branch into a worktree (create the orphan branch on first run), build, run `sync` per profile, commit + push `data` only if changed, then `gh workflow run deploy.yml --ref main` (`permissions: contents: write, actions: write`).
- Secrets per profile (`<ID>` = upper-case id, `-` → `_`): `GARMIN_API_KEY_<ID>`, `OURA_REFRESH_TOKEN_<ID>`, `PACELAB_PASSPHRASE_<ID>`; shared: `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`. If Oura refresh tokens rotate, update the secret with `gh secret set` using a fine-grained PAT stored as `SECRETS_WRITER_TOKEN` (Secrets: read/write on this repo only).
- Missing secrets for a profile → skip that profile with a warning, don't fail the run.
- Write `sync/README.md`: exact human steps to get each key/token and add each secret.

## Definition of done (every task)
Tests for the new behaviour; golden tests still pass; `npm run verify` + `dotnet build sync && dotnet test sync` green;
status file updated; issue opened for any track that can now use what you shipped.
