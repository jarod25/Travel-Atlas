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

Still missing for full product scope: map-based geometry editing, geographic
search providers, guided routing, import/export, authentication and sharing.
Trip archival, revision/If-Match conflict handling and basic Leg edits are
implemented in later Lot 3 increments described below.

The optional coordinate editor attaches a WGS84 point to the selected reusable Place with explicit location confidence. No coordinates are inferred; edits affect all Visits of that Place.

The Trips page supports rename, soft archive and restore with revision checks.
Archival preserves all related visits, legs and evidence. Archived trips remain
available for restoration but are hidden from Explore by default.

Trip Editor can correct a day date with a revision check and edit departure/arrival
local dates, clock times and independent certainty on each Leg. The advanced
clock-time controls are collapsed by default and never infer a timezone.

The explicit Connect to next day control creates a single unknown draft Leg
between the last active Visit and the following day's first active Visit.
It never connects days on creation and rejects existing competing endpoints.

Explore supports date ranges (local calendar dates only), transport filters for
stored route geometries, independent location/route geometry confidence filters,
and route colors by Trip or transport. Selecting a map feature shows its persisted
metadata and can open the related Trip. Missing dates are excluded only when a
calendar filter is active; unknown paths are never drawn as direct lines.
