# API foundation (Lot 3)

Fastify provides a local REST API under `/api/v1`. The database adapter is isolated in
`packages/database/src/atlas-store.ts`; React never opens a database connection.

Routes: GET/POST /trips, GET /trips/:tripId, GET/POST /trips/:tripId/days,
GET /trips/:tripId/days/:dayId/timeline, GET/POST /places,
POST /trips/:tripId/days/:dayId/visits, POST /trips/:tripId/days/:dayId/reorder,
DELETE /trips/:tripId/days/:dayId/visits/:visitId, GET /explore/geojson.
All are relative to /api/v1.

Archived Trips and days reject Visit timeline mutations with HTTP 409. Edits to
historical Legs are refused, and day dates cannot be changed while archived.

No route proposal is automatically created, and an unknown geometry is not fabricated
as a direct segment. All mutations delegate to database transactions.
The API is intentionally bound to 127.0.0.1 by default and does not yet support remote
users or sharing. Do not expose it on a public network without authentication.

The API is an initial subset. Trip, Day, Visit, Place and Leg revision-checked updates are implemented; pagination, authentication and complete route-provider endpoints are not.

## Leg editing and concurrency

PATCH /api/v1/legs/:legId accepts validated evidence-sensitive fields and requires
`If-Match: "<revision>"`. Missing precondition is 428; stale revisions return
412 and the latest ETag. The Drizzle repository takes a Leg row lock and updates
one revision atomically. Changing transport invalidates pending proposals,
clears selected route geometry, and preserves historical versions.

## Place coordinates

PATCH /api/v1/places/:placeId saves an explicit [longitude, latitude] point with independent confidence. API and PostgreSQL validate bounds. Coordinates remain null until supplied. One Place can be reused across Visits.

## Trip changes

PATCH /api/v1/trips/:tripId requires an If-Match revision and accepts a nonempty
trimmed title and/or soft-archival state. GET /trips?includeArchived=true lists
archived trips for restoration; Explore omits them from mapping by default.
A stale revision returns 412 rather than overwriting another edit.

## Day dates and Leg local time

PATCH /api/v1/trips/:tripId/days/:dayId changes a day's optional local calendar
date with the same If-Match/412 precondition semantics. Leg PATCH supports
independent optional local departure/arrival dates, wall-clock times and
confidence, without inventing a timezone or UTC timestamp.

## Explicit inter-day connections

POST /api/v1/trips/:tripId/connect-days accepts fromDayId/toDayId (adjacent
ordered days) and atomically creates one unknown draft Leg from the final
active Visit of one day to the first of the next. Repeating the same connection
is idempotent. Timeline responses include crossDayLegs separately from intra-day
Legs. No connection is inferred automatically.

## Day archival

PATCH /api/v1/trips/:tripId/days/:dayId/archive accepts `{ "isArchived": true|false }`
and a required `If-Match: "<revision>"` header. It returns 428 without a revision,
412 on a stale revision, and ETag on success. Archiving preserves Visit rows and
historic Legs, while removing current intra-day and inter-day links. Restoring reactivates the snapshotted original intra-day Legs for unchanged ordered endpoints (migration 0013); days archived before that migration restore with Unknown drafts. Cross-day routes are never restored automatically.
Archived days reject Visit editing (409).

## Explicit day disconnection

`POST /api/v1/trips/:tripId/disconnect-days` accepts the JSON body
`{ "fromDayId": "<uuid>", "toDayId": "<uuid>", "legId": "<uuid>" }`
and requires the current Leg's `If-Match: "<revision>"` header. It returns
428 when missing, 412 on stale revision and 409 for an inconsistent day boundary.
The connection must be current, between two consecutive non-archived days in
the same non-archived Trip, with the exact last/first active Visit endpoints.
Disconnecting preserves the historical Leg, RouteVersions and evidence while
invalidating its pending proposals. A later explicit Connect Days reactivates a
single historical Leg for the same directed Visit pair, preserving its facts,
RouteVersions and evidence. When several historical Legs match, it creates a
new Unknown draft rather than guessing which journey was intended.

### Existing Visit Place correction (Lot 3 stabilization)

`PATCH /api/v1/trips/:tripId/days/:dayId/visits/:visitId` requires `If-Match: "<visit revision>"` and a body `{ "placeId": "<uuid>" }` (or `null` for unknown). It changes the referenced reusable Place without recreating the Visit. The response includes the incremented revision and an ETag. A stale revision returns 412, archived trips/days return 409, and invalid or missing references are rejected. Pending route proposals for current adjacent Legs are invalidated; recorded Legs and historical evidence are retained.

### Optimistic Place coordinate edits (Lot 3 stabilization)

`PATCH /api/v1/places/:placeId` now requires `If-Match: "<place revision>"`, alongside `coordinates` and `confidence`. A stale revision returns HTTP 412 and a current ETag; missing `If-Match` returns 428. The response includes the latest Place revision. Coordinate edits and dependent pending RouteProposal invalidations run in one transaction. A certainty-only edit does not invalidate geometry proposals.

## Trip hierarchy and time endpoints (Lot 3 stabilization)

`POST /api/v1/trips` accepts optional `parentTripId`. `PATCH /api/v1/trips/:tripId` accepts `parentTripId`, `manualStartDate`, and `manualEndDate` with an If-Match revision. A hierarchy cycle, archived ancestor or incompatible move is rejected; manual overrides remain separate from computed dates. List responses include computed boundaries and parent-archive state.

`GET /api/v1/trips/:tripId/combined-days` lists active days across the selected Trip and all descendants once, including each Day's actual owning Trip and hierarchy depth.

`POST /api/v1/trips/:tripId/connect-trip` requires `fromDayId`, `toTripId`, and `toDayId`; it connects only recorded last/first Visit endpoints in a common active family, after explicit confirmation. `POST /api/v1/legs/:legId/disconnect-trip` requires `If-Match` and preserves historical Leg details. Neither endpoint estimates movement or geometry.

`GET /api/v1/legs/:legId/time-zone-suggestions` returns arrays of IANA candidates for both saved Place coordinates with provenance `recorded-place-coordinates` and `confirmed:false`. Coordinates are not sent to an external API; lookup uses the bundled `geo-tz` dataset.

`PATCH /api/v1/legs/:legId` supports independent `departureTimePrecision`/`arrivalTimePrecision`, optional IANA zones, and local `departureRangeStart`/`departureRangeEnd` plus arrival equivalents. Server-side validation rejects malformed ranges and invalid zones. It does not turn local time into an automatically confirmed UTC instant.
