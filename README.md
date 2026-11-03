# Travel Atlas

**Travel Atlas** is an open-standards-based, full-stack geospatial application for reconstructing, organizing, and visualizing travel histories. The project combines interactive maps, multimodal route modeling, chronological trip management, and geographic data provenance.

> **Status:** Early development. The initial technical feasibility checks have been completed, but the trip editor, interactive map, import/export, and routing integrations are not yet implemented in this repository.

## Project goals

- Explore journeys on an interactive world map, organized by trip, day, visit, and transport leg.
- Record walking, cycling, rail, road, air, and maritime travel without conflating a station stop with a place visited.
- Reconstruct paths from available evidence, with editable, clearly labeled estimates where the original track is unavailable.
- Associate dates, photographs, transport modes, and evidence with geographic records.
- Filter, analyze, and eventually animate travel histories across devices.
- Preserve portable data through open formats and keep personal trip records private by design.

**Data integrity matters:** a routing engine produces a *proposed route*, not proof of the route actually traveled. Individual observations and geometries retain their provenance and confidence: **confirmed**, **estimated**, or **unknown**.

## Technology

| Area | Selected technology |
| --- | --- |
| Web client | React, TypeScript, Vite |
| API | Fastify, TypeScript |
| Database | PostgreSQL, PostGIS, Drizzle ORM |
| Map and route editing (planned) | MapLibre GL JS; geometry editor to be evaluated |
| Data exchange (planned) | GeoJSON and portable native backups; GPX later |
| Quality | Vitest, TypeScript, ESLint, Prettier, GitHub Actions |
| Workspace | pnpm monorepo |

The repository currently contains a minimal web/API foundation and test infrastructure, **not** the full feature set shown above.

## Getting started

Requires **Node.js 24** and **pnpm 10.34.9**.

```sh
pnpm install
pnpm dev
```

The web development server starts on Vite's default local port (normally `5173`), and the API listens on `127.0.0.1:3001`. The API exposes `GET /health`; no user data or external routing service is required for these initial screens.

Quality checks:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Database integration checks require a separate PostgreSQL/PostGIS **test database** and a `DATABASE_URL` environment variable:

```sh
pnpm test:integration
```

See [development guide](docs/DEVELOPMENT.md) for Windows setup and [architecture notes](docs/ARCHITECTURE.md) for technical boundaries.

## Feasibility findings

The first local proof-of-concept passed Drizzle/PostGIS round-trip checks for `LineString`, `MultiLineString`, SRID 4326, and unknown geometries. OpenRailRouting returned two proposed French TGV paths, but a computed shortcut around Mulhouse demonstrated why confirmed intermediate rail stops must be modeled as **routing waypoints**, not additional visits. Public railway routing access also needs a sustainable deployment strategy.

These are **proof-of-concept findings**, not assertions that the corresponding application features are already built.

## Development workflow

The initial foundation lives on `main`; daily integration uses `develop`. Changes are developed on `feature/<english-kebab-case>` branches and merged through pull requests, with automated checks. Releases are merged to `main` and tagged.

## Privacy and license

This repository contains application source code and **synthetic test data only**. Do not commit personal itineraries, GPS histories, photographs, tickets, passwords, or real database exports. The repository currently has **no open-source license**; redistribution rights are not granted by default.
