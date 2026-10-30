# Track C — Web app + integrator (SvelteKit)

**You own:** `apps/web/**`, `.github/workflows/deploy.yml`, `docs/status/track-c.md`, `docs/status/integration.md`.
**You consume:** `@pacelab/schema`, `@pacelab/data` (Track A), `@pacelab/analytics` (Track B) — package roots only.
**Branch:** `track-c/web`.

You are also the **integrator**: after any merge to `main` by Track A or B, pull `main`, run everything, smoke-test
the site, and file issues for anything broken or off-contract (details at the end).

Until A and B land real implementations, their functions throw "not implemented". Build against the types and
use the fixtures in `fixtures/canonical/` for development (load them directly in dev-only code paths or tests),
then switch to the real functions as soon as they merge. Never re-implement their logic in the app.

## C1 — App shell + deploy (M1)
- Create `apps/web` with the current SvelteKit (`npx sv create`, TypeScript, Svelte 5 runes; check current docs —
  SvelteKit 3 / Vite 8 / TypeScript 6 at the time of writing). Workspace package name `@pacelab/web`, scripts
  `check` (svelte-check), `test` (vitest), `build`.
- `adapter-static`, `fallback: '404.html'`, `ssr = false` in the root `+layout.ts` (client-only SPA), `paths.base`
  from `process.env.BASE_PATH` (set to `/<repo-name>` in CI, empty locally). Every link and fetch uses the base path.
- `.github/workflows/deploy.yml`: on push to `main` + `workflow_dispatch`; `permissions: pages: write, id-token: write, contents: read`;
  build with `BASE_PATH`; if a `data` branch exists, check it out and copy its `data/` into the build output;
  `actions/upload-pages-artifact@v4` + `actions/deploy-pages@v4` (keep this pair together; they must match).
- Layout: nav (Activities, Explore, Compare, Trends, Settings), profile switcher, global drag-and-drop zone.
- Charts: **ECharts** (`echarts` 6; import only the components you use). Large-data line series with `sampling: 'lttb'`,
  `connectNulls: false` so pauses and gaps show as breaks.

## C2 — Data layer in the app (M1)
- A `$lib/data` store: local store (always) + remote profiles (when `data/profiles.json` exists) → `mergeSources`.
- Import: drop/select files → `importActivityFile` → `putActivity`; show added / duplicate / failed per file.
- Unlock screen for remote profiles: passphrase → `openRemoteProfile`; key in memory, optional "remember for this tab"
  (`sessionStorage`). Clear message on `WrongPassphraseError`.
- Settings page: `AthleteSettings` per profile in `localStorage["pacelab.settings.<profileId>"]`, defaults from
  `DEFAULT_ATHLETE_SETTINGS`, zone presets per method; display units metric/imperial (pace min/km vs min/mi, m vs ft).

## C3 — Activity view (M1) — the heart of the app
- `prepare()` once per activity (memoize). Header with summary numbers.
- **Stacked synced charts**, one per selected channel, shared x-axis (elapsed / moving time / distance toggle),
  synced tooltips and zoom (`echarts.connect`). Channel picker from `PreparedActivity.available` using `CHANNEL_META`
  labels/units; derived channels get a "derived" badge with an explanation tooltip. Pace axes inverted.
- Smoothing selector (none / 5 s / 15 s / 30 s moving average, EWMA) → `smooth()`; raw values stay available.
- **Window selection:** drag on any chart (ECharts `brush` with `brushType: 'lineX'` on all x-axes, or a custom
  overlay) → `windowStats()` live while dragging (throttle to animation frames) → stats panel: per-channel
  mean/min/max/p10/p50/p90/trend, time in zones bar, drift, power or swim block. Show the window as a shaded band.
- Zoom vs select mode toggle; double-click resets. Window + channels encoded in the URL (`?w=600-1800&ch=heartRate,pace`).
- Laps table; clicking a lap selects it as the window.

## C4 — Segments + compare windows (M2)
- Segment overlay selector (laps / km / mile / intervals / HR zones / hills / swim lengths / halves) drawn as bands; click → select.
- **Pin window** button → pinned list; compare table of pinned windows side by side with a delta column vs the first;
  "pin all segments of this kind" shortcut (e.g. compare every interval).

## C5 — Relationship explorer (M2) — `/explore`
- Pick activities (multi-select with sport filter), scope (whole / pinned windows / a segment kind → one group each),
  x / y / colour channels, bucket size, smoothing. Scatter with per-group colours and fit lines, legend with slope and r.
- Presets: "stride length vs speed (colour HR)", "cadence vs speed", "HR vs pace", "power vs HR", "SWOLF vs pace".
- Clicking a point opens that activity at that time.

## C6 — Compare / overlay (M2) — `/compare`
- 2–5 activities, by moving time or distance, any common channel → `overlay()`.

## C7 — Suggestions + multi-sport (M2)
- Suggestions panel on the activity view: severity icon, title, detail, evidence list (click evidence with a window → select it), confidence.
- Cycling (power, NP/IF/TSS) and swimming (lengths table, pace/100 m, SWOLF) variants using the synthetic fixtures.

## C8 — Trends + readiness (M3) — `/trends` and dashboard
- Load chart (ATL / CTL / TSB) from `loadSeries`; efficiency and decoupling over time per sport; readiness history with
  the provider's score alongside; today's readiness card with each component's contribution (bars around 50) and
  confidence; correlations table with n and hedged wording; sleep charts (duration, stages, HRV, resting HR).
- Footer note: "Not medical advice."

## C9 — Polish (M4)
Empty/loading/error states; keyboard access for selection and pinning; colour-blind-safe palette; responsive layout;
performance (first activity render < 1 s for a 2 h activity on a laptop); README with screenshots (synthetic data only).

## Integrator duties (every session, and after every A/B merge)
1. `git fetch && git log origin/main --oneline -10`; merge `origin/main` into your branch.
2. `npm ci && npm run verify && dotnet build sync && dotnet test sync`.
3. Smoke test: `npm run build -w apps/web && npm run preview -w apps/web`; drop `fixtures/fit/easy-run.sanitized.fit`;
   check charts render, a window selection returns stats, no console errors. Automate this with a Playwright test in
   `apps/web/tests/` as soon as C3 lands, and run it in CI by adding it to `apps/web`'s `test` script.
4. Check contract compliance: signatures in `packages/*/src/index.ts` unchanged except via `contract-change` issues;
   nobody edited files outside their ownership (`git log --stat origin/main`).
5. Problems → issue labelled with the owner's track + `bug`, with reproduction steps. Don't fix other tracks' code.
6. Append a dated line to `docs/status/integration.md`: what merged, verify result, milestone progress.

## Definition of done (every task)
Component/unit tests where logic lives in the app (formatting, URL state, unit conversion); svelte-check clean;
deployed site still works; status file updated.
