# Pacelab — project plan

Personal, non-commercial site to **explore cardio workouts in depth**: interactive, customizable charts of
heart rate, pace, cadence, stride length, power, breathing rate and more; select any window of a workout and get
stats for just that window; compare windows and workouts; see how sleep and recovery relate to performance;
and get explainable suggestions. Running, cycling and swimming. Garmin + Oura today, any FIT/GPX/TCX source tomorrow.

## Features (all agreed)

| # | Feature | Track(s) |
|---|---|---|
| F1 | Drag-and-drop FIT/GPX/TCX into the browser (no upload, stored locally) | A (import, store), C (UI) |
| F2 | Activity view: stacked, synced, zoomable charts; pick which channels to show; x-axis = time / moving time / distance; smoothing control | B (prepare, smooth), C |
| F3 | **Window stats:** drag-select any span → stats for that span only (mean/min/max/percentiles/trend, zones, drift, NP, SWOLF) | B, C |
| F4 | **Compare windows:** pin several windows (or click laps/segments) and see them side by side with deltas | B, C |
| F5 | Auto-segmentation: laps, km/mile splits, intervals, HR-zone stretches, hills, swim lengths, halves | B, C |
| F6 | Cardiac drift / aerobic decoupling for any window | B, C |
| F7 | **Relationship explorer:** scatter any channel vs any channel (e.g. stride length vs speed, coloured by HR), per-segment fit lines, across one or many activities | B, C |
| F8 | Workout overlay: align 2–5 activities by moving time or distance | B, C |
| F9 | Training load (TRIMP) → fitness / fatigue / form chart | B, C |
| F10 | **Transparent readiness score** from sleep, HRV, resting HR and training form, with each component's contribution shown; Oura's own score alongside | A (wellness data), B, C |
| F11 | Readiness vs performance: does a good night predict a more efficient run? Correlations with honest sample sizes | B, C |
| F12 | Efficiency trend over weeks (speed or power per heartbeat) | B, C |
| F13 | **Suggestions**: rule-based, explainable tips for stride/cadence, pacing, drift, intervals, swim technique — each shows the numbers behind it | B, C |
| F14 | Data-quality controls: smoothing, gap handling, flags for wrist-HR artifacts and smart recording | B, C |
| F15 | Automatic sync from Garmin Personal API + Oura API v2, encrypted, published with the site | A, C (deploy) |
| F16 | Multi-person: one profile each, each with its own passphrase | A, C |
| F17 | Metric/imperial display | C |

Not in scope v1: write-back to watches, maps beyond a simple route preview (stretch), naps, social features, AI-generated text.

## Architecture

```
            Garmin Personal API ─┐                         ┌─ dropped .fit/.gpx/.tcx
                Oura API v2 ─────┤                         │
                                 ▼                         ▼
  ┌──────────── sync/ (C#, Track A) ─────────┐   ┌── packages/data (TS, Track A) ──┐
  │ adapters → canonical Activity/Wellness   │   │ importers → canonical Activity   │
  │ → encrypt (AES-GCM) → `data` branch      │   │ IndexedDB local store            │
  └──────────────────────┬───────────────────┘   │ decrypt remote bundle            │
           GitHub Actions│(scheduled)            └────────────────┬─────────────────┘
                         ▼                                        │
                 GitHub Pages (public, data encrypted)            │
                         │                                        ▼
                         └────────────► apps/web (SvelteKit static, Track C) ◄── packages/analytics (TS, Track B)
                                         charts, windows, explorer, trends          pure functions on canonical data
```

**Why analytics are in TypeScript, not C#:** GitHub Pages can't run a server, and window stats must recompute
instantly as you drag. Running the math in the browser keeps it interactive and lets dropped files work with no backend.
C# does what needs secrets and scheduling: talking to Garmin/Oura, decoding FIT, encrypting, publishing.

**Why encryption:** Pages sites are public. Route GPS (often starting at home), heart rate and sleep are personal.

## Milestones (each track works toward these in parallel)

| Milestone | Done when | Needs |
|---|---|---|
| **M1 — Drop & see** | On the deployed site, dropping `easy-run.sanitized.fit` shows synced HR / pace / cadence / stride-length charts and drag-selecting a window shows its stats | A: TS FIT importer + local store · B: prepare, smooth, windowStats · C: shell, deploy, import UI, activity view |
| **M2 — Explore** | Segments, pinned-window compare, relationship explorer, overlay, suggestions; cycling and swimming views work with the synthetic fixtures | A: GPX/TCX · B: segments, relationship, overlay, suggestions · C: explorer, compare, multi-sport |
| **M3 — Sync** | Scheduled job pulls Garmin + Oura, publishes encrypted data; site unlocks a profile with its passphrase; trends + readiness pages use real data | A: C# importers, adapters, publish, sync.yml · B: load, readiness, correlations · C: unlock, trends, readiness |
| **M4 — Polish** | Imperial units, empty/error states, keyboard + accessibility pass, performance budget met, README with screenshots | all |

Track C (integrator) records milestone status in `docs/status/integration.md`.

## What the sample FIT file told us

(From the real run used to build `fixtures/fit/easy-run.sanitized.fit`, Garmin fenix 6.)

- **Smart recording** is on: samples every 1–6 s (702 points in 48 min). Analytics resamples to 1 Hz. **Everyone: set watches to Every Second recording** (System → Data Recording) for better window stats.
- **No running dynamics** (no measured stride length, ground contact, vertical oscillation) — those need an HRM-Pro/HRM-Run or Running Dynamics Pod. Stride length is **derived** = speed ÷ (cadence/60); ≈ 1.29 m per step on this run. The UI labels derived values.
- **No breathing rate** in this file and HRV logging off. Breathing-rate charts appear only when a device records it.
- FIT running cadence is per-foot (72–78) → canonical cadence is steps/min (≈ 156).
- Structured-workout laps carry intensities (warmup/active/cooldown) → interval segmentation works without guessing.

## One-time setup (humans, ~30 min)

1. **Repo:** create a GitHub repo (e.g. `pacelab`), push this starter to `main`. Public repo = free Pages; private repo needs a paid/education plan for Pages. Data is encrypted either way.
2. **Pages:** Settings → Pages → Source: **GitHub Actions**.
3. **Labels:** `for l in track-a track-b track-c contract-change blocked question bug; do gh label create $l --force; done`
4. **Each computer:** Node 22+, `gh auth login`, git identity. Track A's computer also needs the .NET 10 SDK.
5. **Watches:** switch to Every Second recording; enable HRV logging if offered.
6. **Later, for M3** (Track A's status file will say when): each person generates a Garmin Personal API key (Garmin Connect → account settings → personal API), registers an Oura API application (redirect `http://localhost:8765/callback`), runs `oura-login` once, and adds repo secrets as described in `docs/tracks/track-a-ingest.md`. Oura API access needs an active Oura membership on Gen3/Ring 4.

## Running the three agents

Paste the matching prompt from `prompts/` into each tool. Suggested split: **Cursor → Track B** (pure TypeScript,
test-driven, fully independent), **Claude Code → Track A and Track C** (C is the integrator who checks `main` after every merge).
To resume after a session ends, use `prompts/resume.md`.
