# Lot 3 — manual acceptance and safe migration (November 2026)

This is the **human acceptance checklist**, not a replacement for CI.
Do not use the personal Travel Atlas database for synthetic tests or smoke fixtures.

## Before opening the editor

1. Check the target branch/PR and its full CI status. Do not treat green CI as proof that the personal database is safe.
2. Confirm the active database name and connection string in `apps/api/.env`. Never commit that file.
3. **Stop the API**, then make a PostgreSQL custom-format backup of the existing database **and verify that the file exists and has nonzero size**. If the database is inside the Compose `postgis` service, a representative PowerShell workflow is:

   ```powershell
   New-Item -ItemType Directory -Force .\backups | Out-Null
   docker compose -f infrastructure/docker/compose.yml exec -T postgis pg_dump -U atlas_local -Fc -f /tmp/travel-atlas-before-lot3.backup atlas_local
   docker compose -f infrastructure/docker/compose.yml cp postgis:/tmp/travel-atlas-before-lot3.backup .\backups\travel-atlas-before-lot3.backup
   Get-Item .\backups\travel-atlas-before-lot3.backup | Select-Object FullName,Length
   ```

   **Replace `atlas_local` by the database and user actually configured locally if different.** This example assumes the Compose `postgis` service holds the database. Do not redirect a binary `pg_dump -Fc` stream through legacy PowerShell text redirection.

4. Restore the backup into a **different, isolated test database** and verify that Trips, Days, Visits, Legs, RouteVersions, and Evidence are intact before applying any new migration to the original. Do not overwrite the original during a restore test. See PostgreSQL's `pg_restore` documentation.
5. On the copy, run `pnpm install --frozen-lockfile`, then `pnpm db:migrate`. Repeat the read/write and restore checks. Only then migrate the original after separately ensuring the copy's results are correct.

## Functional acceptance: synthetic data in the private manual-test environment

Use test data clearly labeled _Synthetic_ and keep it separate from real travel history.

- [ ] Create a parent Trip and two nested subtrips (include at least three hierarchy levels). A selected parent shows all recorded descendant Points and RouteVersions exactly once.
- [ ] Create a dated Day in the parent and dated Days in the descendants. Check computed min/max local dates. Archive/restore a Day and verify recalculation; manually override one date, then clear override and see computed dates again.
- [ ] Move an existing subtrip to a different parent. Original Days/Visits/Legs and IDs remain. Attempt to parent a Trip to itself or to its descendant; these must be rejected.
- [ ] Open a parent Trip's combined-day list. Dates are ordered without inventing dates for undated Days; opening a subtrip's Day navigates to its owning editor.
- [ ] Add two adjacent Days with recorded Visits. Verify the suggested connection displays candidate endpoints but creates no current Leg until _Connect_ is confirmed. Empty days must not produce a suggestion.
- [ ] Connect parent-day → subtrip-day and subtrip-day → parent-day, each with real recorded boundary Visits and explicit confirmation; inspect both timelines. Never generate an automatically routed geometry. Disconnect and reconnect; when a historical directed pair is unambiguous, its Leg ID and facts are recovered.
- [ ] Try to connect unrelated Trips or an already occupied Visit endpoint. Expect an explicit rejection, not duplicate current Legs.
- [ ] Archive a subtrip or Day involved in a current cross-trip connection. The current link is retired while historical facts remain. Restore without silently reconnecting.
- [ ] Edit departure/arrival clock dates/times with separate certainty and precision; use _Approximate_, _Exact_, _Unknown_, and an explicit _Range_ with earliest/latest local datetimes. Reload the editor; values and revisions must persist.
- [ ] Use a Paris-origin and Tokyo-destination Leg with known Place coordinates. Check separately suggested IANA zones. A proposal never changes the saved timezone until clicked and saved.
- [ ] For a **synthetic example only**, Paris 2026-09-12 20:00 and Tokyo 2026-09-13 16:00 should produce a timezone-aware 13-hour duration. Test an ambiguous autumn DST clock and a nonexistent spring clock: no unique duration should be displayed.
- [ ] Change a Place's coordinates after obtaining a timezone suggestion. Reopen the Leg; suggestions must reflect the stored current coordinates. No GPS coordinates or transport evidence are invented.
- [ ] Verify old Trip/Visit/Leg reorder, archive/restore, and route-history workflows still function after migrations.

## Browser, responsive and persistence acceptance

- [ ] Desktop narrow and wide; tablet landscape/portrait; Android portrait/landscape. Check 320, 390, 768, 899/901 breakpoint and typical laptop widths, **not just a fixed 1700 × 900 screenshot**. Test real device interaction and long titles/lists.
- [ ] Keyboard navigation and touch-friendly controls; no clipped dialogs, accidental horizontal scrolling or inaccessible Save/Cancel.
- [ ] Explore filters remain in the URL when reloading; F5 and Back/Forward preserve navigation as expected.
- [ ] Restart both web/API services and PostgreSQL; confirm no silent changes to facts, statuses, certainty or links.
- [ ] Verify incoming and outgoing links from each relevant Trip, and verify no historical route or evidence was lost during migrations.

## Do not treat these as part of Lot 3 acceptance

Lot 4 provider-driven routing, Lot 5 import/export and portable backups, future Android GPS tracking, photo import, public deployment and sharing are separate milestones. Geographic time-zone proposals use recorded Place coordinates only; missing coordinates produce no suggestion. For ambiguous timezone borders there may be multiple candidate zones; the user must choose.

Do not merge to `main`, run destructive `docker compose down -v`, or publish a real personal database/backup to GitHub.
