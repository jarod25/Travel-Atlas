# Database — initial schema

The first persistence increments cover `trips`, `trip_days`, `places`, `visits`, and `legs`.
They use Drizzle ORM mappings and committed SQL migrations managed by the Drizzle
migrator. PostgreSQL 18 with PostGIS 3.6 is the current target.

## Setup

Set `DATABASE_URL` to a **dedicated local database** with PostgreSQL/PostGIS
installed. Never point integration tests at production or personal travel data.

From the repository root:

```sh
pnpm --filter @travel-atlas/database db:migrate
pnpm test:integration
```

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
links only to its last Visit. Failed Leg inserts roll back the Visit, and concurrent
appends are serialized by the parent-day row lock. No inter-day Leg is inferred.

## Atomic reordering

`reorderVisitsInDay()` locks the day, validates an exact visit permutation,
archives previous current intra-day Legs and creates new unknown draft Legs
within one transaction. Temporary positions prevent transient uniqueness errors.
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

## Next increment

Add persistent route proposals and guarded version selection.
