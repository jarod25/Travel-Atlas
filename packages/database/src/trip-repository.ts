import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { tripDays, trips } from './schema.js';

export type TripUpdateResult =
  | { status: 'not_found' }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'invalid_dates' }
  | { status: 'updated'; trip: typeof trips.$inferSelect };

/** Preserve all history on archive; the row lock protects against lost edits. */
export async function updateTripWithRevision(
  db: PostgresJsDatabase,
  id: string,
  expectedRevision: number,
  changes: {
    title?: string;
    isArchived?: boolean;
    startDateOverride?: string | null;
    endDateOverride?: string | null;
  },
): Promise<TripUpdateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(trips).where(eq(trips.id, id)).for('update');
    if (!current) return { status: 'not_found' };
    if (current.revision !== expectedRevision) {
      return { status: 'conflict', currentRevision: current.revision };
    }
    if (
      changes.startDateOverride !== undefined ||
      changes.endDateOverride !== undefined
    ) {
      const [bounds] = await tx
        .select({
          start: sql<string | null>`min(${tripDays.localDate})::text`,
          end: sql<string | null>`max(${tripDays.localDate})::text`,
        })
        .from(tripDays)
        .where(and(eq(tripDays.tripId, id), eq(tripDays.isArchived, false)));
      const start = (changes.startDateOverride === undefined
        ? current.startDateOverride
        : changes.startDateOverride) ?? bounds.start;
      const end = (changes.endDateOverride === undefined
        ? current.endDateOverride
        : changes.endDateOverride) ?? bounds.end;
      if (start && end && start > end) return { status: 'invalid_dates' };
    }
    const [trip] = await tx
      .update(trips)
      .set({
        ...changes,
        revision: current.revision + 1,
      })
      .where(eq(trips.id, id))
      .returning();
    return { status: 'updated', trip };
  });
}
