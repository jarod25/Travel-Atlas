import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, routeProposals, trips } from './schema.js';

export type LegChanges = Partial<
  Pick<
    typeof legs.$inferInsert,
    | 'transportMode'
    | 'movementConfidence'
    | 'transportConfidence'
    | 'departureLocalDate'
    | 'departureLocalTime'
    | 'departureTimeZone'
    | 'departureTimePrecision'
    | 'departureRangeStart'
    | 'departureRangeEnd'
    | 'departureTimeConfidence'
    | 'arrivalLocalDate'
    | 'arrivalLocalTime'
    | 'arrivalTimeZone'
    | 'arrivalTimePrecision'
    | 'arrivalRangeStart'
    | 'arrivalRangeEnd'
    | 'arrivalTimeConfidence'
  >
>;

export type LegUpdateResult =
  | { status: 'not_found' }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'invalid_times' }
  | { status: 'updated'; leg: typeof legs.$inferSelect };

/** Optimistic revisions protect a user from overwriting another edit. */
export async function updateLegWithRevision(
  db: PostgresJsDatabase,
  id: string,
  expectedRevision: number,
  changes: LegChanges,
): Promise<LegUpdateResult> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ tripId: legs.tripId }).from(legs).where(eq(legs.id, id));
    if (!target) return { status: 'not_found' };
    const [trip] = await tx
      .select({ isArchived: trips.isArchived })
      .from(trips)
      .where(eq(trips.id, target.tripId))
      .for('share');
    if (!trip || trip.isArchived) return { status: 'not_found' };

    const [current] = await tx.select().from(legs).where(eq(legs.id, id)).for('update');
    if (!current || !current.isCurrent) return { status: 'not_found' };
    if (current.revision !== expectedRevision) {
      return { status: 'conflict', currentRevision: current.revision };
    }
    const schedule = [
      {
        precision: changes.departureTimePrecision ?? current.departureTimePrecision,
        date: changes.departureLocalDate === undefined ? current.departureLocalDate : changes.departureLocalDate,
        time: changes.departureLocalTime === undefined ? current.departureLocalTime : changes.departureLocalTime,
        rangeStart: changes.departureRangeStart === undefined ? current.departureRangeStart : changes.departureRangeStart,
        rangeEnd: changes.departureRangeEnd === undefined ? current.departureRangeEnd : changes.departureRangeEnd,
      },
      {
        precision: changes.arrivalTimePrecision ?? current.arrivalTimePrecision,
        date: changes.arrivalLocalDate === undefined ? current.arrivalLocalDate : changes.arrivalLocalDate,
        time: changes.arrivalLocalTime === undefined ? current.arrivalLocalTime : changes.arrivalLocalTime,
        rangeStart: changes.arrivalRangeStart === undefined ? current.arrivalRangeStart : changes.arrivalRangeStart,
        rangeEnd: changes.arrivalRangeEnd === undefined ? current.arrivalRangeEnd : changes.arrivalRangeEnd,
      },
    ];
    for (const clock of schedule) {
      if (clock.precision === 'range') {
        if (!clock.rangeStart || !clock.rangeEnd || clock.rangeStart > clock.rangeEnd) {
          return { status: 'invalid_times' };
        }
      } else if (clock.rangeStart != null || clock.rangeEnd != null) {
        return { status: 'invalid_times' };
      }
      if ((clock.precision === 'exact' || clock.precision === 'approximate') && (!clock.date || !clock.time)) {
        return { status: 'invalid_times' };
      }
      if (clock.time && !clock.date) return { status: 'invalid_times' };
    }
    const modeChanged =
      changes.transportMode !== undefined && changes.transportMode !== current.transportMode;
    const [updated] = await tx
      .update(legs)
      .set({
        ...changes,
        revision: current.revision + 1,
        ...(modeChanged
          ? {
              selectedRouteVersionId: null,
              geometryConfidence: 'unknown' as const,
            }
          : {}),
      })
      .where(eq(legs.id, id))
      .returning();

    if (modeChanged) {
      await tx
        .update(routeProposals)
        .set({
          status: 'invalidated',
          reviewedAt: new Date(),
        })
        .where(
          // Database SQL checks pending; update only pending candidates.
          // Accepted routes remain in history, but selection is cleared.
          and(eq(routeProposals.legId, id), eq(routeProposals.status, 'pending')),
        );
    }
    return { status: 'updated', leg: updated };
  });
}
