# Architecture overview

This document records **selected directions**, not completed features.

## Structure

- `apps/web`: React + TypeScript + Vite client.
- `apps/api`: Fastify + TypeScript HTTP API.
- `packages/shared`: shared domain types and invariants.
- `tests/integration`: database integration tests with synthetic fixtures.

## Domain

The intended hierarchy is **Trip → TripDay → Visit → Leg**. A place can be reused by multiple visits. A train station stop used solely as a routing waypoint is not counted as a visit.

Confidence is not a single trip-level boolean: route geometry, transport mode, timestamps, and visits may independently be **confirmed**, **estimated**, or **unknown**. Routing results are proposals with provenance and a review state.

Planned persistence uses PostgreSQL/PostGIS, Drizzle ORM, GeoJSON, explicit geometry SRID 4326, and versioned route proposals. It must be possible to store a Leg without known geometry.

## Mapping and routing

MapLibre GL JS is the planned map renderer; editing tools require separate validation. Railway proposals were tested against OpenRailRouting, but the public server is for experimentation, not a validated production dependency. A result that bypasses Mulhouse-Ville despite a confirmed train stop shows why train-route waypoints need explicit support.

## Privacy

The source repository is public. Real itineraries, tracks, evidence documents, GPS samples, photographs, and secrets must remain in private application storage, not in Git.

## Roadmap boundary

The initial commit is only a working skeleton. The map, timeline, visit/leg CRUD, routing integration, evidence handling, backup/export, and statistics belong to later feature branches. The detailed product specifications live in the project's private planning documents.
