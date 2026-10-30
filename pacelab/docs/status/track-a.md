# Track A — Ingest — status

_Updated by the Track A agent at every merge. Newest entry first. Keep it short._

## Now
- A1 (TS FIT importer) and A2 (data sources/local store) implemented and verified locally; merge pending.

## Next
- A3 — GPX + TCX importers with synthetic golden fixtures.

## Decisions & findings
- The official `@garmin/fitsdk` 21.218.0 README documents `Decoder.read()` returning grouped `*Mesgs` arrays; decoded dates are numeric FIT-epoch values when `convertDateTimesToDates` is disabled.
- FIT files with multiple sessions import the first session, as specified by A1.
- A2 uses `idb` for IndexedDB, keeps remote activity downloads lazy and cached in memory, and lets earlier sources win duplicate activities and wellness fields.

## Blocked on
- GitHub CLI is not installed/authenticated here; PR creation/merge, labels, and the Track C handoff issue need GitHub authentication.
