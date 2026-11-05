import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import { connectTrips, disconnectTrips } from '../../packages/database/src/cross-trip-connection';
import { legs, trips } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to a disposable integration-test database.');
const client = postgres(url, { max: 2 });
const db = drizzle(client);
const store = createAtlasStore(url);
const tripIds: string[] = [];
beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  if (tripIds.length) {
    await db.delete(legs).where(inArray(legs.tripId, tripIds));
    for (const id of tripIds.reverse()) await db.delete(trips).where(eq(trips.id, id));
  }
  await store.close();
  await client.end();
});
describe('Cross-trip boundary connections', () => {
  it('records, reconnects and archives an explicit Leg within one trip family', async () => {
    const [parent] = await db.insert(trips).values({ title: 'Synthetic Japan trip' }).returning();
    const [child] = await db
      .insert(trips)
      .values({ title: 'Synthetic weekend', parentTripId: parent.id })
      .returning();
    const [unrelated] = await db
      .insert(trips)
      .values({ title: 'Synthetic unrelated trip' })
      .returning();
    tripIds.push(parent.id, child.id, unrelated.id);
    const sourceDay = (await store.createDay(parent.id, '2026-11-01')) as { id: string };
    const destinationDay = (await store.createDay(child.id, '2026-11-02')) as { id: string };
    const unrelatedDay = (await store.createDay(unrelated.id, '2026-11-03')) as { id: string };
    const start = await store.addVisit(parent.id, sourceDay.id, null);
    const end = await store.addVisit(child.id, destinationDay.id, null);
    await store.addVisit(unrelated.id, unrelatedDay.id, null);
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    const forbidden = await connectTrips(db, {
      fromTripId: parent.id,
      fromDayId: sourceDay.id,
      toTripId: unrelated.id,
      toDayId: unrelatedDay.id,
    });
    expect(forbidden.status).toBe('invalid');
    const result = await connectTrips(db, {
      fromTripId: parent.id,
      fromDayId: sourceDay.id,
      toTripId: child.id,
      toDayId: destinationDay.id,
    });
    expect(result.status).toBe('connected');
    if (result.status !== 'connected') throw new Error('Cross-trip Leg was not created');
    expect(result.created).toBe(true);
    expect(result.leg.tripId).toBe(parent.id);
    expect(result.leg.transportMode).toBeNull();
    const inbound = (await store.getTimeline(child.id, destinationDay.id)) as {
      crossDayLegs: Array<{ id: string }>;
    };
    expect(inbound.crossDayLegs.some((leg) => leg.id === result.leg.id)).toBe(true);
    const conflict = await disconnectTrips(db, result.leg.id, 999);
    expect(conflict.status).toBe('conflict');
    const removed = await disconnectTrips(db, result.leg.id, result.leg.revision);
    expect(removed.status).toBe('disconnected');
    const again = await connectTrips(db, {
      fromTripId: parent.id,
      fromDayId: sourceDay.id,
      toTripId: child.id,
      toDayId: destinationDay.id,
    });
    expect(again.status).toBe('connected');
    if (again.status !== 'connected') throw new Error('Cross-trip Leg was not restored');
    expect(again.created).toBe(false);
    expect(again.leg.id).toBe(result.leg.id);
    const archived = await store.archiveDay(child.id, destinationDay.id, 1, true);
    expect(archived.status).toBe('updated');
    const [edge] = await db.select().from(legs).where(eq(legs.id, result.leg.id));
    expect(edge.isCurrent).toBe(false);
  });
  it('preserves intra-trip draft Legs when a parent Trip is archived and restored', async () => {
    const [parent] = await db.insert(trips).values({ title: 'Synthetic archive parent' }).returning();
    const [child] = await db.insert(trips).values({ title: 'Synthetic archive child', parentTripId: parent.id }).returning();
    tripIds.push(parent.id, child.id);
    const day = (await store.createDay(child.id, '2026-11-03')) as { id: string };
    await store.addVisit(child.id, day.id, null);
    await store.addVisit(child.id, day.id, null);
    const before = await db.select().from(legs).where(eq(legs.tripId, child.id));
    expect(before).toHaveLength(1);
    expect(before[0].isCurrent).toBe(true);
    const archived = await store.editTrip(parent.id, 1, { isArchived: true });
    expect(archived.status).toBe('updated');
    const hidden = await db.select().from(legs).where(eq(legs.id, before[0].id));
    expect(hidden[0].isCurrent).toBe(true);
    const restored = await store.editTrip(parent.id, 2, { isArchived: false });
    expect(restored.status).toBe('updated');
    const after = await db.select().from(legs).where(eq(legs.id, before[0].id));
    expect(after[0].isCurrent).toBe(true);
    expect(after[0].id).toBe(before[0].id);
  });

});
