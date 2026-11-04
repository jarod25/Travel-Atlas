# Database — initial schema

The first persistence increments cover `trips`, `trip_days`, `places`, `visits`, and `legs`.
They use Drizzle ORM mappings and committed SQL migrations managed by the Drizzle
migrator. PostgreSQL 18 with PostGIS 3.6 is the current target.

## Setup

For local development use the PostgreSQL/PostGIS Compose service described in
[Development](DEVELOPMENT.md), or configure an equivalent database. Set `DATABASE_URL`
explicitly in the shell; `.env.example` is not loaded automatically.
Never point integration tests at production or personal travel data.

From the repository root:

```sh
pnpm db:migrate
pnpm test:integration
```

The CLI resolves the migration directory relative to `packages/database/src/migrate.ts`
(or its compiled output), regardless of the current working directory.
Migrations are tracked in the `drizzle.__drizzle_migrations` table.
Do not edit applied migrations; add a new migration in a later increment.

## Semantics

- `trips.title` is required and nonblank.
- `trip_days.position` is zero-based, nonnegative, unique within a trip.
- `trip_days.local_date` is a nullable calendar date, never an inferred UTC instant.
- `places.location` is a nullable PostGIS Point with SRID 4326 and a GiST index.
- A missing point is `NULL`, not the valid coordinate `(0, 0)`.
- A unique `(trip_id, id)` key on days anticipates future same-trip composite references.
- Deleting a trip cascades to its days, then to visits. Places remain reusable and independent.
- `visits` must reference a day of the same trip (composite foreign key).
- Visit positions are nonnegative and unique per day, while the same Place can be visited repeatedly.
- Deleting a day deletes its visits; a Place is never automatically deleted with a visit.

Only synthetic fixtures are used in integration tests. The migrations create
persistent tables: run them in a disposable database during CI. Geographic
coordinate bounds and application-level validation remain future work.

- `legs` references both endpoint visits using composite `(trip_id, visit_id)` foreign keys.
- A Leg cannot connect a visit to itself or reuse a current incoming/outgoing endpoint.
- Historical links may remain with `is_current = false`; deletion of referenced visits is restricted until Leg history is handled.
- Transport and each confidence dimension are independent. Draft values default to `unknown` and transport to `NULL`.
- Local calendar dates, wall-clock times and optional timezone strings are preserved without inferred UTC instants. A clock time requires a date.
- Cross-day Legs can be represented, but only future application-level explicit Connect Days may create them.

## Atomic append repository

`appendVisitToDay()` locks the parent day, creates the new visit and its intra-day
draft leg in one database transaction. An empty day yields no Leg; an existing day
links only to its last Visit. If that Visit already has a current outgoing Leg (such as
an explicit cross-day connection), append rejects the edit until an explicit disconnect. Failed Leg inserts roll back the Visit, and concurrent
appends are serialized by the parent-day row lock. No inter-day Leg is inferred.

## Atomic reordering

`reorderVisitsInDay()` locks the day, validates an exact visit permutation,
archives only current intra-day Legs whose adjacency changes and creates unknown
draft Legs only for newly adjacent pairs within one transaction. Unchanged ordered
endpoint pairs retain the original current Leg, its confidence, saved route versions
and evidence. Pending proposals on retired Legs are invalidated. Temporary positions prevent transient uniqueness errors.
An unchanged order is a no-op. A current cross-day link blocks reordering
rather than being silently detached.

## Versioned route geometry

`route_versions` stores independently versioned optional LineString/MultiLineString
PostGIS geometries (SRID 4326), nullable geodesic distances in meters, provenance,
confidence and provider. A composite FK guarantees same-trip Leg ownership;
version numbers are unique per Leg. A GiST index supports spatial queries.
The geometry is supplied through parameterized SQL using `ST_GeomFromGeoJSON`
and retrieved through `ST_AsGeoJSON`, not by assuming PostGIS binary data is
GeoJSON. Geometry may be NULL rather than fabricating a straight line.

`route_waypoints` contains ordered version-specific Point geometries.

## Persistent proposals and selection

`route_proposals` stores pending/accepted/rejected/invalidated candidates,
serialized provider parameters, snapshot endpoints and transport, optional linear
geometry, provider and review timestamps. A candidate does not affect statistics
or the selected route. The database checks valid states, linear geometry and
review timestamps, and keeps proposals across sessions.

`legs.selected_route_version_id` is a nullable composite FK pointing only to a
version of the very same Leg. Selecting an estimated route never automatically
confirms the Leg's historical geometry.

## Transactional route acceptance

`acceptRouteProposal()` locks the parent Leg, verifies the stored endpoint and
transport snapshot, and atomically creates an Estimated RouteVersion, selects
it and marks the proposal Accepted. Concurrent accepts are idempotent. When
inputs have changed, it persistently Invalidates the proposal without creating
a version. Missing geometry causes transaction rollback. The accepted version
is recorded on the proposal with a same-Leg foreign key; no confidence is
silently upgraded to Confirmed.

## Additional provenance and metadata tables

`evidence` holds source references without embedding private file bytes.
`evidence_links` uses typed nullable FKs and a database check requiring exactly
one target, plus a field path and independent confidence. `visit_time_observations`
stores independent local dates/times and source references without upgrading
Leg precision. `media_assets` stores file metadata and nullable Point locations,
not file contents. `place_external_refs` tracks provider IDs while retaining
Place reuse. `app_settings` stores JSON preferences. No unknown value is
silently converted into confirmed geometry, time or presence.

## Remaining Lot 2 validation

Run migration, constraint and transaction tests against PostgreSQL/PostGIS,
then review repository-wide consistency and record any limitations before
advancing to Lot 3.

## Visit archival and timeline integrity

`archiveVisitFromDay()` marks a Visit archived rather than deleting evidence
or breaking historical Leg foreign keys. It archives only links affected by the removed Visit, retaining unchanged current
links and their evidence. New adjacency receives an unknown draft atomically.
An active cross-day connection blocks the operation. The per-day unique
position index applies only to active Visits; archived rows retain their
historical positions. Append and reorder operations ignore archived Visits.
