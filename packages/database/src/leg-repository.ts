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
    | 'departureTimePrecision'
    | 'departureRangeEndLocalDate'
    | 'departureRangeEndLocalTime'
    | 'departureTimeZone'
    | 'departureTimeConfidence'
    | 'arrivalLocalDate'
    | 'arrivalLocalTime'
    | 'arrivalTimePrecision'
    | 'arrivalRangeEndLocalDate'
    | 'arrivalRangeEndLocalTime'
    | 'arrivalTimeZone'
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
    for (const kind of ['departure', 'arrival'] as const) {
      const precisionKey = kind === 'departure' ? 'departureTimePrecision' : 'arrivalTimePrecision';
      const dateKey = kind === 'departure' ? 'departureLocalDate' : 'arrivalLocalDate';
      const timeKey = kind === 'departure' ? 'departureLocalTime' : 'arrivalLocalTime';
      const endDateKey =
        kind === 'departure' ? 'departureRangeEndLocalDate' : 'arrivalRangeEndLocalDate';
      const endTimeKey =
        kind === 'departure' ? 'departureRangeEndLocalTime' : 'arrivalRangeEndLocalTime';
      const precision = changes[precisionKey] ?? current[precisionKey];
      const startDate = changes[dateKey] === undefined ? current[dateKey] : changes[dateKey];
      const startTime = changes[timeKey] === undefined ? current[timeKey] : changes[timeKey];
      const endDate = changes[endDateKey] === undefined ? current[endDateKey] : changes[endDateKey];
      const endTime = changes[endTimeKey] === undefined ? current[endTimeKey] : changes[endTimeKey];
      if (precision === 'range') {
        if (!startDate || !startTime || !endDate || !endTime) {
          return { status: 'invalid_times' };
        }
        if (`${endDate}T${endTime}` < `${startDate}T${startTime}`) {
          return { status: 'invalid_times' };
        }
      } else if (
        endDate != null ||
        endTime != null ||
        (precision !== 'unspecified' && (!startDate || !startTime))
      ) {
        return { status: 'invalid_times' };
      }
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
