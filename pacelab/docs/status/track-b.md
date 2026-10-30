# Track B — Analytics — status

_Updated by the Track B agent at every merge. Newest entry first. Keep it short._

## Now
- B1 landed on `track-b/analytics`: `prepare` and `smooth` (`packages/analytics/src/prepare.ts`, `smooth.ts`). Hand-built exact tests plus easy-run, cycling, and swim fixtures. `npm run verify` green locally.

## Next
- B2 `windowStats` (per-channel stats, HR zones, drift, cycling NP/IF/TSS, swim SWOLF) and the < 5 ms budget. Then open the Track C issue "analytics M1 ready".

## Decisions & findings
- Pauses are half-open `[startT, endT)`. Overlapping pauses (and idle swim lengths) are merged. `movingTime(t) = t − paused time strictly after each pause start`, so the value is flat during the pause and the easy-run end point is `2903 − 194 = 2709`.
- When `swimLengths` is present, those lengths replace linear interpolation: the sample at `endT` fills `[startT, endT)`. Idle lengths are pauses. Open-water swims with no lengths still interpolate.
- Grade (§7.2 does not say centered vs trailing): centered 30 s moving average of altitude, then the closest samples with ≥ 5 m of distance on each side (one-sided ≥ 10 m at the ends), clamped to ±40 %. Minetti uses `gradePct / 100`, also clamped to ±0.45. `gapSpeed` is computed for any sport with speed and altitude; efficiency uses it only for run/walk/hike/swim.
- `smooth`: a sample is inside a centered window when `|Δt| ≤ windowS / 2`. An even median averages the two middle values. EWMA uses `α = 1 − 0.5^(resampleS / halfLifeS)`; nulls stay null and do not update the filter.
- Easy-run "laps 1–5" are `lap.index` 1 through 5. Index 0 is the warmup (~1.75 m/s, ~570 s/km), outside 260–320. Step-length median "while running" uses speed ≥ 2 m/s.
- No exported signatures changed.

## Blocked on
- (nothing)
