import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
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

/**
 * Reorder exactly the existing Visits of one day.
 * Historical Legs are retained (isCurrent=false); new adjacency is unknown.
 * Current cross-day connections are protected rather than silently rewritten.
 */
export async function reorderVisitsInDay(
  db: PostgresJsDatabase,
  input: { tripId: string; tripDayId: string; orderedVisitIds: readonly string[] },
) {
  return db.transaction(async (tx) => {
    const [day] = await tx
      .select({ id: tripDays.id })
      .from(tripDays)
      .where(and(eq(tripDays.id, input.tripDayId), eq(tripDays.tripId, input.tripId)))
      .for('update');
    if (!day) {
      throw new Error('Trip day not found in the specified trip');
    }

    const existing = await tx
      .select({ id: visits.id, position: visits.position })
      .from(visits)
      .where(and(eq(visits.tripId, input.tripId), eq(visits.tripDayId, day.id)))
      .orderBy(asc(visits.position));
    const ids = existing.map((visit) => visit.id);
    const requested = input.orderedVisitIds;
    if (
      requested.length !== ids.length ||
      new Set(requested).size !== ids.length ||
      requested.some((id) => !ids.includes(id))
    ) {
      throw new Error('Visit order must be an exact permutation of this day');
    }

    if (ids.every((id, index) => id === requested[index])) {
      return { changed: false, archivedLegCount: 0, newLegCount: 0 };
    }

    const current = await tx
      .select({
        id: legs.id,
        fromVisitId: legs.fromVisitId,
        toVisitId: legs.toVisitId,
      })
      .from(legs)
      .where(
        and(
          eq(legs.tripId, input.tripId),
          eq(legs.isCurrent, true),
          or(inArray(legs.fromVisitId, ids), inArray(legs.toVisitId, ids)),
        ),
      );

    const owned = new Set(ids);
    if (
      current.some(
        (leg) => !owned.has(leg.fromVisitId) || !owned.has(leg.toVisitId),
      )
    ) {
      throw new Error('Cannot reorder a day with a current cross-day connection');
    }

    // Retain previously known journey facts in historical records.
    for (const leg of current) {
      await tx.update(legs).set({ isCurrent: false }).where(eq(legs.id, leg.id));
    }

    // Avoid transient unique-position conflicts while applying a permutation.
    const temporaryBase = Math.max(...existing.map((visit) => visit.position)) + 1;
    if (temporaryBase + ids.length > 2147483647) {
      throw new Error('Visit positions exceed the database integer range');
    }
    for (let index = 0; index < requested.length; index += 1) {
      await tx
        .update(visits)
        .set({ position: temporaryBase + index })
        .where(eq(visits.id, requested[index]));
    }
    for (let index = 0; index < requested.length; index += 1) {
      await tx.update(visits).set({ position: index }).where(eq(visits.id, requested[index]));
    }

    for (let index = 1; index < requested.length; index += 1) {
      await tx.insert(legs).values({
        tripId: input.tripId,
        fromVisitId: requested[index - 1],
        toVisitId: requested[index],
      });
    }

    return {
      changed: true,
      archivedLegCount: current.length,
      newLegCount: requested.length - 1,
    };
  });
}
