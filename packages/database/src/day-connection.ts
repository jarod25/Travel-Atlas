import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, tripDays, visits } from './schema.js';

export type DayConnectionResult =
  | { status: 'not_found' }
  | { status: 'invalid'; reason: string }
  | { status: 'connected'; created: boolean; leg: typeof legs.$inferSelect };

/**
 * Explicitly connect the last active Visit of one day to the first Visit of
 * its immediately following day. No connection is ever inferred on creation.
 * Lock both days so appends/reorders/archives cannot race the decision.
 */
export async function connectAdjacentDays(
  db: PostgresJsDatabase,
  input: { tripId: string; fromDayId: string; toDayId: string },
): Promise<DayConnectionResult> {
  return db.transaction(async (tx) => {
    if (input.fromDayId === input.toDayId) {
      return { status: 'invalid', reason: 'Select two different days' };
    }
    const days = await tx
      .select()
      .from(tripDays)
      .where(
        and(
          eq(tripDays.tripId, input.tripId),
          eq(tripDays.isArchived, false),
          inArray(tripDays.id, [input.fromDayId, input.toDayId]),
        ),
      )
      .orderBy(asc(tripDays.position))
      .for('update');
    if (days.length !== 2) return { status: 'not_found' };
    const [fromDay, toDay] = days;
    if (
      fromDay.id !== input.fromDayId ||
      toDay.id !== input.toDayId ||
      toDay.position !== fromDay.position + 1
    ) {
      return { status: 'invalid', reason: 'Connect consecutive days in chronological order' };
    }
    const [from] = await tx
      .select()
      .from(visits)
      .where(and(eq(visits.tripDayId, fromDay.id), eq(visits.isArchived, false)))
      .orderBy(desc(visits.position))
      .limit(1);
    const [to] = await tx
      .select()
      .from(visits)
      .where(and(eq(visits.tripDayId, toDay.id), eq(visits.isArchived, false)))
      .orderBy(asc(visits.position))
      .limit(1);
    if (!from || !to) {
      return { status: 'invalid', reason: 'Both days need at least one active Visit' };
    }

    const existing = await tx
      .select()
      .from(legs)
      .where(and(eq(legs.tripId, input.tripId), eq(legs.isCurrent, true)));
    const identical = existing.find(
      (leg) => leg.fromVisitId === from.id && leg.toVisitId === to.id,
    );
    if (identical) return { status: 'connected', created: false, leg: identical };
    if (existing.some((leg) => leg.fromVisitId === from.id || leg.toVisitId === to.id)) {
      return { status: 'invalid', reason: 'An endpoint already has a current Leg' };
    }
    const [leg] = await tx
      .insert(legs)
      .values({
        tripId: input.tripId,
        fromVisitId: from.id,
        toVisitId: to.id,
      })
      .returning();
    return { status: 'connected', created: true, leg };
  });
}
