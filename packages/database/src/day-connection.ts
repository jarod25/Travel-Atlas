import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, routeProposals, tripDays, trips, visits } from './schema.js';

export type DayDisconnectionResult =
  | { status: 'not_found' }
  | { status: 'invalid'; reason: string }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'disconnected'; leg: typeof legs.$inferSelect };

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
    const [trip] = await tx
      .select({ isArchived: trips.isArchived })
      .from(trips)
      .where(eq(trips.id, input.tripId))
      .for('share');
    if (!trip) return { status: 'not_found' };
    if (trip.isArchived) {
      return { status: 'invalid', reason: 'Restore the Trip before connecting days' };
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

/**
 * Explicitly detach the exact current connection between consecutive days.
 * The Leg and all its historic evidence/RouteVersions remain in the database.
 * A newly connected Leg starts Unknown, never inherits a previously known path.
 */
export async function disconnectAdjacentDays(
  db: PostgresJsDatabase,
  input: {
    tripId: string;
    fromDayId: string;
    toDayId: string;
    legId: string;
    revision: number;
  },
): Promise<DayDisconnectionResult> {
  return db.transaction(async (tx) => {
    if (input.fromDayId === input.toDayId) {
      return { status: 'invalid', reason: 'Select two different days' };
    }
    const [trip] = await tx
      .select({ isArchived: trips.isArchived })
      .from(trips)
      .where(eq(trips.id, input.tripId))
      .for('share');
    if (!trip) return { status: 'not_found' };
    if (trip.isArchived) {
      return { status: 'invalid', reason: 'Restore the Trip before disconnecting days' };
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
      return { status: 'invalid', reason: 'Disconnect consecutive days in chronological order' };
    }
    const [from] = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.tripDayId, fromDay.id), eq(visits.isArchived, false)))
      .orderBy(desc(visits.position))
      .limit(1);
    const [to] = await tx
      .select({ id: visits.id })
      .from(visits)
      .where(and(eq(visits.tripDayId, toDay.id), eq(visits.isArchived, false)))
      .orderBy(asc(visits.position))
      .limit(1);
    if (!from || !to) {
      return { status: 'invalid', reason: 'Both days need an active Visit' };
    }
    const [current] = await tx
      .select()
      .from(legs)
      .where(and(eq(legs.id, input.legId), eq(legs.tripId, input.tripId)))
      .for('update');
    if (!current || !current.isCurrent) {
      return { status: 'invalid', reason: 'The specified current connection no longer exists' };
    }
    if (current.revision !== input.revision) {
      return { status: 'conflict', currentRevision: current.revision };
    }
    if (current.fromVisitId !== from.id || current.toVisitId !== to.id) {
      return { status: 'invalid', reason: 'Leg does not match the selected day boundary' };
    }
    const [retired] = await tx
      .update(legs)
      .set({ isCurrent: false, revision: current.revision + 1 })
      .where(eq(legs.id, current.id))
      .returning();
    await tx
      .update(routeProposals)
      .set({ status: 'invalidated', reviewedAt: new Date() })
      .where(
        and(eq(routeProposals.legId, retired.id), eq(routeProposals.status, 'pending')),
      );
    return { status: 'disconnected', leg: retired };
  });
}
