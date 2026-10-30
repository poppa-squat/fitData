# Track A — Ingest — status

_Updated by the Track A agent at every merge. Newest entry first. Keep it short._

## Now
- A1 (TS FIT importer) implemented and verified locally; merge pending.

## Next
- A2 — local IndexedDB store, remote encrypted profile reader, and source merging.

## Decisions & findings
- The official `@garmin/fitsdk` 21.218.0 README documents `Decoder.read()` returning grouped `*Mesgs` arrays; decoded dates are numeric FIT-epoch values when `convertDateTimesToDates` is disabled.
- FIT files with multiple sessions import the first session, as specified by A1.

## Blocked on
- (nothing)
