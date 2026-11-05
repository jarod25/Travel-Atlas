# Lot 3 — Explore and Trip Editor

The web app uses React + Vite and the local Fastify API. Start both with `pnpm dev`.
The Vite dev server proxies `/api` to the local API, which needs a PostgreSQL
database with applied migrations. No synthetic travel data is loaded by default.

- Explore renders recorded Point and saved LineString/MultiLineString geometries.
  Unknown geometry stays invisible, never fabricated as a straight segment.
- Trips creates a trip and opens the editor.
- Trip Editor creates days, searches existing Places, creates reusable Places,
  adds visits, reorders/archives visits transactionally and displays draft Legs.
- Desktop uses a horizontally resizable timeline (initially 32% width) on the left and a map on the right; mobile exposes Timeline and Map tabs without desktop resizing.
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
retiring the link. The original journey stays in history. On explicit
reconnection of the same directed Visit pair, an unambiguous historical
Leg is reactivated with its recorded transport, dates, confidence and
selected RouteVersion. If multiple historical Legs match, the API creates
an Unknown draft instead of guessing which journey was meant.

### Correcting an existing Visit's Place

Select a Visit, then use **Correct this visit's Place** in Details to search and select a reusable Place (or Unknown Place). Saving updates the existing Visit rather than archiving it and creating a replacement. The API requires the Visit's revision to avoid overwriting a concurrent correction. Editing a Visit in an archived day or trip is refused until restoration. Pending route proposals dependent on that Visit are invalidated, without deleting historical Legs or their evidence.

## Known limitations

The current interface still requires external network access for its MapLibre CDN module and map tiles. Synthetic API/Vite HTTP smoke tests and Playwright Chromium browser tests run in CI, but no physical Android acceptance result is recorded here. Places can be corrected without replacing Visits, but the app does not yet calculate new routes or automatically import real travel histories. A missing geometry remains Unknown.

## Lot 3 stabilization and manual acceptance

The CI checks formatting, linting, typechecking, unit and PostGIS integration
tests, builds, API/web smoke journeys and Chromium Playwright E2E. Green CI
validates synthetic scenarios only; it cannot inspect the user's local
`atlas_lot3_recette` PostgreSQL database on Windows.

Before declaring Lot 3 complete, check the following in that local database
**after taking a tested backup**:

1. Reorder two Visits away and back; the same directed Leg should recover its
   recorded transport, clock times, certainty and selected RouteVersion.
2. Archive and restore a Visit. Confirm its place and historical Legs return
   where the restored adjacency is unambiguous, with no duplicate current edges.
3. Archive a day; its editing controls must be disabled until restored, but
   consultation and Restore day remain available.
4. Connect two consecutive days, edit the cross-day Leg, disconnect and reconnect.
   Verify the same recorded Leg returns if it is the unique historical match;
   multiple matches must not be silently selected.
5. Create a Visit from an existing Place, from a new named Place and with an
   explicitly Unknown Place. No location or route is inferred.
6. Navigate Explore, Trips and a specific day in Trip Editor; reload with F5
   and use Back/Forward. Check saved URL filters and recently modified Trips.
7. Review maps with known and unknown coordinates. Fit to content should
   use stored coordinates only, and manual pan/zoom must remain usable.
8. Check layouts and controls on desktop, tablet, narrow mobile and around
   breakpoints, especially long Timelines and editing dialogs.
9. Restart the API, browser and computer and verify data persisted without
   silent loss. Re-run the critical cases against a separate backup/restored
   test database where possible.

## Stabilization — hierarchy, local time and cross-trip travel

Trips can contain descendant Trips to arbitrary depth. Trips may be reparented through a
revision-protected request; cycles are rejected and existing records retain their IDs.
The parent map and the combined-day timeline include non-archived descendants exactly once.
A parent editor navigates to each descendant's own editable Day instead of duplicating Visits.

Date bounds are derived from dated active Days; optional manual corrections are kept
separately and can be reset. Unknown dates remain unknown. A parent archive hides its
descendants from Explore and retires current Legs involving its subtree without erasing
historical evidence or route versions.

Cross-trip connections require explicit review of recorded last/first active Visits
within a common Trip family. The underlying Leg is owned by its departure Trip and
points to a destination Visit in another related Trip. It is never generated
automatically and begins with Unknown transport/geometry. The editor can disconnect and
reconnect historical directed pairs unambiguously. A family move that would orphan a
cross-trip link is refused.

Departure and arrival have independent IANA time zones, temporal precision and
source certainty. The timezone provider offers suggestions from already-stored
endpoint coordinates; it never silently accepts them. Manual overrides are supported.
Exact, approximate and range precisions are editable. Range endpoints are stored as
local datetimes without a fabricated UTC instant. A calculated duration is displayed
only when both local clocks and zones map uniquely to instants; DST gaps and overlaps
remain explicitly unresolved.

Validation includes migrations 0018–0020, unit/API/PostGIS integration tests and
Playwright responsive workflows, followed by the separate manual checklist in
[Lot 3 acceptance](LOT3_RECETTE.md).

Lot 4 routing proposals remain separate from evidence of journeys actually taken.
Do not declare the personal database accepted before completing that checklist.
