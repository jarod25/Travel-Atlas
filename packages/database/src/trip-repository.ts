import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { trips } from './schema.js';

export type TripUpdateResult =
  | { status: 'not_found' }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'updated'; trip: typeof trips.$inferSelect };

/** Preserve all history on archive; the row lock protects against lost edits. */
export async function updateTripWithRevision(
  db: PostgresJsDatabase,
  id: string,
  expectedRevision: number,
  changes: { title?: string; isArchived?: boolean; manualStartDate?: string | null; manualEndDate?: string | null },
): Promise<TripUpdateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(trips).where(eq(trips.id, id)).for('update');
    if (!current) return { status: 'not_found' };
    if (current.revision !== expectedRevision) {
      return { status: 'conflict', currentRevision: current.revision };
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
