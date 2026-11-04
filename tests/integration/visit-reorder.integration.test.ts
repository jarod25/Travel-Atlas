import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { appendVisitToDay, reorderVisitsInDay } from '../../packages/database/src/visit-repository';
import {
  legs,
  routeProposals,
  routeVersions,
  tripDays,
  trips,
  visits,
} from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL must point to a disposable integration-test database.');
}
const client = postgres(url, { max: 5 });
const db = drizzle(client);
const tripIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) {
    await db.delete(routeProposals).where(eq(routeProposals.tripId, id));
    await db.update(legs).set({ selectedRouteVersionId: null }).where(eq(legs.tripId, id));
    await db.delete(routeVersions).where(eq(routeVersions.tripId, id));
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await client.end();
});

async function fixture() {
  const [trip] = await db.insert(trips).values({ title: 'Synthetic reorder' }).returning();
  tripIds.push(trip.id);
  const [day] = await db.insert(tripDays).values({ tripId: trip.id, position: 0 }).returning();
  const a = await appendVisitToDay(db, { tripId: trip.id, tripDayId: day.id });
  const b = await appendVisitToDay(db, { tripId: trip.id, tripDayId: day.id });
  const c = await appendVisitToDay(db, { tripId: trip.id, tripDayId: day.id });
  return { trip, day, ids: [a.visit.id, b.visit.id, c.visit.id] };
}

