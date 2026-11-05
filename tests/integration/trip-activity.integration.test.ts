import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createAtlasStore } from '../../packages/database/src/atlas-store';
import { legs, tripDays, trips, visits } from '../../packages/database/src/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must point to a disposable integration-test database.');
const client = postgres(url, { max: 2 });
const db = drizzle(client);
const store = createAtlasStore(url);
const tripIds: string[] = [];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: 'packages/database/drizzle' });
});
afterAll(async () => {
  for (const id of tripIds) {
    await db.delete(legs).where(eq(legs.tripId, id));
    await db.delete(trips).where(eq(trips.id, id));
  }
  await store.close();
  await client.end();
});

describe('Trip activity ordering', () => {
  it('counts a Leg edit as activity on its Trip without changing the Trip revision', async () => {
    const [first] = await db.insert(trips).values({ title: 'Synthetic active trip' }).returning();
    const [second] = await db.insert(trips).values({ title: 'Synthetic other trip' }).returning();
    tripIds.push(first.id, second.id);

    const [day] = await db.insert(tripDays).values({ tripId: first.id, position: 0 }).returning();
    const [from] = await db
      .insert(visits)
      .values({ tripId: first.id, tripDayId: day.id, position: 0 })
      .returning();
    const [to] = await db
      .insert(visits)
      .values({ tripId: first.id, tripDayId: day.id, position: 1 })
      .returning();
    const [leg] = await db
      .insert(legs)
      .values({ tripId: first.id, fromVisitId: from.id, toVisitId: to.id })
      .returning();

    await db.update(legs).set({ transportMode: 'train' }).where(eq(legs.id, leg.id));
    const rows = (await store.listTrips(true)) as Array<{
      id: string;
      revision: number;
      lastActivityAt: string;
    }>;
    const own = rows.filter((row) => tripIds.includes(row.id));
    expect(own[0].id).toBe(first.id);
    expect(typeof own[0].lastActivityAt).toBe('string');
    expect(own[0].revision).toBe(1);
    expect(own[1].id).toBe(second.id);
  });
});
