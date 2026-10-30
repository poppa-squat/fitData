# Track B — Analytics — status

_Updated by the Track B agent at every merge. Newest entry first. Keep it short._

## Now
- B2 landed: `windowStats` in `packages/analytics/src/stats.ts`. Exact hand-built tests, fixture ranges, and a 30-minute window of a 2-hour 1 Hz activity under 5 ms median. B1 (`prepare`, `smooth`) is already on main.

## Next
- B3 `segments` (laps, splits, intervals, HR-zone stretches, hills, swim lengths, halves). Open the Track C issue "analytics M1 ready" with this merge.

## Decisions & findings
- Windows are half-open `[startT, endT)`. `movingS` is the count of non-paused samples times `resampleS`. Paused samples are left out of every channel stat, zone total, drift half, and normalized power.
- Percentiles use linear interpolation at `p * (n − 1)` (type 7). Standard deviation divides by `n` (the window is the whole population). `slopePerMin` is the least-squares slope against elapsed `t`, times 60.
- A heart rate equal to a zone's upper bound stays in that zone. Time below the first bound counts as zone 1. `hrZoneS` is empty when there is no HR sample or the method's reference is missing (`lthr` without `lthr`, non-positive max, or heart-rate reserve ≤ 0).
- Drift needs ≥ 600 s moving. Halves split non-paused samples in time order; an odd middle sample goes in the first half. Each ratio is mean output / mean HR. Basis: cycling power, else running `gapSpeed` when that series exists, else speed. Decoupling is `(first − second) / first * 100`.
- Normalized power is the fourth root of the mean fourth power of a trailing 30 s average along non-paused power samples (the window grows until it is full). IF and TSS are null unless `ftpW` is positive. TSS uses `movingS × NP × IF / (FTP × 3600) × 100`.
- SWOLF lengths are non-idle lengths that overlap the window. SWOLF is length seconds plus strokes.
- B1 choices still in force: half-open pauses, swim-length fill, centered 30 s grade with ±5 m sides, centered `smooth`, EWMA `α = 1 − 0.5^(resampleS / halfLifeS)`. Easy-run laps 1–5 are `lap.index` 1..5.
- No exported signatures changed. CI still does not run: workflows live under `pacelab/.github` (issue #2).

## Blocked on
- (nothing)
