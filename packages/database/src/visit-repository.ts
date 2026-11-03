import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, tripDays, visits } from './schema';

/**
 * Append a Visit and its optional draft Leg in one transaction.
 * Lock the parent day to serialize competing appends to that day's timeline.
 * Never infer a connection to a Visit on another day.
 */
export async function appendVisitToDay(
  db: PostgresJsDatabase,
  input: { tripId: string; tripDayId: string; placeId?: string | null },
) {
  return db.transaction(async (tx) => {
    const [day] = await tx
      .select({ id: tripDays.id, tripId: tripDays.tripId })
      .from(tripDays)
      .where(and(eq(tripDays.id, input.tripDayId), eq(tripDays.tripId, input.tripId)))
      .for('update');

    if (!day) {
      throw new Error('Trip day not found in the specified trip');
    }

    const [previous] = await tx
      .select({ id: visits.id, position: visits.position })
      .from(visits)
      .where(and(eq(visits.tripId, input.tripId), eq(visits.tripDayId, day.id)))
      .orderBy(desc(visits.position))
      .limit(1);

    const [visit] = await tx
      .insert(visits)
      .values({
        tripId: day.tripId,
        tripDayId: day.id,
        placeId: input.placeId ?? null,
        position: previous ? previous.position + 1 : 0,
      })
      .returning();

    let draftLeg: typeof legs.$inferSelect | null = null;
    if (previous) {
      [draftLeg] = await tx
        .insert(legs)
        .values({
          tripId: day.tripId,
          fromVisitId: previous.id,
          toVisitId: visit.id,
        })
        .returning();
    }

    return { visit, draftLeg };
  });
}
