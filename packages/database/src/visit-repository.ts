import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { legs, routeProposals, tripDays, visits } from './schema.js';

function pairKey(fromId: string, toId: string): string {
  return fromId + ':' + toId;
}

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
      .select({ id: tripDays.id, tripId: tripDays.tripId, isArchived: tripDays.isArchived })
      .from(tripDays)
      .where(and(eq(tripDays.id, input.tripDayId), eq(tripDays.tripId, input.tripId)))
      .for('update');

    if (!day) {
      throw new Error('Trip day not found in the specified trip');
    }
    if (day.isArchived) throw new Error('Trip day is archived');

    const [previous] = await tx
      .select({ id: visits.id, position: visits.position })
      .from(visits)
      .where(
        and(
          eq(visits.tripId, input.tripId),
          eq(visits.tripDayId, day.id),
          eq(visits.isArchived, false),
        ),
      )
      .orderBy(desc(visits.position))
      .limit(1);

    if (previous) {
      const [outgoing] = await tx
        .select({ id: legs.id })
        .from(legs)
        .where(and(eq(legs.fromVisitId, previous.id), eq(legs.isCurrent, true)))
        .limit(1);
      if (outgoing) {
        throw new Error('Disconnect the current cross-day Leg before appending to this day');
      }
    }

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
      .select({ id: tripDays.id, isArchived: tripDays.isArchived })
      .from(tripDays)
      .where(and(eq(tripDays.id, input.tripDayId), eq(tripDays.tripId, input.tripId)))
      .for('update');
    if (!day) {
      throw new Error('Trip day not found in the specified trip');
    }
    if (day.isArchived) throw new Error('Trip day is archived');

    const existing = await tx
      .select({ id: visits.id, position: visits.position })
      .from(visits)
      .where(
        and(
          eq(visits.tripId, input.tripId),
          eq(visits.tripDayId, day.id),
          eq(visits.isArchived, false),
        ),
      )
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
    if (current.some((leg) => !owned.has(leg.fromVisitId) || !owned.has(leg.toVisitId))) {
      throw new Error('Cannot reorder a day with a current cross-day connection');
    }

    // Keep the same Leg, route selection and evidence whenever its ordered endpoints survive.
    const desiredPairs = new Set(
      requested.slice(1).map((toId, index) => pairKey(requested[index], toId)),
    );
    const retainedPairs = new Set<string>();
    let archivedLegCount = 0;
    for (const leg of current) {
      const key = pairKey(leg.fromVisitId, leg.toVisitId);
      if (desiredPairs.has(key)) {
        retainedPairs.add(key);
        continue;
      }
      await tx.update(legs).set({ isCurrent: false }).where(eq(legs.id, leg.id));
      await tx
        .update(routeProposals)
        .set({ status: 'invalidated', reviewedAt: new Date() })
        .where(and(eq(routeProposals.legId, leg.id), eq(routeProposals.status, 'pending')));
      archivedLegCount += 1;
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

    let newLegCount = 0;
    for (let index = 1; index < requested.length; index += 1) {
      if (retainedPairs.has(pairKey(requested[index - 1], requested[index]))) continue;
      await tx.insert(legs).values({
        tripId: input.tripId,
        fromVisitId: requested[index - 1],
        toVisitId: requested[index],
      });
      newLegCount += 1;
    }

    return { changed: true, archivedLegCount, newLegCount };
  });
}

/**
 * Archive one Visit without deleting its historic evidence or Leg references.
 * All affected current daily Legs are archived; surviving adjacent Visits gain
 * fresh draft connections. A current explicit cross-day link blocks the edit.
 */
export async function archiveVisitFromDay(
  db: PostgresJsDatabase,
  input: { tripId: string; tripDayId: string; visitId: string },
) {
  return db.transaction(async (tx) => {
    const [day] = await tx
      .select({ id: tripDays.id, isArchived: tripDays.isArchived })
      .from(tripDays)
      .where(and(eq(tripDays.id, input.tripDayId), eq(tripDays.tripId, input.tripId)))
      .for('update');
    if (!day) {
      throw new Error('Trip day not found in the specified trip');
    }
    if (day.isArchived) throw new Error('Trip day is archived');
    const active = await tx
      .select({ id: visits.id, position: visits.position })
      .from(visits)
      .where(
        and(
          eq(visits.tripId, input.tripId),
          eq(visits.tripDayId, day.id),
          eq(visits.isArchived, false),
        ),
      )
      .orderBy(asc(visits.position));
    if (!active.some((visit) => visit.id === input.visitId)) {
      throw new Error('Visit not found in the active day');
    }
    const owned = new Set(active.map((visit) => visit.id));
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
          or(inArray(legs.fromVisitId, [...owned]), inArray(legs.toVisitId, [...owned])),
        ),
      );
    if (current.some((leg) => !owned.has(leg.fromVisitId) || !owned.has(leg.toVisitId))) {
      throw new Error('Cannot archive a Visit involved in a current cross-day connection');
    }

    const remaining = active.filter((visit) => visit.id !== input.visitId);
    const desiredPairs = new Set(
      remaining.slice(1).map((to, index) => pairKey(remaining[index].id, to.id)),
    );
    const retainedPairs = new Set<string>();
    let archivedLegCount = 0;
    for (const leg of current) {
      const key = pairKey(leg.fromVisitId, leg.toVisitId);
      if (desiredPairs.has(key)) {
        retainedPairs.add(key);
        continue;
      }
      await tx.update(legs).set({ isCurrent: false }).where(eq(legs.id, leg.id));
      await tx
        .update(routeProposals)
        .set({ status: 'invalidated', reviewedAt: new Date() })
        .where(and(eq(routeProposals.legId, leg.id), eq(routeProposals.status, 'pending')));
      archivedLegCount += 1;
    }
    await tx.update(visits).set({ isArchived: true }).where(eq(visits.id, input.visitId));
    const base = Math.max(...active.map((visit) => visit.position)) + 1;
    if (base + remaining.length > 2147483647) {
      throw new Error('Visit positions exceed the database integer range');
    }
    for (let index = 0; index < remaining.length; index += 1) {
      await tx
        .update(visits)
        .set({ position: base + index })
        .where(eq(visits.id, remaining[index].id));
    }
    for (let index = 0; index < remaining.length; index += 1) {
      await tx.update(visits).set({ position: index }).where(eq(visits.id, remaining[index].id));
    }
    let newLegCount = 0;
    for (let index = 1; index < remaining.length; index += 1) {
      if (retainedPairs.has(pairKey(remaining[index - 1].id, remaining[index].id))) continue;
      await tx.insert(legs).values({
        tripId: input.tripId,
        fromVisitId: remaining[index - 1].id,
        toVisitId: remaining[index].id,
      });
      newLegCount += 1;
    }
    return { archivedVisitId: input.visitId, archivedLegCount, newLegCount };
  });
}