describe('Atomic visit reordering', () => {
  it('reorders the timeline and keeps old legs as history', async () => {
    const { trip, day, ids } = await fixture();
    const change = await reorderVisitsInDay(db, {
      tripId: trip.id,
      tripDayId: day.id,
      orderedVisitIds: [ids[2], ids[0], ids[1]],
    });
    expect(change).toEqual({ changed: true, archivedLegCount: 1, newLegCount: 1 });
    const ordered = await db
      .select()
      .from(visits)
      .where(eq(visits.tripDayId, day.id))
      .orderBy(asc(visits.position));
    expect(ordered.map((v) => v.id)).toEqual([ids[2], ids[0], ids[1]]);
    const all = await db.select().from(legs).where(eq(legs.tripId, trip.id));
    const historical = all.filter((leg) => !leg.isCurrent);
    const current = all.filter((leg) => leg.isCurrent);
    expect(historical).toHaveLength(1);
    expect(current).toHaveLength(2);
    const actualPairs = current.map((leg) => [leg.fromVisitId, leg.toVisitId].join(':')).sort();
    const expectedPairs = [[ids[2], ids[0]].join(':'), [ids[0], ids[1]].join(':')].sort();
    expect(actualPairs).toEqual(expectedPairs);
    expect(
      current.every((leg) => leg.transportMode === null && leg.geometryConfidence === 'unknown'),
    ).toBe(true);
  });

  it('preserves known travel and saved route versions for unchanged adjacency', async () => {
    const { trip, day, ids } = await fixture();
    const original = (await db.select().from(legs).where(eq(legs.tripId, trip.id))).find(
      (leg) => leg.fromVisitId === ids[0] && leg.toVisitId === ids[1],
    );
    if (!original) throw new Error('Expected original Leg');
    await db
      .update(legs)
      .set({
        transportMode: 'train',
        transportConfidence: 'confirmed',
        movementConfidence: 'confirmed',
      })
      .where(eq(legs.id, original.id));
    const [route] = await db
      .insert(routeVersions)
      .values({
        tripId: trip.id,
        legId: original.id,
        versionNumber: 1,
        origin: 'calculated',
        confidence: 'estimated',
      })
      .returning();
    await db
      .update(legs)
      .set({ selectedRouteVersionId: route.id })
      .where(eq(legs.id, original.id));

    const result = await reorderVisitsInDay(db, {
      tripId: trip.id,
      tripDayId: day.id,
      orderedVisitIds: [ids[2], ids[0], ids[1]],
    });
    expect(result).toEqual({ changed: true, archivedLegCount: 1, newLegCount: 1 });
    const all = await db.select().from(legs).where(eq(legs.tripId, trip.id));
    const preserved = all.find((leg) => leg.id === original.id);
    expect(preserved?.isCurrent).toBe(true);
    expect(preserved?.transportMode).toBe('train');
    expect(preserved?.transportConfidence).toBe('confirmed');
    expect(preserved?.movementConfidence).toBe('confirmed');
    expect(preserved?.selectedRouteVersionId).toBe(route.id);
    const savedVersions = await db
      .select()
      .from(routeVersions)
      .where(eq(routeVersions.id, route.id));
    expect(savedVersions).toHaveLength(1);
  });

  it('invalidates pending proposals only when their current Leg becomes historical', async () => {
    const { trip, day, ids } = await fixture();
    const old = (await db.select().from(legs).where(eq(legs.tripId, trip.id))).find(
      (leg) => leg.fromVisitId === ids[1] && leg.toVisitId === ids[2],
    );
    if (!old) throw new Error('Expected Leg');
    const [proposal] = await db
      .insert(routeProposals)
      .values({
        tripId: trip.id,
        legId: old.id,
        fromVisitId: old.fromVisitId,
        toVisitId: old.toVisitId,
        transportMode: old.transportMode,
      })
      .returning();
    await reorderVisitsInDay(db, {
      tripId: trip.id,
      tripDayId: day.id,
      orderedVisitIds: [ids[2], ids[0], ids[1]],
    });
    const [after] = await db
      .select()
      .from(routeProposals)
      .where(eq(routeProposals.id, proposal.id));
    expect(after.status).toBe('invalidated');
    expect(after.reviewedAt).toBeInstanceOf(Date);
    expect(after.acceptedRouteVersionId).toBeNull();
  });

  it('does not change existing leg history for an unchanged order', async () => {
    const { trip, day, ids } = await fixture();
    const change = await reorderVisitsInDay(db, {
      tripId: trip.id,
      tripDayId: day.id,
      orderedVisitIds: ids,
    });
    expect(change.changed).toBe(false);
    expect(await db.select().from(legs).where(eq(legs.tripId, trip.id))).toHaveLength(2);
  });

  it('rejects missing, duplicate or foreign visit identifiers without mutation', async () => {
    const { trip, day, ids } = await fixture();
    const another = await fixture();
    const invalidOrders = [
      [ids[0], ids[0], ids[2]],
      [ids[0], ids[2]],
      [ids[0], ids[1], another.ids[0]],
    ];
    for (const orderedVisitIds of invalidOrders) {
      await expect(
        reorderVisitsInDay(db, {
          tripId: trip.id,
          tripDayId: day.id,
          orderedVisitIds,
        }),
      ).rejects.toThrow('exact permutation');
    }
    const rows = await db
      .select()
      .from(visits)
      .where(eq(visits.tripDayId, day.id))
      .orderBy(asc(visits.position));
    expect(rows.map((v) => v.id)).toEqual(ids);
    expect(await db.select().from(legs).where(eq(legs.tripId, trip.id))).toHaveLength(2);
  });

  it('protects an explicit current cross-day leg from automatic rewrite', async () => {
    const { trip, day, ids } = await fixture();
    const [secondDay] = await db
      .insert(tripDays)
      .values({ tripId: trip.id, position: 1 })
      .returning();
    const [outside] = await db
      .insert(visits)
      .values({
        tripId: trip.id,
        tripDayId: secondDay.id,
        position: 0,
      })
      .returning();
    await db.insert(legs).values({
      tripId: trip.id,
      fromVisitId: ids[2],
      toVisitId: outside.id,
    });
    await expect(
      reorderVisitsInDay(db, {
        tripId: trip.id,
        tripDayId: day.id,
        orderedVisitIds: [ids[1], ids[0], ids[2]],
      }),
    ).rejects.toThrow('current cross-day connection');
    const rows = await db
      .select()
      .from(visits)
      .where(eq(visits.tripDayId, day.id))
      .orderBy(asc(visits.position));
    expect(rows.map((v) => v.id)).toEqual(ids);
    expect(
      (await db.select().from(legs).where(eq(legs.tripId, trip.id))).filter((l) => l.isCurrent),
    ).toHaveLength(3);
  });
});
