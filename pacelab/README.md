# Pacelab

Personal workout explorer: interactive charts for heart rate, pace, cadence, stride length, power, breathing rate and
more from Garmin, Oura and any FIT/GPX/TCX file. Select any part of a workout for stats on just that part, compare
segments and runs, see how sleep and recovery relate to performance, and get explainable suggestions.
Running, cycling, swimming. Static site on GitHub Pages; personal data stays encrypted.

- **Plan:** [docs/PLAN.md](docs/PLAN.md)
- **Contracts between the three tracks:** [docs/CONTRACTS.md](docs/CONTRACTS.md)
- **Rules for agents:** [AGENTS.md](AGENTS.md)
- **Agent prompts:** [prompts/](prompts/)

```
packages/schema     shared canonical types + JSON Schema   (contract)
packages/data       browser importers, encrypted bundle reader, local store   (Track A)
packages/analytics  window stats, segments, relationships, load, readiness, suggestions   (Track B)
apps/web            SvelteKit static site   (Track C)
sync/               C# .NET 10: Garmin + Oura sync, FIT decoding, encryption   (Track A)
fixtures/           sanitized + synthetic test data (no personal data)
```

```bash
npm ci && npm run verify
dotnet build sync && dotnet test sync
```

Not medical advice. Personal, non-commercial use of the Garmin Connect Personal API and Oura API.
