# Lot 3 — Explore and Trip Editor

The web app uses React + Vite and the local Fastify API. Start both with `pnpm dev`.
The Vite dev server proxies `/api` to the local API, which needs a PostgreSQL
database with applied migrations. No synthetic travel data is loaded by default.

- Explore renders recorded Point and saved LineString/MultiLineString geometries.
  Unknown geometry stays invisible, never fabricated as a straight segment.
- Trips creates a trip and opens the editor.
- Trip Editor creates days, searches existing Places, creates reusable Places,
  adds visits, reorders/archives visits transactionally and displays draft Legs.
- Desktop uses timeline left/map right; mobile exposes Timeline and Map tabs.
- Forms default to minimum required fields; dates, coordinates and transports
  remain unknown unless entered.

MapLibre GL JS 6.16.0 is currently loaded via a pinned CDN ES module and CSS,
and uses the OpenFreeMap Liberty style. An offline/local bundle is preferable
before deployment. If CDN or tiles fail, the timeline still works. The browser
sends map views and tile requests to the map provider, which will require a
privacy disclosure before sharing the app externally.

Still missing for full product scope: detailed Leg edits, trip archival,
revision/If-Match conflict handling, MapLibre editing controls, geographic
search providers and guided routing. These belong to subsequent increments.

The optional coordinate editor attaches a WGS84 point to the selected reusable Place with explicit location confidence. No coordinates are inferred; edits affect all Visits of that Place.
