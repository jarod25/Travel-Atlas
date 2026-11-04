import { and, asc, eq, inArray, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { dayRestoreLegs, legs, routeProposals, tripDays, visits } from './schema.js';

export type DayArchiveResult =
  | { status: 'not_found' }
  | { status: 'conflict'; currentRevision: number }
  | { status: 'updated'; day: typeof tripDays.$inferSelect };

function pairKey(fromId: string, toId: string): string {
  return fromId + ':' + toId;
}

/**
 * Archive: snapshot existing intra-day Legs, then retire all current Legs
 * touching the day (including explicit inter-day connections).
 * Restore: reactivate exactly those recorded intra-day Legs if their endpoints
 * are still adjacent. Legacy days without a snapshot get Unknown drafts.
 * Inter-day connections are NEVER restored without an explicit Connect Days.
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

    if (input.isArchived) {
      if (ids.length > 0) {
        const touching = await tx
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
        const intraDay = touching.filter(
          (leg) => owned.has(leg.fromVisitId) && owned.has(leg.toVisitId),
        );
        if (intraDay.length > 0) {
          await tx.insert(dayRestoreLegs).values(
            intraDay.map((leg) => ({ dayId: input.dayId, legId: leg.id })),
          );
        }
        const retiredIds = touching.map((leg) => leg.id);
        if (retiredIds.length > 0) {
          await tx
            .update(legs)
            .set({ isCurrent: false })
            .where(inArray(legs.id, retiredIds));
          await tx
            .update(routeProposals)
            .set({ status: 'invalidated', reviewedAt: new Date() })
            .where(
              and(
                inArray(routeProposals.legId, retiredIds),
                eq(routeProposals.status, 'pending'),
              ),
            );
        }
      }
    } else {
      const saved = await tx
        .select({
          legId: dayRestoreLegs.legId,
          fromVisitId: legs.fromVisitId,
          toVisitId: legs.toVisitId,
        })
        .from(dayRestoreLegs)
        .innerJoin(legs, eq(dayRestoreLegs.legId, legs.id))
        .where(eq(dayRestoreLegs.dayId, input.dayId));
      const previous = new Map(
        saved.map((leg) => [pairKey(leg.fromVisitId, leg.toVisitId), leg.legId]),
      );
      for (let index = 1; index < ids.length; index += 1) {
        const savedLegId = previous.get(pairKey(ids[index - 1], ids[index]));
        if (savedLegId) {
          await tx.update(legs).set({ isCurrent: true }).where(eq(legs.id, savedLegId));
        } else {
          await tx.insert(legs).values({
            tripId: input.tripId,
            fromVisitId: ids[index - 1],
            toVisitId: ids[index],
          });
        }
      }
      await tx.delete(dayRestoreLegs).where(eq(dayRestoreLegs.dayId, input.dayId));
    }

    const [day] = await tx
      .update(tripDays)
      .set({ isArchived: input.isArchived, revision: current.revision + 1 })
      .where(eq(tripDays.id, input.dayId))
      .returning();
    return { status: 'updated', day };
  });
}
