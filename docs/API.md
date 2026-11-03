# API foundation (Lot 3)

Fastify provides a local REST API under `/api/v1`. The database adapter is isolated in
`packages/database/src/atlas-store.ts`; React never opens a database connection.

Routes: GET/POST /trips, GET /trips/:tripId, GET/POST /trips/:tripId/days,
GET /trips/:tripId/days/:dayId/timeline, GET/POST /places,
POST /trips/:tripId/days/:dayId/visits, POST /trips/:tripId/days/:dayId/reorder,
DELETE /trips/:tripId/days/:dayId/visits/:visitId, GET /explore/geojson.
All are relative to /api/v1.

No route proposal is automatically created, and an unknown geometry is not fabricated
as a direct segment. All mutations delegate to database transactions.
The API is intentionally bound to 127.0.0.1 by default and does not yet support remote
users or sharing. Do not expose it on a public network without authentication.

The current endpoints are an initial subset; conditional edits/ETags, archival of Trips,
full Leg editing and pagination remain for later increments.
