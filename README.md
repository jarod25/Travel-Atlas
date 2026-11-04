# Travel Atlas

**Travel Atlas** is an open-standards-based, full-stack geospatial application for reconstructing, organizing, and visualizing travel histories. The project combines interactive maps, multimodal route modeling, chronological trip management, and geographic data provenance.

> **Status:** Lot 3 (Explore and Trip Editor foundation) is implemented on `develop`. The interactive map, trip/day/visit editing, evidence-aware filtering, and guarded Leg editing are available. Import/export, automated routing, GPS recording, authentication, and deployment remain future work.

## Project goals

- Explore journeys on an interactive world map, organized by trip, day, visit, and transport leg.
- Record walking, cycling, rail, road, air, and maritime travel without conflating a station stop with a place visited.
- Reconstruct paths from available evidence, with editable, clearly labeled estimates where the original track is unavailable.
- Associate dates, photographs, transport modes, and evidence with geographic records.
- Filter, analyze, and eventually animate travel histories across devices.
- Preserve portable data through open formats and keep personal trip records private by design.

**Data integrity matters:** a routing engine produces a _proposed route_, not proof of the route actually traveled. Individual observations and geometries retain their provenance and confidence: **confirmed**, **estimated**, or **unknown**.

## Technology

| Area                    | Selected technology                                  |
| ----------------------- | ---------------------------------------------------- |
| Web client              | React, TypeScript, Vite                              |
| API                     | Fastify, TypeScript                                  |
| Database                | PostgreSQL, PostGIS, Drizzle ORM                     |
| Interactive map         | MapLibre GL JS (CDN-loaded); OpenFreeMap tiles       |
| Data exchange (planned) | GeoJSON and portable native backups; GPX later       |
| Quality                 | Vitest, TypeScript, ESLint, Prettier, GitHub Actions |
| Workspace               | pnpm monorepo                                        |

The repository contains a functional local Explore and Trip Editor foundation, **not** the complete product scope. See [Lot 3 feature guide](docs/TRIP_EDITOR.md) and [API guide](docs/API.md) for supported operations and limitations.

## Getting started

Requires **Node.js 24** and **pnpm 10.34.9**.

```sh
pnpm install --frozen-lockfile
docker compose -f infrastructure/docker/compose.yml up -d
export DATABASE_URL=postgresql://atlas_local:atlas_local_only@127.0.0.1:55432/atlas_local
pnpm db:migrate
pnpm dev
```

The web development server starts on Vite's default local port (normally `5173`), and the API listens on `127.0.0.1:3001`. The API exposes `GET /health`. The local Docker Compose service provides PostgreSQL/PostGIS using **development-only** credentials; migrations must be applied before starting. No personal travel data is seeded. Set `DATABASE_URL` in the shell (PowerShell instructions below). Map tiles and the current MapLibre CDN bundle require network access. No Playwright browser E2E suite is enabled yet. See [database guide](docs/DATABASE.md) for setup.

Quality checks:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm smoke:api # requires a migrated disposable database and DATABASE_URL
```

The CI also runs `pnpm smoke:web`: it launches the compiled API and Vite, then exercises a synthetic Trip/Day/Visit/Leg journey through the Vite `/api` proxy. This check requires `ATLAS_SMOKE_DISPOSABLE=1` and a **separate disposable database** because it creates records. It is not a browser-driven Playwright E2E test.

Database integration checks require a separate PostgreSQL/PostGIS **test database** and a `DATABASE_URL` environment variable:

```sh
pnpm test:integration
```

Stop `pnpm dev` with Ctrl+C, and use `docker compose -f infrastructure/docker/compose.yml down` to stop PostgreSQL **without deleting its volume**. See [development guide](docs/DEVELOPMENT.md) for Windows setup and [architecture notes](docs/ARCHITECTURE.md) for technical boundaries.

## Feasibility findings (verified scope)

Local feasibility tests performed on November 3, 2026 subsequently succeeded on the user's PC: PostgreSQL 18 / PostGIS 3.6.2 and Drizzle geometry round-trips (LineString, MultiLineString, SRID 4326, GeoJSON, null geometry, distances and type constraints) passed. OpenRailRouting returned HTTP 200 for **both** `tgv_all` routes: Belfort-Montbéliard TGV → Strasbourg (754 points, 151,001.72 m) and Strasbourg → CDG 2 TGV (1,890 points, 418,097.822 m). The geometries were inspected and judged plausible by the user; they remain **estimated** network routes, not confirmed historical GPS tracks. Earlier DNS `EAI_AGAIN` failures occurred in a different analysis environment and were superseded by these successful local tests. These feasibility results do **not** mean the Lot 4 routing adapters are integrated with the Lot 3 application.

## Development workflow

The initial foundation lives on `main`; daily integration uses `develop`. Changes are developed on `feature/<english-kebab-case>` branches and merged through pull requests, with automated checks. Releases are merged to `main` and tagged.

## Privacy and license

This repository contains application source code and **synthetic test data only**. Do not commit personal itineraries, GPS histories, photographs, tickets, passwords, or real database exports. The repository currently has **no open-source license**; redistribution rights are not granted by default.
