import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, tripDays, visits } from './schema.js';

export type DayArchiveResult =
  | { status: 'not_found' }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'updated'; day: typeof tripDays.$inferSelect };

/**
 * Archive: hide the day and archive any current Leg touching its active visits.
 * Restore: rebuild only intra-day UNKNOWN draft legs, never cross-day travel.
 */
export async function setDayArchivedWithRevision(
  db: PostgresJsDatabase,
  input: { tripId: string; dayId: string; revision: number; isArchived: boolean },
): Promise<DayArchiveResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(tripDays)
      .where(and(eq(tripDays.id, input.dayId), eq(tripDays.tripId, input.tripId)))
      .for('update');
    if (!current) return { status: 'not_found' };
    if (current.revision !== input.revision) {
      return { status: 'conflict', currentRevision: current.revision };
    }

    if (current.isArchived === input.isArchived) {
      return { status: 'updated', day: current };
    }

    const active = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.tripDayId, input.dayId), eq(visits.isArchived, false)))
      .orderBy(asc(visits.position));
    const ids = active.map((visit) => visit.id);

    if (current.isArchived !== input.isArchived) {
      if (input.isArchived && ids.length > 0) {
        await tx
          .update(legs)
          .set({ isCurrent: false })
          .where(
            and(
              eq(legs.tripId, input.tripId),
              eq(legs.isCurrent, true),
              or(inArray(legs.fromVisitId, ids), inArray(legs.toVisitId, ids)),
            ),
          );
      }
      if (!input.isArchived) {
        for (let index = 1; index < ids.length; index += 1) {
          await tx.insert(legs).values({
            tripId: input.tripId,
            fromVisitId: ids[index - 1],
            toVisitId: ids[index],
          });
        }
      }
    }

    const [day] = await tx
      .update(tripDays)
      .set({
        isArchived: input.isArchived,
        revision: current.revision + 1,
      })
      .where(eq(tripDays.id, input.dayId))
      .returning();
    return { status: 'updated', day };
  });
}
