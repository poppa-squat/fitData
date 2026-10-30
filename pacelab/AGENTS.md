# Rules for every agent working in this repo

Three AI agents build Pacelab in parallel on three computers (one in Cursor, two in Claude Code).
You are one of them. You know which track you are from your prompt. Read, in order:
this file → `docs/PLAN.md` → `docs/CONTRACTS.md` → `docs/tracks/<your track>.md` → `docs/status/<your track>.md`.

## Tracks

| Track | Branch | Owns | Stack |
|---|---|---|---|
| **A — Ingest** | `track-a/ingest` | `sync/**`, `packages/data/**`, `fixtures/**`, `.github/workflows/sync.yml` | C# .NET 10 + TypeScript |
| **B — Analytics** | `track-b/analytics` | `packages/analytics/**` | TypeScript |
| **C — Web + integrator** | `track-c/web` | `apps/web/**`, `.github/workflows/deploy.yml`, `docs/status/integration.md` | SvelteKit (Svelte 5) + TypeScript + ECharts |

Full ownership table: `docs/CONTRACTS.md` §9. **Never edit files you don't own.** If you need a change there,
open an issue for the owner (below). Shared contract files change only via `docs/CONTRACTS.md` §8.

## Hard rules

1. **No personal data in git.** Never commit real `.fit/.gpx/.tcx`, exports, tokens, API keys, passphrases or anything under `data/`. Real files live in `fixtures/private/` (gitignored). CI has a `privacy` job; don't weaken it.
2. **Code against the contract, not against another track's internals.** Import only from `@pacelab/schema`, `@pacelab/data`, `@pacelab/analytics` package roots.
3. **Green before merge.** `npm run verify` and `dotnet build sync && dotnet test sync` must pass locally, and CI must be green on your branch.
4. **Small, frequent merges.** Merge to `main` every time a task in your track file is done — at least once per working session. Never sit on more than ~400 changed lines.
5. **Don't break main.** If `main` goes red after your merge, fixing it is your top priority.
6. **Units are canonical** (`docs/CONTRACTS.md` §2). Convert only for display, only in `apps/web`.
7. **No new runtime dependencies in shared packages** (`packages/schema`) without a `contract-change` issue. In your own package, prefer small, well-maintained deps and say why in the commit message.
8. **Tests are part of the task.** Every function you add gets a test; every bug you fix gets a regression test. Use the fixtures in `fixtures/canonical/`.

## Merge protocol (no human review; Track C reviews main after each merge)

```bash
git fetch origin
git merge origin/main                 # into your track branch; resolve conflicts (see lockfile rule)
npm ci && npm run verify              # plus dotnet build/test if you touched sync/
git push origin HEAD
BR=$(git branch --show-current)       # open a PR unless one is already open for this branch
[ -n "$(gh pr list --head "$BR" --state open --json number -q '.[].number')" ] || gh pr create --base main --head "$BR" --fill --label track-<you>
gh pr checks --watch                  # wait for CI
gh pr merge --merge                   # keep your track branch; don't delete it
```

Then update `docs/status/<your track>.md` (what landed, what's next, anything blocked) in your next commit.
If `gh pr merge` fails because main moved, repeat from `git fetch`.

**Lockfile rule:** never hand-merge `package-lock.json`. On conflict:
`git checkout origin/main -- package-lock.json && npm install && git add package-lock.json`.

## Talking to the other agents (GitHub Issues)

- Labels: `track-a`, `track-b`, `track-c` (who should act), plus `contract-change`, `bug`, `question`, `blocked`.
  Create missing labels with `gh label create <name>`.
- **At the start of every session and after every merge:** `gh issue list --state open --label track-<you>` and handle them first.
- Need something from another track? Open an issue with their label, describe exactly what you need (function, field, example input/output) and keep working on something else. Don't wait idle.
- Answer questions in the issue thread, close it with the commit SHA when done.
- Humans may file issues too; treat them as top priority.

## Commands

```bash
npm ci                     # install all workspaces
npm run check              # tsc / svelte-check in every workspace
npm test                   # vitest in every workspace
npm run build              # builds apps/web
npm run verify             # all three
dotnet build sync && dotnet test sync
npm run dev -w apps/web    # local site (Track C)
```

Toolchain: Node 22+, .NET 10 SDK, `gh` CLI logged in, Python 3.12 only for `fixtures/tools/`.

## Style

- TypeScript strict, ES modules, no `any` in exported APIs. Svelte 5 runes.
- C#: nullable enabled, warnings are errors, records for data, `CanonicalJson.Options` for every serialization.
- Commit messages: `track-x: <what> (<why if not obvious>)`.
- When unsure about a product decision, pick the option that keeps data private and the UI simple, write the decision in your status file, and move on.
