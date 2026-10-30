# Track B — Analytics (TypeScript)

**You own:** `packages/analytics/**`, `docs/status/track-b.md`.
**You deliver to:** Track C, which renders whatever your functions return.
**Branch:** `track-b/analytics`.

The public API (names, parameters, return types) is already declared in `packages/analytics/src/index.ts` and
`types.ts`, with precise definitions in `docs/CONTRACTS.md` §7.2. Your job is to replace every stub with a
correct, fast, well-tested implementation **without changing signatures** (additive changes only, via §8).
Split the code into modules (`prepare.ts`, `stats.ts`, `segments.ts`, …) and re-export from `index.ts`.
Keep `test/contract.test.ts`.

Rules: pure functions, no I/O, no `Date.now()`, no DOM, no mutation of inputs. Nulls are "no data", never 0.
Prefer zero runtime dependencies (simple-statistics-style helpers are easy to write and test).

Work top to bottom. Merge after every task. **B1–B2 unblock Track C — do them first.**

## B1 — prepare + smooth (M1)
- Resampling, pause masking, interpolation limits, swim length fill, all derived channels (§7.2).
- Tests on `fixtures/canonical/easy-run.json`: grid length = `floor(max(elapsedTimeS, last t)) + 1` (2904 at 1 Hz: the last record is at t = 2903, after `elapsedTimeS` 2901.1); every channel null during the pause 273–467 s except `distance`/`movingTime`; `movingTime` at the end = 2903 − 194 = 2709 s (within a few seconds of `movingTimeS` 2706.7); derived `stepLength` median ≈ 1.29 m (1.2–1.4) while running; `derived` includes `stepLength`; lap-average `pace` between 260 and 320 s/km for laps 1–5.
- Tests on `cycling-synthetic.json` (power present → efficiency = W/bpm) and `swim-synthetic.json` (length fill, `pace100m`).
- `smooth`: moving average, EWMA, median, all null-aware.

## B2 — windowStats (M1)
- Per-channel stats, HR zones (all three methods), drift, cycling power block (NP/IF/TSS), swim block (SWOLF).
- Hand-built tiny activities for exact-value tests; fixtures for sanity ranges.
- **Performance test:** a synthetic 2-hour 1 Hz activity with 8 channels; `windowStats` on a 30-minute window < 5 ms median (Track C calls it on every brush move).
- When B1 + B2 are merged, open an issue for Track C: "analytics M1 ready".

## B3 — segments (M2)
All kinds in §7.2. Easy-run expectations: 9 laps; intervals from lap intensities = warmup, 6 × active, cooldown, last tiny lap; halves split moving time evenly. Cycling synthetic: intervals detected as 3 work + recoveries even if you strip the lap intensities.

## B4 — relationship + overlay (M2)
- Buckets, groups per window, fits per group + overall, Pearson r, `minSpeed` filter (default 1.5 m/s for running so walking/standing don't pollute stride-vs-speed).
- Overlay on moving time / distance.

## B5 — load, readiness, performance, correlations (M3)
- `activityLoad` (TRIMP / TSS / duration), `loadSeries` (ATL/CTL/TSB with the exact day convention in §7.2), `readiness` (exact component table in §7.2), `performanceHistory`, `correlations`.
- Use `fixtures/canonical/index-synthetic.json` (62 days wellness + 39 summaries): readiness has `confidence: 'low'` for the first 14 days, scores in 0–100, components sum to `score − 50` (before clamping).

## B6 — suggestions (M2)
Each rule: an `id`, the evidence numbers, a confidence, and careful wording (suggest, don't diagnose; no medical claims).
Start with these; add more if the data supports them:

| id | Sport | Trigger (steady portion = excluding warmup/cooldown laps when known) | Says |
|---|---|---|---|
| `fatigue-stride` | run | Last third vs first third of steady moving time: cadence −3 % or more while step length +3 % or more at similar speed | Form changes as you tire (overstriding pattern); try holding cadence late in runs |
| `cadence-vs-own-trend` | run | With ≥ 5 runs of history: cadence at this speed > 5 % below your own cadence-vs-speed fit | Lower cadence than usual for this pace |
| `drift-high` | run, bike | `decouplingPct` > 5 % on a steady effort ≥ 30 min (mention temperature if it rose) | Aerobic decoupling: heat, hydration, or pace above aerobic base |
| `easy-not-easy` | run, bike | Laps marked easy/active-low or whole run without intervals: > 20 % of time in Z4+ | The easy session wasn't easy |
| `pacing-split` | run | Second half > 5 % slower (GAP-based) without being a workout | Positive split; negative split → `info` praise |
| `interval-fade` | run, bike | Work intervals: last vs first output −5 % or more | Interval fade; consider fewer/shorter reps or longer recovery |
| `swim-swolf-rise` | swim | SWOLF of last quarter of lengths > 10 % above first quarter (same stroke) | Technique drops with fatigue |
| `hr-artifact` | all | HR > 85 % max in the first 3 min while speed/power is low | Possible wrist-HR lock-on artifact; trust HR stats from later |
| `smart-recording` | all | Median raw sample interval > 1.5 s | Switch the watch to Every Second recording |
| `derived-stride` | run | `stepLength` is derived | Stride length is estimated from speed and cadence (info) |

## B7 — hardening (M4)
Property-based tests for `prepare` and `windowStats` invariants (e.g. fast-check), edge cases (empty activity,
one sample, all-null channels, activities spanning midnight/timezones), and a short `packages/analytics/README.md`
explaining every metric in plain English (Track C links to it from the UI).

## Definition of done (every task)
Exact-value tests on hand-made inputs + sanity tests on fixtures; `npm run verify` green; JSDoc on every export
explains the metric in one plain sentence (Track C shows it as a tooltip); status file updated.
