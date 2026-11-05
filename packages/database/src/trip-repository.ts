import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { trips } from './schema.js';

export type TripChanges = {
  title?: string;
  isArchived?: boolean;
  parentTripId?: string | null;
  manualStartDate?: string | null;
  manualEndDate?: string | null;
};
export type TripUpdateResult =
  | { status: 'not_found' }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'invalid'; reason: string }
  | { status: 'updated'; trip: typeof trips.$inferSelect };

/** Lock and serialize hierarchy mutations, including a concurrent inverse move. */
export async function updateTripWithRevision(
  db: PostgresJsDatabase,
  id: string,
  expectedRevision: number,
  changes: TripChanges,
): Promise<TripUpdateResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(20261105)`);
    const [current] = await tx.select().from(trips).where(eq(trips.id, id)).for('update');
    if (!current) return { status: 'not_found' };
    if (current.revision !== expectedRevision) {
      return { status: 'conflict', currentRevision: current.revision };
    }
    if (changes.parentTripId !== undefined && changes.parentTripId !== null) {
      const parentId = changes.parentTripId;
      if (parentId === id) return { status: 'invalid', reason: 'A trip cannot parent itself' };
      const [parent] = await tx.select().from(trips).where(eq(trips.id, parentId));
      if (!parent || parent.isArchived) {
        return { status: 'invalid', reason: 'Select an existing active parent trip' };
      }
      const lineage = await tx.execute(sql`
        WITH RECURSIVE ancestors AS (
          SELECT id, parent_trip_id, is_archived FROM trips WHERE id = ${parentId}
          UNION ALL
          SELECT t.id, t.parent_trip_id, t.is_archived FROM trips t
          JOIN ancestors a ON a.parent_trip_id = t.id
        )
        SELECT id, is_archived FROM ancestors
      `);
      if (lineage.some((row) => row.id === id)) {
        return { status: 'invalid', reason: 'A trip cannot be moved inside its descendant' };
      }
      if (lineage.some((row) => row.is_archived)) {
        return { status: 'invalid', reason: 'Restore parent ancestors before moving a trip' };
      }
    }
    if (changes.parentTripId !== undefined && changes.parentTripId !== current.parentTripId) {
      const [previousRoot] = await tx.execute(sql`
        WITH RECURSIVE a AS (
          SELECT id, parent_trip_id FROM trips WHERE id = ${id}
          UNION ALL SELECT p.id, p.parent_trip_id FROM trips p JOIN a ON a.parent_trip_id = p.id
        ) SELECT id FROM a WHERE parent_trip_id IS NULL
      `);
      const [nextRoot] =
        changes.parentTripId === null
          ? [{ id }]
          : await tx.execute(sql`
          WITH RECURSIVE a AS (
            SELECT id, parent_trip_id FROM trips WHERE id = ${changes.parentTripId}
            UNION ALL SELECT p.id, p.parent_trip_id FROM trips p JOIN a ON a.parent_trip_id = p.id
          ) SELECT id FROM a WHERE parent_trip_id IS NULL
        `);
      if (previousRoot?.id !== nextRoot?.id) {
        const crossing = await tx.execute(sql`
          WITH RECURSIVE subtree AS (
            SELECT id FROM trips WHERE id = ${id}
            UNION ALL SELECT t.id FROM trips t JOIN subtree s ON t.parent_trip_id = s.id
          )
          SELECT 1 FROM legs l
          JOIN visits v1 ON v1.id = l.from_visit_id
          JOIN visits v2 ON v2.id = l.to_visit_id
          WHERE (v1.trip_id IN (SELECT id FROM subtree)) <>
                (v2.trip_id IN (SELECT id FROM subtree))
          LIMIT 1
        `);
        if (crossing.length) {
          return {
            status: 'invalid',
            reason: 'Disconnect or reorganize cross-trip Legs before moving to another trip family',
          };
        }
      }
    }
    if (
      changes.isArchived === false &&
      current.parentTripId &&
      changes.parentTripId === undefined
    ) {
      const archivedAncestors = await tx.execute(sql`
        WITH RECURSIVE a AS (
          SELECT id, parent_trip_id, is_archived FROM trips WHERE id = ${current.parentTripId}
          UNION ALL SELECT p.id, p.parent_trip_id, p.is_archived FROM trips p JOIN a ON a.parent_trip_id = p.id
        ) SELECT 1 FROM a WHERE is_archived LIMIT 1
      `);
      if (archivedAncestors.length)
        return { status: 'invalid', reason: 'Restore parent trips first' };
    }
    const start =
      changes.manualStartDate === undefined ? current.manualStartDate : changes.manualStartDate;
    const end = changes.manualEndDate === undefined ? current.manualEndDate : changes.manualEndDate;
    if (start && end && start > end) {
      return { status: 'invalid', reason: 'Start date must not be after end date' };
    }
    const [updated] = await tx
      .update(trips)
      .set({
        ...changes,
        revision: current.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(trips.id, id))
      .returning();
    // Retire cross-trip edges touching the archived subtree, but retain
    // intra-trip current Legs so restoring the Trip preserves its timeline.
    if (changes.isArchived === true && !current.isArchived) {
      await tx.execute(sql`
        WITH RECURSIVE descendants AS (
          SELECT id FROM trips WHERE id = ${id}
          UNION ALL SELECT t.id FROM trips t JOIN descendants d ON t.parent_trip_id = d.id
        ), retired AS (
          UPDATE legs l SET is_current = false, revision = revision + 1
          WHERE l.is_current = true AND EXISTS (
            SELECT 1 FROM visits v1 JOIN visits v2 ON v2.id = l.to_visit_id
            WHERE v1.id = l.from_visit_id AND v1.trip_id <> v2.trip_id
              AND (v1.trip_id IN (SELECT id FROM descendants)
                OR v2.trip_id IN (SELECT id FROM descendants))
          )
          RETURNING l.id
        )
        UPDATE route_proposals p SET status = 'invalidated', reviewed_at = NOW()
        WHERE p.status = 'pending' AND p.leg_id IN (SELECT id FROM retired)
      `);
    }
    return { status: 'updated', trip: updated };
  });
}
