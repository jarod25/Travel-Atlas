# Database — initial schema

The first persistence increment covers `trips`, `trip_days`, and `places`.
It uses Drizzle ORM mappings and a committed SQL migration managed by the Drizzle
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
- Deleting a trip cascades to its days. Places remain reusable and independent.

Only synthetic fixtures are used in integration tests. The migrations create
persistent tables: run them in a disposable database during CI. Geographic
coordinate bounds and application-level validation remain future work.

## Next increment

Introduce `visits` and `legs` with same-trip foreign keys, visit ordering,
draft provenance fields, and transactionally persisted draft-leg planning.
