# Architecture — verified Lot 3 boundary

## Implemented on develop

- `apps/web`: React, TypeScript and Vite; Explore and Trip Editor.
- `apps/api`: Fastify REST API under `/api/v1`; compiled Node.js ESM with explicit relative `.js` imports.
- `packages/database`: Drizzle ORM repositories, committed incremental SQL migrations and PostgreSQL/PostGIS geometry storage.
- `packages/shared`: shared types and domain helpers.
- `infrastructure/docker/compose.yml`: local PostgreSQL/PostGIS.
- `tests/integration`: synthetic database fixtures; `tests/smoke/api-start.mjs`: compiled API and HTTP/database smoke test; `tests/smoke/web-api-journey.mjs`: Vite proxy and synthetic timeline lifecycle smoke test; `tests/e2e` runs a Playwright Chromium UI journey against an isolated PostGIS database.

The web client communicates with the Fastify API, never directly with PostgreSQL. The CI builds packages in workspace dependency order, migrates a disposable PostGIS database, tests, and launches the **compiled API** to verify real Node execution.

## Domain and history invariants

`Trip → TripDay → Visit` organizes history. A reusable `Place` may appear in multiple Visits. `Leg` connects two Visits of the same Trip; its movement, transport, timings, and geometry confidence are independent. `RouteVersion` retains historical geometry and metadata; `RouteProposal` is a separately persisted candidate that is **not evidence of a confirmed journey**.

A missing location or route remains null/Unknown, never a fabricated coordinate or straight segment. Visit reorder/archive operations preserve a current Leg when its ordered endpoints remain adjacent. Changed adjacency retires its Leg without deleting historical evidence, recorded RouteVersions or certainty. Day archival snapshots intra-day Leg IDs (migration 0013); restoration reactivates unchanged intra-day connections. Cross-day Legs are never restored automatically and require explicit connect/disconnect actions. Earlier archived days without a snapshot can only reconstruct Unknown drafts.

Visit Place corrections retain the Visit ID and its Leg history (migration 0014), using optimistic revisions. Shared Place coordinate corrections use optimistic revisions (migration 0015) and invalidate dependent **pending** proposals transactionally. Known facts are not automatically promoted to Confirmed.

## Mapping, reliability and privacy

Explore displays saved Point and selected linear geometry through MapLibre GL JS and OpenFreeMap. MapLibre is dynamically imported from a CDN; map tiles and the CDN require network access. If map initialization fails, timeline editing remains available, but a fully offline map is **not** implemented. No server-generated fake geometry is used.

The code repository is public; only synthetic fixtures may be committed. Personal itinerary data, traces, media, evidence and secrets must remain in private runtime storage. There is no authentication, external sharing, deployment, production-ready authorization, or protected multiuser API yet. Do not expose the local API to the public Internet.

## Lot boundaries

**Implemented and exercised in CI:** trip/day CRUD foundations and archival, Visit creation/reorder/soft archive/Place correction, basic Leg editing, explicit day connection/disconnection, Explore GeoJSON, PostGIS migrations and compiled API smoke tests.

**Partial or requiring hands-on verification:** responsive experience and map selection on actual Android/desktop, full startup via `pnpm dev` on a user workstation, comprehensive end-to-end browser coverage, availability of the external tile CDN, robust global handling of simultaneous edits, proposal input snapshots.

**Not implemented in Lot 3:** Lot 4 routing adapters and provider-driven proposals; Lot 5 import/export and portable restore; future Android background GPS, Suggested Visits, narrative import, statistics completion and sharing.

## Lot 0 feasibility — accurately scoped

Local feasibility tests performed on November 3, 2026 subsequently succeeded on the user's PC: PostgreSQL 18 / PostGIS 3.6.2 and Drizzle geometry round-trips (LineString, MultiLineString, SRID 4326, GeoJSON, null geometry, distances and type constraints) passed. OpenRailRouting returned HTTP 200 for **both** `tgv_all` routes: Belfort-Montbéliard TGV → Strasbourg (754 points, 151,001.72 m) and Strasbourg → CDG 2 TGV (1,890 points, 418,097.822 m). The geometries were inspected and judged plausible by the user; they remain **estimated** network routes, not confirmed historical GPS tracks. Earlier DNS `EAI_AGAIN` failures occurred in a different analysis environment and were superseded by these successful local tests. These feasibility results do **not** mean the Lot 4 routing adapters are integrated with the Lot 3 application.

## Local verification

For exact install, migration, start, check and shutdown commands, see [Development](DEVELOPMENT.md). For table semantics and additive migrations see [Database](DATABASE.md); for HTTP routes see [API](API.md). The design and scope references are the project's functional specification and technical architecture dated November 3, 2026.
