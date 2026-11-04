# Development (Lot 3)

## Requirements

- Node.js 24 and pnpm 10.34.9
- Docker Engine/Desktop with Docker Compose and free local port 55432
- A separate, disposable database for integration and smoke tests

## Local startup

From the repository root:

```sh
git clone https://github.com/jarod25/Travel-Atlas.git
cd Travel-Atlas
git switch develop
pnpm install --frozen-lockfile
docker compose -f infrastructure/docker/compose.yml up -d
export DATABASE_URL=postgresql://atlas_local:atlas_local_only@127.0.0.1:55432/atlas_local
pnpm db:migrate
pnpm dev
```

On PowerShell replace `export` with:

```powershell
$env:DATABASE_URL = 'postgresql://atlas_local:atlas_local_only@127.0.0.1:55432/atlas_local'
```

These credentials are for the **loopback-bound local database only**, not deployment.
The API defaults to `http://127.0.0.1:3001` and the Vite web app to
`http://127.0.0.1:5173`. `GET /health` only confirms HTTP startup, not database
readiness; `pnpm smoke:api` additionally queries the migrated database.

`pnpm dev` builds the internal database package before starting its API watcher. CI confirms compiled API startup and PostGIS-backed HTTP responses, not a manually operated local Docker Desktop/Vite development session.
`pnpm build` builds workspace packages in dependency order. The migrations directory
is resolved relative to the database module, not the shell working directory.

## Quality checks

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm smoke:api
```

`DATABASE_URL` must target a **disposable, migrated** PostGIS test database for
`pnpm test:integration` and `pnpm smoke:api`. Do not use personal, shared or
production data. The smoke script starts `apps/api/dist/server.js`, checks
`GET /health` and `GET /api/v1/trips`, and terminates the process. It requires
port 31987 to be free. CI applies migrations on its ephemeral PostGIS service
and checks the compiled server rather than assuming that a successful build runs.

The additional `pnpm smoke:web` test starts the compiled API on port 3001 and
Vite on port 31888, exercises a synthetic timeline through the Vite HTTP proxy,
and shuts down both processes. It **writes synthetic test data**. Only run it
against a dedicated migrated, disposable PostGIS database with an explicit
opt-in:

```sh
ATLAS_SMOKE_DISPOSABLE=1 pnpm smoke:web
```

In PowerShell, set `$env:ATLAS_SMOKE_DISPOSABLE = '1'` before running
`pnpm smoke:web`. Never enable this test against a personal or shared database.
The Playwright Chromium browser test is separate from this HTTP smoke check.
After `pnpm build`, on the same dedicated disposable database, run:

```sh
pnpm exec playwright install chromium
ATLAS_E2E_DISPOSABLE=1 pnpm test:e2e
```

In PowerShell set `$env:ATLAS_E2E_DISPOSABLE = '1'` before `pnpm test:e2e`.
Playwright starts the compiled API and Vite on ports 3001 and 5173; both
ports must be free. CI uses Ubuntu 24.04 for supported Chromium binaries.
Physical Android and MapLibre provider behavior still require separate checks.

## Shutdown and retention

Stop the development servers with Ctrl+C and then stop the local database:

```sh
docker compose -f infrastructure/docker/compose.yml down
```

The database volume is retained. **Warning:** appending `-v` deletes the
PostgreSQL volume and all records it contains. Never do this to a database
containing personal travel history.

## Git workflow

Create short `fix/*`, `feature/*`, `docs/*` or `chore/*` branches from
`develop`. Write commits and PRs in English, squash-merge only after successful
CI, and verify the resulting `develop` checks. Do not modify `main` or
publish a release during Lot 3 stabilization.

## Lot 0 and external providers

Local feasibility tests performed on November 3, 2026 subsequently succeeded on the user's PC: PostgreSQL 18 / PostGIS 3.6.2 and Drizzle geometry round-trips (LineString, MultiLineString, SRID 4326, GeoJSON, null geometry, distances and type constraints) passed. OpenRailRouting returned HTTP 200 for **both** `tgv_all` routes: Belfort-Montbéliard TGV → Strasbourg (754 points, 151,001.72 m) and Strasbourg → CDG 2 TGV (1,890 points, 418,097.822 m). The geometries were inspected and judged plausible by the user; they remain **estimated** network routes, not confirmed historical GPS tracks. Earlier DNS `EAI_AGAIN` failures occurred in a different analysis environment and were superseded by these successful local tests. These feasibility results do **not** mean the Lot 4 routing adapters are integrated with the Lot 3 application.
