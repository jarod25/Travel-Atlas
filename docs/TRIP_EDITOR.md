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

Days can now be archived or restored with a revision-checked action. Archive
preserves all Visits, evidence and historical Legs, but hides the day from Explore
and closes its current intra-day and cross-day links. Restoring a day reactivates its original snapshotted intra-day Legs when adjacency is unchanged (migration 0013), falling back to Unknown drafts only where no saved matching Leg exists. Cross-day travel is never reconnected automatically. Archived days remain visible in the editor for restoration.

## Archiving and restoring days

Archiving a day retains its original intra-day Legs and their factual records
for restoration. Restoring the day reactivates those Legs when the original
Visit adjacency still exists. Cross-day connections are **not** restored
automatically: the user must reconnect adjacent days explicitly. Pending
route proposals on archived Legs are invalidated; historical route versions
and evidence remain saved. A day archived before migration 0013 does not have
an intra-day snapshot and restores with Unknown draft Legs instead.

## Explicit day connections

The editor offers **Connect to next day** only when no outgoing cross-day Leg
exists. Once connected, it offers **Disconnect from next day**, with an explicit
confirmation. The API validates the day boundary and Leg revision before
retiring the link. The original journey stays in history; reconnecting
creates a fresh Unknown draft rather than pretending it is the old journey.

### Correcting an existing Visit's Place

Select a Visit, then use **Correct this visit's Place** in Details to search and select a reusable Place (or Unknown Place). Saving updates the existing Visit rather than archiving it and creating a replacement. The API requires the Visit's revision to avoid overwriting a concurrent correction. Editing a Visit in an archived day or trip is refused until restoration. Pending route proposals dependent on that Visit are invalidated, without deleting historical Legs or their evidence.

## Known limitations

The current interface still requires external network access for its MapLibre CDN module and map tiles. A synthetic API/Vite HTTP journey smoke test runs in CI, but a Playwright Chromium synthetic browser flow runs in CI, but no physical Android responsive acceptance result is recorded here. Places can be corrected without replacing Visits, but the app does not yet calculate new routes or automatically import real travel histories. A missing geometry remains Unknown.
