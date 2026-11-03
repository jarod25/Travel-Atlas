import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { appendVisitToDay, reorderVisitsInDay } from '../../packages/database/src/visit-repository';
import { legs, tripDays, trips, visits } from '../../packages/database/src/schema';

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
    expect(change).toEqual({ changed: true, archivedLegCount: 2, newLegCount: 2 });
    const ordered = await db
      .select()
      .from(visits)
      .where(eq(visits.tripDayId, day.id))
      .orderBy(asc(visits.position));
    expect(ordered.map((v) => v.id)).toEqual([ids[2], ids[0], ids[1]]);
    const all = await db.select().from(legs).where(eq(legs.tripId, trip.id));
    const historical = all.filter((leg) => !leg.isCurrent);
    const current = all.filter((leg) => leg.isCurrent);
    expect(historical).toHaveLength(2);
    expect(current).toHaveLength(2);
    const actualPairs = current.map((leg) => [leg.fromVisitId, leg.toVisitId].join(':')).sort();
    const expectedPairs = [[ids[2], ids[0]].join(':'), [ids[0], ids[1]].join(':')].sort();
    expect(actualPairs).toEqual(expectedPairs);
    expect(
      current.every((leg) => leg.transportMode === null && leg.geometryConfidence === 'unknown'),
    ).toBe(true);
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
