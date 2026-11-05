import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, routeProposals, tripDays, trips, visits } from './schema.js';

type Leg = typeof legs.$inferSelect;
export type CrossTripResult =
  | { status: 'not_found' }
  | { status: 'invalid'; reason: string }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'connected'; created: boolean; leg: Leg }
  | { status: 'disconnected'; leg: Leg };

export async function connectTrips(
  db: PostgresJsDatabase,
  input: { fromTripId: string; fromDayId: string; toTripId: string; toDayId: string },
): Promise<CrossTripResult> {
  if (input.fromTripId === input.toTripId) {
    return { status: 'invalid', reason: 'Use Connect Days within the same Trip' };
  }
  return db.transaction(async (tx) => {
    const parent = await tx.execute(sql`
      WITH RECURSIVE a AS (
        SELECT id, parent_trip_id, is_archived, id AS origin FROM trips
        WHERE id IN (${input.fromTripId}, ${input.toTripId})
        UNION ALL
        SELECT t.id, t.parent_trip_id, t.is_archived, a.origin
        FROM trips t JOIN a ON a.parent_trip_id = t.id
      )
      SELECT origin, id FROM a WHERE parent_trip_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM a b WHERE b.origin = a.origin AND b.is_archived = true)
    `);
    if (parent.length !== 2 || parent[0].id !== parent[1].id) {
      return { status: 'invalid', reason: 'Trips must belong to the same active trip family' };
    }
    const days = await tx
      .select()
      .from(tripDays)
      .where(
        and(inArray(tripDays.id, [input.fromDayId, input.toDayId]), eq(tripDays.isArchived, false)),
      )
      .orderBy(asc(tripDays.id))
      .for('update');
    const fromDay = days.find((d) => d.id === input.fromDayId && d.tripId === input.fromTripId);
    const toDay = days.find((d) => d.id === input.toDayId && d.tripId === input.toTripId);
    if (!fromDay || !toDay) return { status: 'not_found' };
    if (fromDay.localDate && toDay.localDate && toDay.localDate < fromDay.localDate) {
      return { status: 'invalid', reason: 'Arrival day cannot precede departure day' };
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
    if (!from || !to)
      return { status: 'invalid', reason: 'Both days must have recorded active Visits' };
    const [incoming] = await tx
      .select({ id: legs.id })
      .from(legs)
      .where(and(eq(legs.toVisitId, to.id), eq(legs.isCurrent, true)));
    const [outgoing] = await tx
      .select({ id: legs.id })
      .from(legs)
      .where(and(eq(legs.fromVisitId, from.id), eq(legs.isCurrent, true)));
    if (incoming || outgoing) {
      if (incoming?.id && incoming.id === outgoing?.id) {
        const [current] = await tx.select().from(legs).where(eq(legs.id, incoming.id));
        return { status: 'connected', created: false, leg: current };
      }
      return { status: 'invalid', reason: 'One endpoint already has a current Leg' };
    }
    const previous = await tx
      .select()
      .from(legs)
      .where(
        and(eq(legs.fromVisitId, from.id), eq(legs.toVisitId, to.id), eq(legs.isCurrent, false)),
      )
      .for('update');
    if (previous.length === 1) {
      const [restored] = await tx
        .update(legs)
        .set({ isCurrent: true, revision: previous[0].revision + 1 })
        .where(eq(legs.id, previous[0].id))
        .returning();
      return { status: 'connected', created: false, leg: restored };
    }
    const [created] = await tx
      .insert(legs)
      .values({
        tripId: from.tripId,
        fromVisitId: from.id,
        toVisitId: to.id,
      })
      .returning();
    return { status: 'connected', created: true, leg: created };
  });
}

export async function disconnectTrips(
  db: PostgresJsDatabase,
  legId: string,
  revision: number,
): Promise<CrossTripResult> {
  return db.transaction(async (tx) => {
    const [leg] = await tx.select().from(legs).where(eq(legs.id, legId)).for('update');
    if (!leg || !leg.isCurrent) return { status: 'not_found' };
    if (leg.revision !== revision) return { status: 'conflict', currentRevision: leg.revision };
    const [to] = await tx
      .select({ tripId: visits.tripId })
      .from(visits)
      .where(eq(visits.id, leg.toVisitId));
    if (!to || to.tripId === leg.tripId)
      return { status: 'invalid', reason: 'Not a cross-trip Leg' };
    const [retired] = await tx
      .update(legs)
      .set({ isCurrent: false, revision: leg.revision + 1 })
      .where(eq(legs.id, leg.id))
      .returning();
    await tx
      .update(routeProposals)
      .set({ status: 'invalidated', reviewedAt: new Date() })
      .where(and(eq(routeProposals.legId, retired.id), eq(routeProposals.status, 'pending')));
    return { status: 'disconnected', leg: retired };
  });
}
